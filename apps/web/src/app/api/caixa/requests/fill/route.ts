/**
 * POST /api/caixa/requests/fill
 *
 * Generates a filled Caixa Requests Excel for a given date by loading the
 * stored blank template (public/templates/caixa_requests_template.xlsx) and
 * writing data directly into its pre-formatted cells.
 *
 * Template column mapping (cols A-G):
 *   A: Oportunidad CaixaBank — external ID from Pipedrive
 *   B: Tipo de incidencia    — left blank (filled by Caixa)
 *   C: Notas plataforma      — subject: description from ticket
 *   D: Respuesta CaixaBank   — left blank (filled by Caixa)
 *   E-F: empty
 *   G: ID Bayteca            — pipedrive_deal_id
 *
 * Data rows start at Excel row 4 (index 3). The template has a sample row
 * at row 4 which is cleared before writing real data.
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
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
const DATA_START_ROW = 4   // 1-indexed Excel row where data begins
const COLS = { A: 0, C: 2, G: 6 }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Converts YYYY-MM-DD to Excel date serial. */
function dateToExcelSerial(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z')
  const epoch = new Date(Date.UTC(1899, 11, 30))
  return Math.round((d.getTime() - epoch.getTime()) / 86400000)
}

/**
 * Sets a cell value while preserving its existing style.
 * If the cell doesn't exist yet, creates it with the given type.
 */
function setCell(ws: XLSX.WorkSheet, addr: string, value: string | number, type: 's' | 'n' = 's') {
  if (ws[addr]) {
    ws[addr].v = value
    ws[addr].t = type
    // Remove cached formatted text so Excel re-renders the value
    delete ws[addr].w
  } else {
    ws[addr] = { t: type, v: value }
  }
}

/** Clears all 7 cells in a data row (cols A-G). */
function clearRow(ws: XLSX.WorkSheet, rowNum: number) {
  for (let col = 0; col <= 6; col++) {
    const addr = XLSX.utils.encode_cell({ r: rowNum - 1, c: col })
    if (ws[addr]) {
      ws[addr].v = ''
      ws[addr].t = 's'
      delete ws[addr].w
    }
  }
}

/** Fetches the Pipedrive external ID field for a deal. Returns '' on any error. */
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
  let wb: XLSX.WorkBook
  try {
    const templateBuffer = fs.readFileSync(TEMPLATE_PATH)
    wb = XLSX.read(templateBuffer, { type: 'buffer', cellStyles: true })
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el template (public/templates/caixa_requests_template.xlsx)' }, { status: 500 })
  }
  const ws = wb.Sheets[wb.SheetNames[0]]

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

  // ── Update date in template (F1) ────────────────────────────────────────────
  setCell(ws, 'F1', dateToExcelSerial(date), 'n')
  if (ws['F1']) ws['F1'].z = 'dd/mm/yyyy'

  // ── Clear example row (row 4) ───────────────────────────────────────────────
  clearRow(ws, DATA_START_ROW)

  // ── Write data rows ─────────────────────────────────────────────────────────
  let rowNum = DATA_START_ROW
  for (const [dealId, notes] of dealMap.entries()) {
    const externalId = await pipedriveFetchExternalId(dealId)
    const notesText = notes.join('\n---\n')

    const addrA = XLSX.utils.encode_cell({ r: rowNum - 1, c: COLS.A })
    const addrC = XLSX.utils.encode_cell({ r: rowNum - 1, c: COLS.C })
    const addrG = XLSX.utils.encode_cell({ r: rowNum - 1, c: COLS.G })

    if (externalId) setCell(ws, addrA, externalId)
    setCell(ws, addrC, notesText)
    setCell(ws, addrG, dealId)

    rowNum++
  }

  // ── Return file ─────────────────────────────────────────────────────────────
  const rawBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }) as number[]
  const arrayBuffer = new Uint8Array(rawBuffer).buffer

  return new NextResponse(arrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Caixa_Requests_${date}.xlsx"`,
    },
  })
}
