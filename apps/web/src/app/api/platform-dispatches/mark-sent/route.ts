/**
 * POST /api/platform-dispatches/mark-sent
 *
 * Marks a (deal_id, bank_name) dispatch as sent:
 * 1. Updates sent_at in Supabase.
 * 2. Moves the Pipedrive deal to pipeline 7, stage 70 (Bank Submission).
 * 3. Adds an auto-note to the Pipedrive deal.
 *
 * Body: { deal_id: number, bank_name: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  PLATFORM_BANKS,
  BANK_SUBMISSION_PIPELINE_ID,
  BANK_SUBMISSION_STAGE_ID,
  type PlatformBankName,
} from '@/lib/platformDispatch'

export async function POST(req: NextRequest) {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return NextResponse.json({ error: 'PIPEDRIVE_API_TOKEN no configurado' }, { status: 500 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body debe ser objeto JSON' }, { status: 400 })
  }

  const { deal_id, bank_name } = body as Record<string, unknown>

  if (typeof deal_id !== 'number' || !Number.isInteger(deal_id) || deal_id <= 0) {
    return NextResponse.json({ error: '`deal_id` debe ser entero positivo' }, { status: 400 })
  }

  if (typeof bank_name !== 'string' || !(PLATFORM_BANKS as readonly string[]).includes(bank_name)) {
    return NextResponse.json(
      { error: `\`bank_name\` debe ser uno de: ${PLATFORM_BANKS.join(', ')}` },
      { status: 400 }
    )
  }

  const bankName = bank_name as PlatformBankName
  const supabase = await createAdminClient()

  // ── 1. Mark as sent in Supabase ───────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('platform_dispatches')
    .update({ sent_at: new Date().toISOString(), sent_by: 'platform' })
    .eq('deal_id', deal_id)
    .eq('bank_name', bankName)
    .is('sent_at', null)  // idempotent guard — only update if not already sent

  if (updateError) {
    console.error('[mark-sent] Supabase update error:', updateError)
    return NextResponse.json({ error: 'Error al actualizar base de datos' }, { status: 500 })
  }

  // ── 2. Move deal to pipeline 7, stage 70 in Pipedrive ────────────────────
  let pipedriveMoved = false
  try {
    const moveRes = await fetch(
      `https://api.pipedrive.com/v1/deals/${deal_id}?api_token=${token}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipeline_id: BANK_SUBMISSION_PIPELINE_ID,
          stage_id: BANK_SUBMISSION_STAGE_ID,
        }),
      }
    )
    pipedriveMoved = moveRes.ok
    if (!moveRes.ok) {
      console.warn(`[mark-sent] Pipedrive move failed ${moveRes.status} for deal ${deal_id}`)
    }
  } catch (err) {
    console.warn('[mark-sent] Pipedrive move network error:', err)
  }

  // ── 3. Add auto-note to Pipedrive deal ────────────────────────────────────
  let noteAdded = false
  try {
    const noteContent = `✅ Dossier enviado a ${bankName} desde Banks Command Center.`
    const noteRes = await fetch(
      `https://api.pipedrive.com/v1/notes?api_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: noteContent,
          deal_id,
          pinned_to_deal_flag: false,
        }),
      }
    )
    noteAdded = noteRes.ok
    if (!noteRes.ok) {
      console.warn(`[mark-sent] Pipedrive note failed ${noteRes.status} for deal ${deal_id}`)
    }
  } catch (err) {
    console.warn('[mark-sent] Pipedrive note network error:', err)
  }

  return NextResponse.json({
    ok: true,
    pipedrive_moved: pipedriveMoved,
    note_added: noteAdded,
  })
}
