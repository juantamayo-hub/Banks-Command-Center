'use server'

/**
 * Server Action: discardRow
 *
 * Marks a sheet row as discarded so it stops appearing in the pendientes list.
 * This is purely a platform-side flag — it does NOT delete the row from Supabase
 * or modify the Google Sheet.
 *
 * The is_discarded flag survives subsequent Sheet syncs because the sync upsert
 * only overwrites columns present in the Sheet payload (is_discarded is not one of them).
 */

import { createAdminClient } from '@/lib/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function discardRow(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  if (!id || !UUID_RE.test(id)) {
    return { ok: false, error: 'ID inválido' }
  }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('sheet_rows')
    .update({ is_discarded: true })
    .eq('id', id)

  if (error) {
    console.error('[discard] Supabase error:', error.message)
    return { ok: false, error: 'Error al descartar la fila' }
  }

  return { ok: true }
}
