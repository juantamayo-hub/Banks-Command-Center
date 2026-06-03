/**
 * POST /api/caixa/requests/process
 *
 * Processes rows from a CaixaBank requests CSV/Excel:
 * - Adds a formatted note to the Pipedrive deal (ID Bayteca)
 * - Skips rows with no ID Bayteca
 * - Skips deals in 'won' status (never touch won deals)
 *
 * CSV column mapping (0-indexed, after skipping 2 header rows):
 *   [0] Oportunidad CaixaBank
 *   [1] Tipo de incidencia
 *   [2] Notas plataforma
 *   [3] Respuesta CaixaBank
 *   [6] ID Bayteca (Pipedrive deal ID)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export interface ParsedRequestRow {
  oportunidad_caixa: string   // col 0
  tipo_incidencia: string     // col 1
  notas_plataforma: string    // col 2
  respuesta_caixa: string     // col 3
  id_bayteca: string          // col 6
}

interface RequestResult {
  oportunidad_caixa: string
  id_bayteca: string
  status: 'processed' | 'skipped' | 'error'
  detail?: string
  pipedrive_note_id?: string
  hub_comment_added?: boolean
  hub_ticket_id?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNoteContent(row: ParsedRequestRow, fecha: string): string {
  return [
    `📋 Consulta CaixaBank — ${fecha}`,
    `• Oportunidad CaixaBank: ${row.oportunidad_caixa || '—'}`,
    `• Tipo de incidencia: ${row.tipo_incidencia || '—'}`,
    `• Notas enviadas: ${row.notas_plataforma || '—'}`,
    `• Respuesta CaixaBank: ${row.respuesta_caixa || '—'}`,
  ].join('\n')
}

async function pipedriveDealStatus(dealId: string): Promise<string | null> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN no configurado')
  const res = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Pipedrive GET deal ${res.status}`)
  const json = await res.json()
  return json?.data?.status ?? null
}

async function pipedriveAddNote(dealId: string, content: string): Promise<string | null> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN no configurado')
  const res = await fetch(
    `https://api.pipedrive.com/v1/notes?api_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ deal_id: parseInt(dealId, 10), content }),
    }
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pipedrive notes API ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = await res.json()
  return json?.data?.id?.toString() ?? null
}

// ── Request Hub Bancos ────────────────────────────────────────────────────────

async function requestHubGetTicket(dealId: string): Promise<string | null> {
  const base = process.env.REQUEST_HUB_BASE_URL
  const secret = process.env.REQUEST_HUB_EXTERNAL_API_SECRET
  if (!base || !secret) return null

  const res = await fetch(`${base}/api/external/tickets/deal/${dealId}`, {
    headers: { Authorization: `Bearer ${secret}` },
  })
  if (res.status === 404 || res.status === 401 || res.status === 403) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Request Hub GET ticket ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json()
  const tickets: Array<{ id: string }> = json?.tickets ?? []
  return tickets[0]?.id ?? null
}

async function requestHubAddComment(ticketId: string, body: string): Promise<void> {
  const base = process.env.REQUEST_HUB_BASE_URL
  const secret = process.env.REQUEST_HUB_EXTERNAL_API_SECRET
  const authorEmail = process.env.REQUEST_HUB_AUTHOR_EMAIL
  if (!base || !secret) return

  const res = await fetch(`${base}/api/external/tickets/${ticketId}/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ body, visibility: 'public', author_email: authorEmail }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Request Hub POST comment ${res.status}: ${text.slice(0, 200)}`)
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { rows?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: '`rows` (array) es requerido' }, { status: 400 })
  }

  const rows = body.rows as ParsedRequestRow[]
  const fecha = new Date().toLocaleDateString('es-ES')
  const supabase = await createAdminClient()
  const results: RequestResult[] = []
  let processed = 0, skipped = 0, errors = 0

  for (const row of rows) {
    const idBayteca = (row.id_bayteca ?? '').toString().trim().replace(/\D/g, '')
    const oportunidad = (row.oportunidad_caixa ?? '').toString().trim()

    if (!idBayteca) {
      skipped++
      continue // no deal ID — skip silently
    }

    // Dedup: skip if already processed
    if (oportunidad) {
      const { data: existing } = await supabase
        .from('caixa_requests_responses')
        .select('id')
        .eq('oportunidad_caixa', oportunidad)
        .maybeSingle()
      if (existing) {
        results.push({ oportunidad_caixa: oportunidad, id_bayteca: idBayteca, status: 'skipped', detail: 'Ya procesado' })
        skipped++
        continue
      }
    }

    // Guard: never touch won deals
    let dealStatus: string | null = null
    try {
      dealStatus = await pipedriveDealStatus(idBayteca)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ oportunidad_caixa: oportunidad, id_bayteca: idBayteca, status: 'error', detail: `No se pudo verificar deal: ${msg}` })
      errors++
      continue
    }

    if (dealStatus === null) {
      results.push({ oportunidad_caixa: oportunidad, id_bayteca: idBayteca, status: 'skipped', detail: 'Deal no encontrado en Pipedrive' })
      skipped++
      continue
    }

    if (dealStatus === 'won') {
      results.push({ oportunidad_caixa: oportunidad, id_bayteca: idBayteca, status: 'skipped', detail: 'Deal ganado (won) — no se toca' })
      skipped++
      continue
    }

    // Add note
    let noteId: string | null = null
    let noteError: string | undefined
    try {
      const content = buildNoteContent(row, fecha)
      noteId = await pipedriveAddNote(idBayteca, content)
    } catch (err) {
      noteError = err instanceof Error ? err.message : String(err)
    }

    if (noteError) {
      results.push({ oportunidad_caixa: oportunidad, id_bayteca: idBayteca, status: 'error', detail: noteError })
      errors++
      continue
    }

    // Request Hub comment
    let hubTicketId: string | null = null
    let hubCommentAdded = false
    let hubWarning: string | undefined
    try {
      hubTicketId = await requestHubGetTicket(idBayteca)
      if (hubTicketId && noteId) {
        const noteContent = buildNoteContent(row, fecha)
        await requestHubAddComment(hubTicketId, noteContent)
        hubCommentAdded = true
      }
    } catch (err) {
      hubWarning = err instanceof Error ? err.message : String(err)
    }

    // Record in DB (note was added successfully)
    const { error: insertError } = await supabase.from('caixa_requests_responses').insert({
      oportunidad_caixa: oportunidad || null,
      id_bayteca: idBayteca,
      note_added: true,
      pipedrive_note_id: noteId,
    })
    if (insertError) {
      console.error('[caixa/requests/process] Supabase insert error:', insertError.message)
    }

    results.push({
      oportunidad_caixa: oportunidad,
      id_bayteca: idBayteca,
      status: 'processed',
      pipedrive_note_id: noteId ?? undefined,
      hub_comment_added: hubCommentAdded,
      hub_ticket_id: hubTicketId ?? undefined,
      detail: hubWarning ? `Hub warning: ${hubWarning}` : undefined,
    })
    processed++
  }

  return NextResponse.json({ total: rows.length, processed, skipped, errors, results })
}
