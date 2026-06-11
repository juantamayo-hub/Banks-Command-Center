'use server'

// Extend Vercel function timeout beyond the 10s default so the
// Apps Script fetch (up to 20s) can complete before the function is killed.
export const maxDuration = 30

/**
 * Server Action: requestRelaunch
 *
 * 1. Calls `request_relaunch_atomic` Postgres function (atomic UPDATE + event_log INSERT).
 * 2. On success, fires the Apps Script Web App to trigger the actual n8n dispatch.
 *
 * dispatch_action controls what Apps Script does:
 *   'ENVIAR'      → retries the normal flow (Enviar=Yes path in n8n)
 *   'AUTORIZACION' → writes Autorización=Yes to the Sheet col H first, then sends
 *                    → bypasses n8n red-flag / missing-doc checks
 *
 * Next.js wraps all Server Actions with CSRF protection (origin validation +
 * signed action IDs), so arbitrary external callers cannot invoke this.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { waitUntil } from '@vercel/functions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RelaunchResult =
  | { ok: true; previous_status: string | null }
  | { ok: false; error: string; code?: string; current_status?: string }

export async function requestRelaunch(
  sheet_row_id: string,
  force: boolean = false,
  bank_slug?: string,
  sheet_row_number?: number | null,
  dispatch_action: 'ENVIAR' | 'AUTORIZACION' = 'ENVIAR'
): Promise<RelaunchResult> {
  if (!sheet_row_id || !UUID_RE.test(sheet_row_id)) {
    return { ok: false, error: 'ID de fila inválido', code: 'INVALID_ID' }
  }

  const supabase = await createAdminClient()

  // ── Step 1: Atomic DB update ──────────────────────────────────────────────
  const actor = dispatch_action === 'AUTORIZACION' ? 'user:autorizar' : 'user:verificar'

  const { data, error } = await supabase.rpc('request_relaunch_atomic', {
    p_row_id: sheet_row_id,
    p_force: force,
    p_actor: actor,
  })

  if (error) {
    console.error('[relaunch] RPC error:', error.message)
    return { ok: false, error: 'Error interno al procesar el relanzamiento.' }
  }

  const result = data as RelaunchResult
  if (!result.ok) return result

  // ── Step 2: Dispatch via Apps Script Web App ──────────────────────────────
  // Fire-and-forget: DB state is already updated. If dispatch fails, the row
  // stays as relaunch_requested. Apps Script will write Autorización=Yes to
  // the Sheet before sending when dispatch_action='AUTORIZACION'.
  if (bank_slug && sheet_row_number != null) {
    const webAppUrl = process.env.APPS_SCRIPT_WEB_APP_URL
    const secret    = process.env.APPS_SCRIPT_RELAUNCH_SECRET

    if (webAppUrl && secret) {
      // Fire-and-forget: DB is already updated. Return to client immediately
      // and let Apps Script run in background via waitUntil (Vercel keeps the
      // function alive after the response is sent).
      waitUntil(
        fetch(webAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret,
            bank_slug,
            row_number: sheet_row_number,
            action: dispatch_action,
          }),
        })
          .then(async (res) => {
            if (!res.ok) {
              console.error('[relaunch] Apps Script HTTP error:', res.status)
            } else {
              const body = await res.json()
              if (!body.ok) console.error('[relaunch] Apps Script dispatch failed:', body.error)
              else console.log('[relaunch] Apps Script dispatch ok bank=' + bank_slug)
            }
          })
          .catch((err) => console.error('[relaunch] Apps Script dispatch error:', err))
      )
    } else {
      console.warn('[relaunch] APPS_SCRIPT_WEB_APP_URL o APPS_SCRIPT_RELAUNCH_SECRET no configurados')
    }
  }

  return result
}
