'use server'

/**
 * Server Actions: gestión manual de envíos a entidades de préstamo (lender_submissions).
 *
 * - markLenderSubmissionSent: el caso se envió a mano (fuera del flujo automático).
 * - dismissLenderSubmission: el caso no se va a enviar (descartado).
 *
 * Solo actúan sobre casos pendientes (pending_docs / error) y registran quién lo hizo en
 * lender_submission_events. NO envían nada a la entidad ni tocan Pipedrive.
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
  status: 'sent' | 'dismissed',
  detail: (email: string) => string,
  extra: Record<string, unknown> = {},
): Promise<LenderActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'ID inválido' }
  const email = await currentUserEmail()
  if (!email) return { ok: false, error: 'Sesión no válida' }

  const supabase = await createAdminClient()
  const { data: updated, error } = await supabase
    .from('lender_submissions')
    .update({ status, ...extra })
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

export async function markLenderSubmissionSent(id: string): Promise<LenderActionResult> {
  return closePending(id, 'sent', (email) => `Marcado como enviado a mano por ${email}`, {
    sent_at: new Date().toISOString(),
    missing_docs: [],
    error_message: null,
  })
}

export async function dismissLenderSubmission(id: string, reason: string): Promise<LenderActionResult> {
  const why = reason.trim().slice(0, 500)
  if (!why) return { ok: false, error: 'Indica el motivo' }
  return closePending(id, 'dismissed', (email) => `Descartado por ${email}: ${why}`)
}
