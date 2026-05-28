/**
 * POST /api/caixa/requests/fill
 *
 * Loads the stored blank template (public/templates/caixa_requests_template.xlsx),
 * fills it with CaixaBank ticket data for a given date, and returns the file.
 * Uses exceljs to preserve all styles, colors and column widths from the template.
 *
 * Column mapping:
 *   A: Oportunidad CaixaBank — external ID from Pipedrive
 *   B: Tipo de incidencia    — left blank (filled by Caixa)
 *   C: Notas plataforma      — subject: description from ticket
 *   D: Respuesta CaixaBank   — left blank (filled by Caixa)
 *   G: ID Bayteca            — pipedrive_deal_id
 *
 * Data rows start at Excel row 4. The template has a sample row at row 4
 * which is cleared before writing real data.
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import path from 'path'

// ── Supabase (Request Hub DB) ─────────────────────────────────────────────────

function createRequestHubClient() {
  const url = process.env.REQUEST_HUB_SUPABASE_URL
  const key = process.env.REQUEST_HUB_SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('REQUEST_HUB_SUPABASE_URL / REQUEST_HUB_SUPABASE_SERVICE_KEY no configurados')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EXTERNAL_ID_FIELD = '4673f6bf937722b6dee1afa5537f22136a396b69'
const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'templates', 'caixa_requests_template.xlsx')
const DATA_START_ROW = 4  // 1-indexed Excel row where data begins

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pipedriveFetchExternalId(dealId: string): Promise<string> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return ''
  try {
    const res = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`)
    if (!res.ok) return ''
    const json = await res.json()
    const value = json?.data?.[EXTERNAL_ID_FIELD]
    return value != null ? String(value) : ''
  } catch {
    return ''
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { date?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const date = (body.date as string ?? '').trim()
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: '`date` es requerido en formato YYYY-MM-DD' }, { status: 400 })
  }

  // ── Load template ───────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(TEMPLATE_PATH)
  } catch {
    return NextResponse.json(
      { error: 'No se pudo leer el template (public/templates/caixa_requests_template.xlsx)' },
      { status: 500 }
    )
  }
  const ws = wb.worksheets[0]

  // ── Query tickets from Request Hub ──────────────────────────────────────────
  let supabase: ReturnType<typeof createRequestHubClient>
  try {
    supabase = createRequestHubClient()
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('id, pipedrive_deal_id, subject, description')
    .eq('bank_name', 'CaixaBank')
    .neq('status', 'closed')
    .gte('created_at', `${date}T00:00:00.000Z`)
    .lte('created_at', `${date}T23:59:59.999Z`)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const allTickets = tickets ?? []
  if (allTickets.length === 0) {
    return NextResponse.json(
      { error: `No se encontraron tickets de CaixaBank abiertos el ${date}` },
      { status: 404 }
    )
  }

  // ── Group notes by deal_id ──────────────────────────────────────────────────
  const dealMap = new Map<string, string[]>()
  for (const ticket of allTickets) {
    const dealId = ticket.pipedrive_deal_id?.toString() ?? ''
    if (!dealId) continue
    if (!dealMap.has(dealId)) dealMap.set(dealId, [])
    const note = [ticket.subject, ticket.description].filter(Boolean).join(': ')
    if (note) dealMap.get(dealId)!.push(note)
  }

  // ── Update date in F1 ───────────────────────────────────────────────────────
  ws.getCell('F1').value = new Date(date + 'T12:00:00Z')

  // ── Clear example row (row 4) ───────────────────────────────────────────────
  const exampleRow = ws.getRow(DATA_START_ROW)
  exampleRow.eachCell({ includeEmpty: true }, (cell) => { cell.value = null })
  exampleRow.commit()

  // ── Write data rows ─────────────────────────────────────────────────────────
  let rowNum = DATA_START_ROW
  for (const [dealId, notes] of dealMap.entries()) {
    const externalId = await pipedriveFetchExternalId(dealId)
    const notesText = notes.join('\n---\n')

    const row = ws.getRow(rowNum)
    if (externalId) row.getCell('A').value = externalId
    row.getCell('C').value = notesText
    row.getCell('G').value = dealId
    row.commit()

    rowNum++
  }

  // ── Return file ─────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Caixa_Requests_${date}.xlsx"`,
    },
  })
}
