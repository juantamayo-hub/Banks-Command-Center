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
      headers: { 'Content-Type': 'application/json' },
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
  const results: RequestResult[] = []
  let processed = 0, skipped = 0, errors = 0

  for (const row of rows) {
    const idBayteca = (row.id_bayteca ?? '').toString().trim().replace(/\D/g, '')
    const oportunidad = (row.oportunidad_caixa ?? '').toString().trim()

    if (!idBayteca) {
      skipped++
      continue // no deal ID — skip silently
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
    try {
      const content = buildNoteContent(row, fecha)
      const noteId = await pipedriveAddNote(idBayteca, content)
      results.push({ oportunidad_caixa: oportunidad, id_bayteca: idBayteca, status: 'processed', pipedrive_note_id: noteId ?? undefined })
      processed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ oportunidad_caixa: oportunidad, id_bayteca: idBayteca, status: 'error', detail: msg })
      errors++
    }
  }

  return NextResponse.json({ total: rows.length, processed, skipped, errors, results })
}
