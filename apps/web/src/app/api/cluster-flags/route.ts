/**
 * POST /api/cluster-flags
 *
 * Re-runs JS-side clustering on all red_flag_events where normalized_reason IS NULL
 * (or all rows when ?force=true is passed).
 *
 * Use this after a sync brings new data so that new flags get clustered without
 * having to run the SQL migration again.
 *
 * This uses the admin client (service_role) server-side.
 * Never call this from a browser script directly — it must go through this route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizeRedFlag } from '@/lib/redFlagClusters'

const BATCH_SIZE = 200
const MAX_ROWS = 10_000 // safety cap — increase if dataset grows beyond this

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const force = searchParams.get('force') === 'true'

  const supabase = await createAdminClient()

  // Fetch rows that need clustering
  let query = supabase
    .from('red_flag_events')
    .select('id, raw_text')

  if (!force) {
    query = query.is('normalized_reason', null)
  }

  const { data: events, error } = await query.limit(MAX_ROWS)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!events || events.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, message: 'Nada que actualizar.' })
  }

  // Apply normalization in batches
  let updated = 0
  let failed = 0

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE)

    // Group events by their normalized_reason to minimize DB round-trips
    const byCategory: Record<string, string[]> = {}
    for (const ev of batch) {
      const cat = normalizeRedFlag(ev.raw_text ?? '')
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(ev.id)
    }

    for (const [category, ids] of Object.entries(byCategory)) {
      const { error: updateError } = await supabase
        .from('red_flag_events')
        .update({ normalized_reason: category })
        .in('id', ids)

      if (updateError) {
        failed += ids.length
        console.error('[cluster-flags] batch update error:', updateError.message)
      } else {
        updated += ids.length
      }
    }
  }

  return NextResponse.json({
    ok: true,
    total: events.length,
    updated,
    failed,
  })
}
