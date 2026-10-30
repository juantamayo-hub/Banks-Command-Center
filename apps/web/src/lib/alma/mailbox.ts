/**
 * Buzón de hipotecas (solo lectura) vía n8n, para las herramientas buzon_buscar / buzon_leer.
 *  - Solo para los emails de ALMA_MAILBOX_EMAILS (lista separada por comas; si no está definida → desactivado).
 *  - POST ALMA_N8N_MAILBOX_URL con cabecera x-alma-secret = ALMA_N8N_SECRET y
 *    body { action: 'search'|'read', query?, max?, message_id?, user_email }.
 *  - Cada llamada queda en alma_mailbox_audit (migración 034).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export function mailboxAllowedFor(email: string | null | undefined): boolean {
  if (!email) return false
  const list = (process.env.ALMA_MAILBOX_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.length > 0 && list.includes(email.trim().toLowerCase())
}

export type MailboxRequest =
  | { action: 'search'; query: string; max: number }
  | { action: 'read'; message_id: string }

export async function callMailbox(
  supabase: SupabaseClient,
  userEmail: string,
  req: MailboxRequest,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const url = process.env.ALMA_N8N_MAILBOX_URL
  const secret = process.env.ALMA_N8N_SECRET
  let ok = false
  let resultCount: number | null = null
  let out: { ok: boolean; data?: Record<string, unknown>; error?: string }
  if (!url || !secret) {
    out = { ok: false, error: 'El buzón no está configurado.' }
  } else {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-alma-secret': secret },
        body: JSON.stringify({ ...req, user_email: userEmail }),
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      })
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (res.status === 401) out = { ok: false, error: 'El buzón ha rechazado la consulta (no autorizado).' }
      else if (!res.ok || !data) out = { ok: false, error: `El buzón respondió ${res.status}.` }
      else {
        ok = true
        resultCount = req.action === 'search' ? (Array.isArray(data.messages) ? data.messages.length : 0) : data.id ? 1 : 0
        out = { ok: true, data }
      }
    } catch {
      out = { ok: false, error: 'No se pudo consultar el buzón.' }
    }
  }
  const { error } = await supabase.from('alma_mailbox_audit').insert({
    user_email: userEmail,
    action: req.action,
    query: req.action === 'search' ? req.query : null,
    message_id: req.action === 'read' ? req.message_id : null,
    result_count: resultCount,
    ok,
  })
  if (error) console.error('[alma_mailbox_audit] insert error:', error.message)
  return out
}
