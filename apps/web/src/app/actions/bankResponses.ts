'use server'

/**
 * Server Actions: revisión manual de respuestas bancarias (bank_responses).
 *
 * - resolveBankResponse: marca una respuesta como gestionada a mano (quién y cuándo).
 * - assignBankResponseDeal: vincula una respuesta "sin deal" a su deal bancario.
 *
 * Con withThread=true la acción se aplica también a las demás respuestas PENDIENTES del mismo
 * banco y del mismo hilo de Gmail (a veces llegan hasta 5 correos de un mismo caso). No es
 * automático porque Gmail agrupa por asunto: en Sabadell/Bankinter un hilo puede mezclar clientes.
 *
 * Solo actualizan bank_responses: NO tocan Pipedrive. La actualización del deal
 * (etapa, nota, lost) la sigue haciendo la persona en Pipedrive o n8n.
 * Next.js protege las Server Actions con CSRF; además se exige sesión válida.
 */

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_DOMAINS = ['huspy.io', 'bayteca.com']

export type ReviewResult = { ok: true; count: number } | { ok: false; error: string }

/** Filtro de "pendiente de revisión" (mismo criterio que needsAttention en lib/bankResponses). */
const PENDING_FILTER = 'status.in.(error,manual_review),match_status.neq.matched'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

/** IDs a actualizar: la respuesta y, si se pide, las pendientes de su mismo banco + hilo. */
async function targetIds(
  supabase: AdminClient,
  id: string,
  withThread: boolean,
  onlyUnmatched: boolean,
): Promise<string[] | { error: string }> {
  if (!withThread) return [id]
  const { data: base, error } = await supabase
    .from('bank_responses')
    .select('bank_slug, thread_id')
    .eq('id', id)
    .single()
  if (error || !base) return { error: error?.message ?? 'Respuesta no encontrada' }
  if (!base.thread_id) return [id]

  let q = supabase
    .from('bank_responses')
    .select('id')
    .eq('bank_slug', base.bank_slug)
    .eq('thread_id', base.thread_id)
    .neq('status', 'resolved')
    .or(PENDING_FILTER)
  // Al vincular nunca se pisa un deal ya asignado a otra respuesta del hilo
  if (onlyUnmatched) q = q.neq('match_status', 'matched')
  const { data: siblings, error: sibError } = await q
  if (sibError) return { error: sibError.message }
  return Array.from(new Set([id, ...(siblings ?? []).map((r) => r.id as string)]))
}

async function currentUserEmail(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email?.toLowerCase()
  if (!email || !ALLOWED_DOMAINS.includes(email.split('@')[1] ?? '')) return null
  return email
}

export async function resolveBankResponse(id: string, withThread = false): Promise<ReviewResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'ID inválido' }
  const email = await currentUserEmail()
  if (!email) return { ok: false, error: 'Sesión no válida' }

  const supabase = await createAdminClient()
  const ids = await targetIds(supabase, id, withThread, false)
  if (!Array.isArray(ids)) return { ok: false, error: ids.error }
  const { error } = await supabase
    .from('bank_responses')
    .update({ status: 'resolved', reviewed_by: email, reviewed_at: new Date().toISOString() })
    .in('id', ids)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/ofertas')
  return { ok: true, count: ids.length }
}

export async function assignBankResponseDeal(id: string, bankDealId: number, withThread = false): Promise<ReviewResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'ID inválido' }
  if (!Number.isInteger(bankDealId) || bankDealId <= 0) return { ok: false, error: 'Deal ID inválido' }
  const email = await currentUserEmail()
  if (!email) return { ok: false, error: 'Sesión no válida' }

  const supabase = await createAdminClient()
  const ids = await targetIds(supabase, id, withThread, true)
  if (!Array.isArray(ids)) return { ok: false, error: ids.error }
  const { error } = await supabase
    .from('bank_responses')
    .update({
      bank_deal_id: bankDealId,
      match_status: 'matched',
      resolved_by: 'manual',
      reviewed_by: email,
      reviewed_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/ofertas')
  return { ok: true, count: ids.length }
}
