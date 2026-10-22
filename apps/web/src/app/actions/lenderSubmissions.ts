'use server'

/**
 * Server Actions: gestión manual de envíos a entidades de préstamo (lender_submissions).
 *
 * - dismissLenderSubmission: el caso no se va a enviar (descartado).
 * - relaunchLenderSubmission: vuelve a lanzar el flujo n8n de la entidad. En un caso pendiente es un reintento
 *   (p. ej. tras subir la documentación); en uno ya enviado es un relanzamiento con force = true.
 *   Con override = true (solo casos pendientes) es un envío forzado: n8n no bloquea por documentación incompleta
 *   ni por bancos incompatibles (como el "Enviar" de Kutxabank).
 * El estado "enviado" lo registra siempre el flujo automático (POST /api/lender-submissions).
 * Todas las acciones quedan en lender_submission_events con quién las pidió.
 */

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_DOMAINS = ['huspy.io', 'bayteca.com']

export type LenderActionResult = { ok: true } | { ok: false; error: string }

async function currentUserEmail(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email?.toLowerCase()
  if (!email || !ALLOWED_DOMAINS.includes(email.split('@')[1] ?? '')) return null
  return email
}

async function closePending(
  id: string,
  status: 'dismissed',
  detail: (email: string) => string,
): Promise<LenderActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'ID inválido' }
  const email = await currentUserEmail()
  if (!email) return { ok: false, error: 'Sesión no válida' }

  const supabase = await createAdminClient()
  const { data: updated, error } = await supabase
    .from('lender_submissions')
    .update({ status })
    .eq('id', id)
    .in('status', ['pending_docs', 'error'])
    .select('id, lender, source, deal_id')
  if (error) return { ok: false, error: error.message }
  const row = updated?.[0]
  if (!row) return { ok: false, error: 'El caso ya no está pendiente (refresca la página)' }

  await supabase.from('lender_submission_events').insert({
    submission_id: row.id,
    lender: row.lender,
    source: row.source,
    deal_id: row.deal_id,
    status,
    detail: detail(email),
  })
  revalidatePath('/dashboard/prestamos')
  return { ok: true }
}

/** Flujos n8n de envío por entidad + origen (las URLs no son secretas; la llamada va firmada con x-offers-secret). */
const SEND_WEBHOOKS: Record<string, string> = {
  'cofidis:no_bank_fee': 'https://huspy.app.n8n.cloud/webhook/cofidis-loans-d2bb9862891b44388e49e224d95d3435',
  'cofidis:loans_pipeline': 'https://huspy.app.n8n.cloud/webhook/cofidis-prestamo-7c41e9d2',
}

export async function relaunchLenderSubmission(id: string, opts: { override?: boolean } = {}): Promise<LenderActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'ID inválido' }
  const email = await currentUserEmail()
  if (!email) return { ok: false, error: 'Sesión no válida' }
  const secret = process.env.OFFERS_API_SECRET
  if (!secret) return { ok: false, error: 'OFFERS_API_SECRET no configurado' }

  const supabase = await createAdminClient()
  const { data: row, error } = await supabase
    .from('lender_submissions')
    .select('id, lender, source, deal_id, status')
    .eq('id', id)
    .single()
  if (error || !row) return { ok: false, error: error?.message ?? 'Caso no encontrado' }
  if (row.status === 'dismissed') return { ok: false, error: 'El caso está descartado' }
  const url = SEND_WEBHOOKS[`${row.lender}:${row.source}`]
  if (!url) return { ok: false, error: 'Esta entidad no tiene flujo de envío' }

  // Un caso ya enviado solo se reenvía con force = true (relanzamiento explícito)
  const force = row.status === 'sent'
  // El envío forzado solo aplica a casos pendientes (en uno enviado sería un reenvío, que ya va con force)
  const override = opts.override === true
  if (override && row.status !== 'pending_docs' && row.status !== 'error') {
    return { ok: false, error: 'Solo se puede forzar el envío de un caso pendiente' }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-offers-secret': secret },
      body: JSON.stringify({ deal_id: row.deal_id, force, override, requested_by: email }),
    })
    if (!res.ok) return { ok: false, error: `n8n respondió ${res.status}` }
  } catch (e) {
    return { ok: false, error: `No se pudo contactar con n8n: ${e instanceof Error ? e.message : String(e)}` }
  }

  await supabase.from('lender_submission_events').insert({
    submission_id: row.id,
    lender: row.lender,
    source: row.source,
    deal_id: row.deal_id,
    status: row.status,
    detail: `${force ? 'Relanzamiento (force)' : override ? 'Envío forzado (sin bloqueo por documentación ni bancos)' : 'Reintento de envío'} solicitado por ${email}`,
  })
  revalidatePath('/dashboard/prestamos')
  return { ok: true }
}

export async function dismissLenderSubmission(id: string, reason: string): Promise<LenderActionResult> {
  const why = reason.trim().slice(0, 500)
  if (!why) return { ok: false, error: 'Indica el motivo' }
  return closePending(id, 'dismissed', (email) => `Descartado por ${email}: ${why}`)
}
