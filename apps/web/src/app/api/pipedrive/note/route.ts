/**
 * POST /api/pipedrive/note
 *
 * Creates a note on a Pipedrive deal AND persists it in submission_notes (Supabase).
 * Uses PIPEDRIVE_API_TOKEN — server-side only, never exposed to browser.
 *
 * Body:    { deal_id: number, sheet_row_id: string, note: string }
 * Success: { ok: true }
 * Failure: { error: string } with 400 / 500 / 502
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const MAX_NOTE_LENGTH = 5000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'El body debe ser un objeto JSON' }, { status: 400 })
  }

  const { deal_id, sheet_row_id, platform_dispatch_id, note } = body as Record<string, unknown>

  if (typeof deal_id !== 'number' || !Number.isInteger(deal_id) || deal_id <= 0) {
    return NextResponse.json({ error: '`deal_id` debe ser un entero positivo' }, { status: 400 })
  }

  if (sheet_row_id !== undefined && (typeof sheet_row_id !== 'string' || !UUID_RE.test(sheet_row_id))) {
    return NextResponse.json({ error: '`sheet_row_id` debe ser un UUID válido' }, { status: 400 })
  }

  if (platform_dispatch_id !== undefined && (typeof platform_dispatch_id !== 'string' || !UUID_RE.test(platform_dispatch_id))) {
    return NextResponse.json({ error: '`platform_dispatch_id` debe ser un UUID válido' }, { status: 400 })
  }

  if (typeof note !== 'string' || note.trim().length === 0) {
    return NextResponse.json({ error: '`note` no puede estar vacío' }, { status: 400 })
  }

  if (note.trim().length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `Nota demasiado larga (máx. ${MAX_NOTE_LENGTH} caracteres)` },
      { status: 400 }
    )
  }

  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) {
    console.error('[pipedrive/note] PIPEDRIVE_API_TOKEN no configurado')
    return NextResponse.json({ error: 'Token de Pipedrive no configurado' }, { status: 500 })
  }

  const noteContent = note.trim()

  // ── 1. Resolve owner name from the general deal linked to this banking deal ──
  const GENERAL_DEAL_FIELD = '71edfe1562e9e19d4c7d96d38548dd009d4b3601'
  let pdNoteContent = noteContent
  try {
    const bankingRes = await fetch(
      `https://api.pipedrive.com/v1/deals/${deal_id}?api_token=${token}`,
      { next: { revalidate: 0 } }
    )
    if (bankingRes.ok) {
      const bankingJson = await bankingRes.json()
      const rawField = bankingJson?.data?.[GENERAL_DEAL_FIELD]
      const generalDealId: number | null =
        typeof rawField === 'number'
          ? rawField
          : typeof rawField === 'object' && rawField !== null
          ? (rawField as { value?: number }).value ?? null
          : null
      if (generalDealId && generalDealId > 0) {
        const generalRes = await fetch(
          `https://api.pipedrive.com/v1/deals/${generalDealId}?api_token=${token}`,
          { next: { revalidate: 0 } }
        )
        if (generalRes.ok) {
          const generalJson = await generalRes.json()
          const ownerId: number | undefined   = generalJson?.data?.user_id?.id
          const ownerName: string | undefined = generalJson?.data?.user_id?.name
          if (ownerId && ownerName) {
            const mention = `<a href="/users/details/${ownerId}" data-mentions="${ownerId}:${ownerId}">@${ownerName}</a>`
            pdNoteContent = `${mention} ${noteContent}`
          }
        }
      }
    }
  } catch {
    // silently skip — write note without tag
  }

  // ── 2. Post to Pipedrive ───────────────────────────────────────────────────
  let pdRes: Response
  try {
    pdRes = await fetch(`https://api.pipedrive.com/v1/notes?api_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        content: pdNoteContent,
        deal_id,
        pinned_to_deal_flag: false,
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[pipedrive/note] Network error:', msg)
    return NextResponse.json({ error: `Error de red: ${msg}` }, { status: 502 })
  }

  if (!pdRes.ok) {
    const text = await pdRes.text()
    console.error(`[pipedrive/note] Pipedrive ${pdRes.status}:`, text.slice(0, 200))
    return NextResponse.json(
      { error: `Pipedrive devolvió ${pdRes.status}` },
      { status: 502 }
    )
  }

  // ── 3. Persist in Supabase (submission_notes or platform_dispatch_notes) ──
  let dbSaved = false
  const supabase = await createAdminClient()

  if (sheet_row_id && typeof sheet_row_id === 'string') {
    try {
      const { error: dbError } = await supabase
        .from('submission_notes')
        .insert({ sheet_row_id, content: noteContent })
      if (dbError) {
        console.error('[pipedrive/note] Supabase submission_notes error:', dbError.message)
      } else {
        dbSaved = true
      }
    } catch (err) {
      console.error('[pipedrive/note] Supabase unexpected error:', err)
    }
  } else if (platform_dispatch_id && typeof platform_dispatch_id === 'string') {
    try {
      const { error: dbError } = await supabase
        .from('platform_dispatch_notes')
        .insert({ platform_dispatch_id, content: noteContent })
      if (dbError) {
        console.error('[pipedrive/note] Supabase platform_dispatch_notes error:', dbError.message)
      } else {
        dbSaved = true
      }
    } catch (err) {
      console.error('[pipedrive/note] Supabase unexpected error:', err)
    }
  }

  return NextResponse.json({ ok: true, db_saved: dbSaved })
}
