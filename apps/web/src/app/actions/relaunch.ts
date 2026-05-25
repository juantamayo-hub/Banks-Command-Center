'use server'

/**
 * Server Action: requestRelaunch
 *
 * Calls the `request_relaunch_atomic` Postgres function via the admin client,
 * which runs both the status UPDATE and the event_log INSERT inside a single
 * DB transaction — eliminating the race condition of two separate writes.
 *
 * Next.js wraps all Server Actions with CSRF protection (origin validation +
 * signed action IDs), so arbitrary external callers cannot invoke this.
 */

import { createAdminClient } from '@/lib/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RelaunchResult =
  | { ok: true; previous_status: string | null }
  | { ok: false; error: string; code?: string; current_status?: string }

export async function requestRelaunch(
  sheet_row_id: string,
  force: boolean = false
): Promise<RelaunchResult> {
  if (!sheet_row_id || !UUID_RE.test(sheet_row_id)) {
    return { ok: false, error: 'ID de fila inválido', code: 'INVALID_ID' }
  }

  const supabase = await createAdminClient()

  const { data, error } = await supabase.rpc('request_relaunch_atomic', {
    p_row_id: sheet_row_id,
    p_force: force,
    p_actor: 'user:manual',
  })

  if (error) {
    console.error('[relaunch] RPC error:', error.message)
    return { ok: false, error: 'Error interno al procesar el relanzamiento.' }
  }

  // data is the JSONB returned by the Postgres function
  const result = data as RelaunchResult
  return result
}
