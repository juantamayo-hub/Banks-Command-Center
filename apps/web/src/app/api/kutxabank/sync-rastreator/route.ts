/**
 * POST /api/kutxabank/sync-rastreator
 *
 * Called by n8n Workflow 2 (Rastreator Sync) every 5 minutes.
 * Receives Rastreator sheet rows and updates Supabase submission statuses.
 *
 * Body:
 * {
 *   rows: Array<{
 *     deal_id: number,
 *     rastreator_status: 'approved' | 'rejected' | 'pending',
 *     rastreator_row: number   // 1-based row number in sheet
 *   }>
 * }
 *
 * Requires header: x-kutxabank-secret matching KUTXABANK_API_SECRET env var.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected'])

export async function POST(req: Request) {
  const secret = process.env.KUTXABANK_API_SECRET
  if (!secret || req.headers.get('x-kutxabank-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { rows?: unknown[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  const supabase = await createAdminClient()
  let updated = 0
  const errors: string[] = []

  for (const row of rows) {
    const r = row as { deal_id?: unknown; rastreator_status?: unknown; rastreator_row?: unknown }
    const dealId = typeof r.deal_id === 'number' ? r.deal_id : parseInt(String(r.deal_id), 10)
    const status = String(r.rastreator_status || '')
    const rowNum = typeof r.rastreator_row === 'number' ? r.rastreator_row : null

    if (isNaN(dealId) || dealId <= 0) continue
    if (!VALID_STATUSES.has(status)) continue

    const patch: Record<string, unknown> = { rastreator_status: status }
    if (rowNum != null) patch.rastreator_row = rowNum

    const { error } = await supabase
      .from('kutxabank_submissions')
      .update(patch)
      .eq('deal_id', dealId)
      // Only update if the current status is 'pending' (don't override 'sent')
      .eq('rastreator_status', 'pending')

    if (error) {
      errors.push(`deal_id=${dealId}: ${error.message}`)
    } else {
      updated++
    }
  }

  return NextResponse.json({ updated, errors: errors.length > 0 ? errors : undefined })
}
