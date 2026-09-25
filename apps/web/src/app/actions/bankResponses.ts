'use server'

/**
 * Server Actions: revisión manual de respuestas bancarias (bank_responses).
 *
 * - resolveBankResponse: marca una respuesta como gestionada a mano (quién y cuándo).
 * - assignBankResponseDeal: vincula una respuesta "sin deal" a su deal bancario.
 *
 * Solo actualizan bank_responses: NO tocan Pipedrive. La actualización del deal
 * (etapa, nota, lost) la sigue haciendo la persona en Pipedrive o n8n.
 * Next.js protege las Server Actions con CSRF; además se exige sesión válida.
 */

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_DOMAINS = ['huspy.io', 'bayteca.com']

export type ReviewResult = { ok: true } | { ok: false; error: string }

async function currentUserEmail(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email?.toLowerCase()
  if (!email || !ALLOWED_DOMAINS.includes(email.split('@')[1] ?? '')) return null
  return email
}

export async function resolveBankResponse(id: string): Promise<ReviewResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'ID inválido' }
  const email = await currentUserEmail()
  if (!email) return { ok: false, error: 'Sesión no válida' }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('bank_responses')
    .update({ status: 'resolved', reviewed_by: email, reviewed_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/ofertas')
  return { ok: true }
}

export async function assignBankResponseDeal(id: string, bankDealId: number): Promise<ReviewResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'ID inválido' }
  if (!Number.isInteger(bankDealId) || bankDealId <= 0) return { ok: false, error: 'Deal ID inválido' }
  const email = await currentUserEmail()
  if (!email) return { ok: false, error: 'Sesión no válida' }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('bank_responses')
    .update({
      bank_deal_id: bankDealId,
      match_status: 'matched',
      resolved_by: 'manual',
      reviewed_by: email,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/ofertas')
  return { ok: true }
}
