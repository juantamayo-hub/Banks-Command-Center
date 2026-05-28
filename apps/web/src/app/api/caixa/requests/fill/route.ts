/**
 * POST /api/caixa/requests/fill
 *
 * Generates a filled Caixa Requests Excel for a given date:
 * 1. Queries Supabase for CaixaBank tickets (status ≠ closed) created on that date.
 * 2. Groups by pipedrive_deal_id (fallback: concatenates notes per deal).
 * 3. Fetches the Pipedrive external ID (field 4673f6bf937722b6dee1afa5537f22136a396b69)
 *    for each deal.
 * 4. Returns an .xlsx file matching the standard template structure.
 *
 * Template structure (0-indexed rows):
 *   Row 0: PLATAFORMA | BAYTECA | v2.0 | | Fecha de la solicitud | <date serial> |
 *   Row 1: (empty)
 *   Row 2: Oportunidad CaixaBank | Tipo de incidencia | Notas plataforma | Respuesta CaixaBank | | | ID Bayteca
 *   Row 3+: data
 *
 * Column mapping:
 *   A (0): Oportunidad CaixaBank — external ID from Pipedrive
 *   B (1): Tipo de incidencia — NOT filled (left blank for Caixa)
 *   C (2): Notas plataforma — subject: description from ticket
 *   D (3): Respuesta CaixaBank — NOT filled (filled by Caixa)
 *   G (6): ID Bayteca — pipedrive_deal_id
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient } from '@/lib/supabase/server'

const EXTERNAL_ID_FIELD = '4673f6bf937722b6dee1afa5537f22136a396b69'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Converts a YYYY-MM-DD string to an Excel date serial number. */
function dateToExcelSerial(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z')
  const epoch = new Date(Date.UTC(1899, 11, 30)) // Dec 30, 1899
  return Math.round((d.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24))
}

/** Fetches the Pipedrive external ID field for a deal. Returns '' on any error. */
async function pipedriveFetchExternalId(dealId: string): Promise<string> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return ''
  try {
    const res = await fetch(
      `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`
    )
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
    return NextResponse.json(
      { error: '`date` es requerido en formato YYYY-MM-DD' },
      { status: 400 }
    )
  }

  const supabase = await createAdminClient()

  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('id, pipedrive_deal_id, subject, description')
    .eq('bank_name', 'CaixaBank')
    .neq('status', 'closed')
    .gte('created_at', `${date}T00:00:00.000Z`)
    .lte('created_at', `${date}T23:59:59.999Z`)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const allTickets = tickets ?? []

  if (allTickets.length === 0) {
    return NextResponse.json(
      { error: `No se encontraron tickets de CaixaBank abiertos el ${date}` },
      { status: 404 }
    )
  }

  // Filter out tickets already included in a previous generated Excel
  const allTicketIds = allTickets.map((t) => t.id).filter(Boolean)
  const { data: alreadySent } = await supabase
    .from('caixa_requests_fills')
    .select('ticket_id')
    .in('ticket_id', allTicketIds)
  const sentSet = new Set((alreadySent ?? []).map((r) => r.ticket_id as string))
  const newTickets = allTickets.filter((t) => !sentSet.has(t.id))

  if (newTickets.length === 0) {
    return NextResponse.json(
      { error: `Todos los tickets de CaixaBank del ${date} ya fueron incluidos en un Excel anterior` },
      { status: 404 }
    )
  }

  // Group notes by deal_id
  const dealMap = new Map<string, { notes: string[]; ticketIds: string[] }>()
  for (const ticket of newTickets) {
    const dealId = ticket.pipedrive_deal_id?.toString() ?? ''
    if (!dealId) continue
    if (!dealMap.has(dealId)) dealMap.set(dealId, { notes: [], ticketIds: [] })
    const note = [ticket.subject, ticket.description].filter(Boolean).join(': ')
    if (note) dealMap.get(dealId)!.notes.push(note)
    dealMap.get(dealId)!.ticketIds.push(ticket.id as string)
  }

  // Build data rows (fetch external IDs sequentially to avoid rate limits)
  const dataRows: unknown[][] = []
  const fillInserts: Array<{ ticket_id: string; pipedrive_deal_id: string; for_date: string; external_id_caixa: string }> = []

  for (const [dealId, { notes, ticketIds }] of dealMap.entries()) {
    const externalId = await pipedriveFetchExternalId(dealId)
    const notesText = notes.join('\n---\n')
    dataRows.push([externalId, '', notesText, '', '', '', dealId])
    for (const ticketId of ticketIds) {
      fillInserts.push({ ticket_id: ticketId, pipedrive_deal_id: dealId, for_date: date, external_id_caixa: externalId })
    }
  }

  // Build Excel workbook
  const wsData: unknown[][] = [
    ['PLATAFORMA', 'BAYTECA', 'v2.0', '', 'Fecha de la solicitud', dateToExcelSerial(date), ''],
    ['', '', '', '', '', '', ''],
    [
      'Oportunidad CaixaBank',
      'Tipo de incidencia\n(Selección de combo)',
      'Notas plataforma\n(Texto libre)',
      'Respuesta CaixaBank',
      '',
      '',
      'ID Bayteca',
    ],
    ...dataRows,
  ]

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Format date cell as date
  if (ws['F1']) {
    ws['F1'].t = 'n'
    ws['F1'].z = 'dd/mm/yyyy'
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Hoja 1')

  const rawBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as number[]
  const arrayBuffer = new Uint8Array(rawBuffer).buffer

  // Record included tickets so they are excluded from future generations
  if (fillInserts.length > 0) {
    const { error: insertError } = await supabase
      .from('caixa_requests_fills')
      .insert(fillInserts)
    if (insertError) {
      console.error('[caixa/requests/fill] Supabase insert error:', insertError.message)
    }
  }

  return new NextResponse(arrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Caixa_Requests_${date}.xlsx"`,
    },
  })
}
