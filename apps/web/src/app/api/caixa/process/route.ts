/**
 * POST /api/caixa/process
 *
 * Processes rows from a Caixa Excel file:
 * 1. Deduplicates via caixa_processed (UNIQUE on numero_peticion).
 * 2. Adds a formatted note to the Pipedrive deal.
 * 3. If ESTADO_DEL_LEAD === "5 - CERRADA", calls Claude (haiku) to match
 *    the resolution text to a Pipedrive lost-reason option ID, then marks
 *    the deal as lost.
 * 4. Records each result in caixa_processed.
 *
 * Runs server-side only. Never expose PIPEDRIVE_API_TOKEN or ANTHROPIC_API_KEY
 * to the browser.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/server'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedCaixaRow {
  numero_peticion: string  // col B (index 1)
  col_C: string            // Nombre de la oportunidad
  col_D: string            // ESTADO DEL LEAD
  col_E: string            // Motivo pendiente interno
  col_F: string            // Resolución
  col_G: string            // Fecha Firma
  col_I: string            // Fecha de creación (ISO or raw)
  col_N: string            // Llamadas salientes
}

interface ProcessResult {
  numero_peticion: string
  deal_id: string
  status: 'processed' | 'skipped' | 'error'
  detail?: string
  pipedrive_note_id?: string
  lost_reason_id?: number
  lost_reason_label?: string
  marked_lost?: boolean
  stage_id?: number
  stage_name?: string
  stage_updated?: boolean
  marked_won?: boolean
  hub_comment_added?: boolean
  hub_ticket_id?: string
  reopened?: boolean
}

// ── Pipedrive lost-reason options (field key: 5af7c8a4d8341bfe53526b6a7b4e2fc793503a90) ──
const LOST_REASON_OPTIONS: Record<number, string> = {
  3135: '201- CANCELA - POR DOCUMENTACIÓN (FASE DOCUMENTACIÓN)',
  3136: '301- CLIENTE NO INTERESADO/ DEJA DE RESPONDER (FASE BANCARIA)',
  3137: '302- DENEGADO - LTV (FASE BANCARIA)',
  3138: '303- DENEGADO - ENDEUDAMIENTO (FASE BANCARIA)',
  3139: '304- DENEGADO - PERFIL DEL CLIENTE (FASE BANCARIA)',
  3140: '305- DENEGADO - ASNEF (FASE BANCARIA)',
  3141: '306- INACTIVIDAD BANCARIA (FASE BANCARIA)',
  3142: '307- CANCELA - SE QUEDA CON SU BANCO (FASE BANCARIA)',
  3143: '308- CANCELA - MEJOR PROPUESTA EN BAYTECA (FASE BANCARIA)',
  3144: '401- DUPLICADO CON OTRO BROKER',
  3145: '402- CLIENTE POTENCIAL',
  3146: '403- PERDIO LA VIVIENDA',
  3361: 'Bayteca Opportunity',
  3579: 'Bank deal closed due to inactivity',
}

const VALID_REASON_IDS = new Set(Object.keys(LOST_REASON_OPTIONS).map(Number))
const FALLBACK_REASON_ID = 3139 // "304- DENEGADO - PERFIL DEL CLIENTE" — generic denial fallback

// ── Deterministic lookup: Resolución text (normalized) → Pipedrive option ID ──
// Derived from "Caixa estados - Dossier diario - Lost.csv" provided by operations team.
// Try this first before calling Claude — saves latency and cost for known resolutions.
const RESOLUCION_LOOKUP: Record<string, number> = (() => {
  const entries: [string, number][] = [
    ['relación entre la edad del titular de la hipoteca y el plazo solicitado', 3139],
    ['registrado por otra plataforma', 3144],
    ['dti excedido', 3138],
    ['primer contacto sin vivienda', 3146],
    ['primer deudor hipotecario tiene una simulacion / solicitud sia en proceso', 3144],
    ['primer deudor hipotecario tiene una simulacion sia en proceso', 3144],
    ['primer contacto gestión en oficinas', 3144],
    ['primer contacto cliente no localizado', 3136],
    ['phd ? envío no cumple criterios', 3139],
    ['rechazado por duplicado', 3144],
    ['relación entre el importe de compra y el importe de la hipoteca', 3137],
    ['plazo fuera de límites', 3139],
    ['primer contacto dti excesivo', 3138],
    ['el uso puede ser unicamente residencia principal o residencia secundaria/temporal', 3139],
    ['primer contacto   sin ahorros', 3138],
    ['primer contacto sin ahorros', 3138],
    ['competencia', 3142],
    ['primer contacto finalidad no admitida', 3139],
    ['primer contacto perfil de riesgo', 3139],
    ['primer contacto  ltv excesivo', 3137],
    ['primer contacto ltv excesivo', 3137],
    ['phd - perfil de riesgo', 3139],
    ['pruebas tecnicas', 3361],
    ['gestión ltv excesivo', 3137],
    ['la operacion no puede ser un autopromotor', 3139],
    ['gestión cliente no localizado', 3136],
    ['primer contacto traspaso phd', 3139],
    ['gestión  sin ahorros', 3138],
    ['gestión sin ahorros', 3138],
    ['gestión sin vivienda', 3146],
    ['phd - faltan documentos obligatorios', 3136],
    ['gestión- gestión en oficina', 3144],
    ['gestión gestión en oficina', 3144],
    ['lead erróneo', 3139],
    ['duplicada', 3144],
    ['nivel de ingresos insuficiente', 3138],
    ['primer contacto cliente no cumple política holabank', 3139],
    ['phd - duplicada misma plataforma', 3144],
    ['gestión finalidad no admitida', 3139],
    ['gestión dti excesivo', 3138],
    ['gestión perfil de riesgo', 3139],
    ['gestión garantía no hipotecable', 3139],
    ['phd - ltv excesivo', 3137],
    ['gestion cliente no cumple política holabank', 3139],
    ['phd - duplicada otra plataforma', 3144],
    ['phd - dti/endeudamiento excesivo', 3138],
    ['primer contacto garantía no hipotecable', 3139],
    ['phd - ya en trámite en oficina', 3144],
    ['admisión cliente no localizado', 3136],
    ['admisión finalidad no admitida', 3139],
    ['admisión sin vivienda', 3146],
    ['admisión perfil de riesgo', 3139],
    ['admisión ltv excesivo', 3137],
    ['finalidad no admitida', 3139],
    ['gestión sin interés real', 3136],
    ['admisión dti excesivo', 3138],
    ['admisión gestión en oficinas', 3144],
    ['admisión garantía no hipotecable', 3139],
    ['admision contacto  sin ahorros', 3138],
    ['admision contacto sin ahorros', 3138],
    ['perfil de riesgo', 3139],
    ['sia desistido por cliente', 3142],
    ['sin vivienda', 3146],
    ['admisión sin interés real', 3136],
    ['cliente no localizado', 3136],
    ['admisión  sin ahorros', 3138],
    ['admisión sin ahorros', 3138],
    ['admision alertas impagados', 3138],
  ]
  return Object.fromEntries(entries)
})()

const PIPEDRIVE_LOST_REASON_FIELD = '5af7c8a4d8341bfe53526b6a7b4e2fc793503a90'
const PIPEDRIVE_EXTERNAL_ID_FIELD = '4673f6bf937722b6dee1afa5537f22136a396b69'

// ── Stage mapping (col_D + col_E → Pipedrive stage_id) ────────────────────────

const STAGE_NAMES: Record<number, string> = {
  77: 'Pre Bank Submission',
  70: 'Bank Submission',
  71: 'Bank offers received',
  79: 'Pre - Valuation',
  72: 'Valuation',
  73: 'FEIN',
  74: 'Notary - Formalization',
  75: 'Notary - Signature',
}

const STAGE_MAP: Record<string, Record<string, number>> = {
  '2 - SIA EN CURSO': {
    'Aprobada pendiente FEIN': 73,
    'Aprobada pendiente tasación': 72,
    'Pendiente CIRBE': 79,
    'Pendiente documentación': 79,
    'Pendiente informe': 79,
    'Pendiente nota simple': 79,
    'Pendiente provisión de fondos': 73,
    'Tasación en curso': 72,
    'Traslado aprobación CARP': 72,
    'Traslado aprobación tarifa': 72,
    'Validación tasación homologada': 72,
  },
  '3 - EN FIRMA': {
    'Aprobada pendiente escritura': 74,
    'Aprobada pendiente fecha': 74,
    'Pendiente acta notarial': 74,
  },
}

/**
 * Parses a date string that may be in "d/m/yyyy" format (Caixa's Fecha de creación)
 * where the month has no leading zero (e.g. "21/6/2026").
 * Falls back to standard Date parsing for ISO strings.
 */
function parseFechaCreacion(raw: string): Date | null {
  if (!raw) return null
  // Check d/m/yyyy FIRST — JS parses "02/06/2026" as Feb 6 (m/d/yyyy American), not Jun 2
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10))
  const d = new Date(raw)
  if (!isNaN(d.getTime())) return d
  return null
}

/**
 * In-batch deduplication:
 * - 9-digit petition numbers: group by first 6 digits (deal ID), keep the row
 *   with the highest 3-digit suffix (most recent dispatch from Caixa).
 * - 6-digit petition numbers: pass through UNLESS a 9-digit petition exists for
 *   the same deal (in which case the 9-digit one takes priority).
 * - All other lengths: pass through as-is (no in-batch dedup).
 */
function dedupByDeal(rows: ParsedCaixaRow[]): ParsedCaixaRow[] {
  const nineDigitMap = new Map<string, ParsedCaixaRow>() // key = first 6 digits
  const others: ParsedCaixaRow[] = []

  for (const row of rows) {
    const digits = (row.numero_peticion ?? '').replace(/\D/g, '')
    if (digits.length !== 9) {
      others.push(row)
      continue
    }
    const dealId = digits.substring(0, 6)
    const existing = nineDigitMap.get(dealId)
    if (!existing) {
      nineDigitMap.set(dealId, row)
    } else {
      const existingSuffix = parseInt((existing.numero_peticion ?? '').replace(/\D/g, '').substring(6), 10)
      const currentSuffix = parseInt(digits.substring(6), 10)
      if (currentSuffix > existingSuffix) nineDigitMap.set(dealId, row)
    }
  }

  // Drop 6-digit petitions when a 9-digit petition already covers the same deal
  const filteredOthers = others.filter((row) => {
    const digits = (row.numero_peticion ?? '').replace(/\D/g, '')
    return !(digits.length === 6 && nineDigitMap.has(digits))
  })

  return [...filteredOthers, ...Array.from(nineDigitMap.values())]
}

function getTargetStage(estadoLead: string, motivoPendiente: string): { stageId: number; markWon: boolean } | null {
  const estado = estadoLead.trim()
  const motivo = motivoPendiente.trim()
  if (estado === '4 - FORMALIZADA') return { stageId: 75, markWon: true }
  const stageId = STAGE_MAP[estado]?.[motivo]
  return stageId ? { stageId, markWon: false } : null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDealId(numeroPeticion: string): string {
  return numeroPeticion.toString().replace(/\D/g, '').substring(0, 6)
}

function buildNoteContent(row: ParsedCaixaRow, fechaProcesado: string): string {
  return [
    `📋 Respuesta Caixa — ${fechaProcesado}`,
    `• Nombre operación: ${row.col_C || '—'}`,
    `• Estado del lead: ${row.col_D || '—'}`,
    `• Motivo pendiente: ${row.col_E || '—'}`,
    `• Resolución: ${row.col_F || '—'}`,
    `• Fecha firma: ${row.col_G || '—'}`,
    `• Llamadas salientes: ${row.col_N || '—'}`,
  ].join('\n')
}

async function matchLostReason(resolutionText: string): Promise<number> {
  // 1. Deterministic lookup (normalized) — no AI call needed for known resolutions
  const normalized = resolutionText.trim().toLowerCase()
  if (normalized && RESOLUCION_LOOKUP[normalized] !== undefined) {
    return RESOLUCION_LOOKUP[normalized]
  }

  // 2. Claude fallback for unknown resolutions
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const optionsList = Object.entries(LOST_REASON_OPTIONS)
    .map(([id, label]) => `${id} - ${label}`)
    .join('\n')

  // Build few-shot examples from the lookup table to guide Claude
  const examples = Object.entries(RESOLUCION_LOOKUP)
    .slice(0, 10)
    .map(([res, id]) => `"${res}" → ${id}`)
    .join('\n')

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      system: `Eres un clasificador de motivos de cierre bancario. Dada la Resolución de Caixa, devuelve SOLO el ID numérico de la opción más cercana de la lista. No añadas explicación ni texto adicional.\n\nEjemplos de clasificaciones correctas:\n${examples}`,
      messages: [
        {
          role: 'user',
          content: `Resolución: "${resolutionText}"\n\nOpciones:\n${optionsList}`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type !== 'text') return FALLBACK_REASON_ID

    const parsed = parseInt(content.text.trim(), 10)
    if (VALID_REASON_IDS.has(parsed)) return parsed

    console.warn('[caixa/process] Claude returned invalid ID:', content.text)
    return FALLBACK_REASON_ID
  } catch (err) {
    console.error('[caixa/process] Claude error:', err)
    return FALLBACK_REASON_ID
  }
}

/** Returns the deal status ('open','won','lost','deleted') or null if not found. */
async function pipedriveDealStatus(dealId: string): Promise<string | null> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN no configurado')

  const res = await fetch(
    `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`,
    { method: 'GET' }
  )
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pipedrive GET deal ${res.status}: ${body.slice(0, 200)}`)
  }
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

async function pipedriveMarkLost(dealId: string, lostReasonId: number): Promise<void> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN no configurado')

  const res = await fetch(
    `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        status: 'lost',
        [PIPEDRIVE_LOST_REASON_FIELD]: lostReasonId,
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pipedrive deals API ${res.status}: ${body.slice(0, 200)}`)
  }
}

/** Reopens a lost deal (sets status back to 'open'). */
async function pipedriveReopenDeal(dealId: string): Promise<void> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN no configurado')

  const res = await fetch(
    `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ status: 'open' }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pipedrive reopen deal ${res.status}: ${body.slice(0, 200)}`)
  }
}

/** Writes the external ID (col C value) to the Pipedrive deal custom field. */
async function pipedriveSetExternalId(dealId: string, externalId: string): Promise<void> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN no configurado')

  const res = await fetch(
    `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ [PIPEDRIVE_EXTERNAL_ID_FIELD]: externalId }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pipedrive deals API ${res.status}: ${body.slice(0, 200)}`)
  }
}

// ── Request Hub Bancos ────────────────────────────────────────────────────────

/** Returns the first open ticket ID for a deal, or null if none. */
async function requestHubGetTicket(dealId: string): Promise<string | null> {
  const base = process.env.REQUEST_HUB_BASE_URL
  const secret = process.env.REQUEST_HUB_EXTERNAL_API_SECRET
  if (!base || !secret) return null // feature disabled if not configured

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

/** Adds a comment to a Request Hub ticket. */
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

async function pipedriveUpdateStage(dealId: string, stageId: number, markWon: boolean): Promise<void> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN no configurado')

  const payload: Record<string, unknown> = { stage_id: stageId }
  if (markWon) payload.status = 'won'

  const res = await fetch(
    `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pipedrive deals API ${res.status}: ${body.slice(0, 200)}`)
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { rows?: unknown; date_from?: unknown; date_to?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.rows) || typeof body.date_from !== 'string') {
    return NextResponse.json(
      { error: '`rows` (array) y `date_from` (string ISO) son requeridos' },
      { status: 400 }
    )
  }

  const rows = dedupByDeal(body.rows as ParsedCaixaRow[])
  const dateFrom = new Date(body.date_from)
  if (isNaN(dateFrom.getTime())) {
    return NextResponse.json({ error: '`date_from` no es una fecha válida' }, { status: 400 })
  }
  const dateTo = body.date_to && typeof body.date_to === 'string' ? new Date(body.date_to) : null

  const supabase = await createAdminClient()
  const fechaProcesado = new Date().toLocaleDateString('es-ES')
  const results: ProcessResult[] = []
  let processed = 0
  let skipped = 0
  let errors = 0

  for (const row of rows) {
    const numeroPeticion = (row.numero_peticion ?? '').toString().trim()
    if (!numeroPeticion) continue

    const dealId = extractDealId(numeroPeticion)
    if (!dealId || dealId.length < 4) {
      results.push({ numero_peticion: numeroPeticion, deal_id: '', status: 'error', detail: 'deal_id inválido' })
      errors++
      continue
    }

    // Filter by fecha_creacion (col I) — handles "d/m/yyyy" format from Caixa
    if (row.col_I) {
      const creacion = parseFechaCreacion(row.col_I)
      if (creacion) {
        if (creacion < dateFrom) continue
        if (dateTo && creacion > dateTo) continue
      }
    }

    const estadoNorm = (row.col_D ?? '').trim()
    const motivoNorm = (row.col_E ?? '').trim()
    const resolucionNorm = (row.col_F ?? '').trim()

    // Dedup check: composite key (numero_peticion + estado + motivo + resolución)
    const { data: existing } = await supabase
      .from('caixa_processed')
      .select('id')
      .eq('numero_peticion', numeroPeticion)
      .eq('estado_del_lead', estadoNorm)
      .eq('motivo_pendiente', motivoNorm)
      .eq('resolucion', resolucionNorm)
      .maybeSingle()

    if (existing) {
      results.push({ numero_peticion: numeroPeticion, deal_id: dealId, status: 'skipped', detail: 'Ya procesado' })
      skipped++
      continue
    }

    // Process this row — two separate try/catch blocks:
    // - Note failure → real error, do NOT insert into DB (allow retry next upload)
    // - Mark-lost failure → warning only, note was already added, still record as processed
    let noteId: string | null = null
    let markedLost = false
    let lostReasonId: number | undefined
    let noteError: string | undefined
    let lostWarning: string | undefined
    const isClosed = estadoNorm === '5 - CERRADA'

    // Guard: never touch won deals
    let dealStatus: string | null = null
    try {
      dealStatus = await pipedriveDealStatus(dealId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ numero_peticion: numeroPeticion, deal_id: dealId, status: 'error', detail: `No se pudo verificar estado del deal: ${msg}` })
      errors++
      continue
    }

    if (dealStatus === 'won') {
      results.push({ numero_peticion: numeroPeticion, deal_id: dealId, status: 'skipped', detail: 'Deal ganado (won) — no se toca' })
      skipped++
      continue
    }

    // Reopen lost deal when Caixa status is not closed (non-fatal)
    let reopened = false
    let reopenWarning: string | undefined
    if (dealStatus === 'lost' && !isClosed) {
      try {
        await pipedriveReopenDeal(dealId)
        reopened = true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        reopenWarning = `Reopen: ${msg.slice(0, 150)}`
        console.error(`[caixa/process] Reopen error on ${numeroPeticion}:`, msg)
      }
    }

    // Step 1: Add note (fatal if it fails — don't record in DB so user can retry)
    const noteContent = buildNoteContent(row, fechaProcesado)
    try {
      noteId = await pipedriveAddNote(dealId, noteContent)
    } catch (err) {
      noteError = err instanceof Error ? err.message : String(err)
      console.error(`[caixa/process] Note error on ${numeroPeticion}:`, noteError)
    }

    if (noteError) {
      // Don't insert into caixa_processed — let the user retry
      results.push({ numero_peticion: numeroPeticion, deal_id: dealId, status: 'error', detail: noteError })
      errors++
      continue
    }

    // Step 1b: Set external ID in Pipedrive from col C (non-fatal)
    let externalIdWarning: string | undefined
    if (row.col_C) {
      try {
        await pipedriveSetExternalId(dealId, row.col_C)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        externalIdWarning = `External ID: ${msg.slice(0, 150)}`
        console.error(`[caixa/process] External ID error on ${numeroPeticion}:`, msg)
      }
    }

    // Step 1c: Request Hub Bancos comment (non-fatal, skipped if env vars not set)
    let hubCommentAdded = false
    let hubTicketId: string | undefined
    let hubWarning: string | undefined

    try {
      const ticketId = await requestHubGetTicket(dealId)
      if (ticketId) {
        hubTicketId = ticketId
        await requestHubAddComment(ticketId, noteContent)
        hubCommentAdded = true
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      hubWarning = `Request Hub: ${msg.slice(0, 150)}`
      console.error(`[caixa/process] Request Hub error on ${numeroPeticion}:`, msg)
    }

    // Step 2: Mark lost (non-fatal — 403 = permission issue)
    if (isClosed) {
      try {
        const resolutionText = (row.col_F ?? '').trim()
        lostReasonId = await matchLostReason(resolutionText)
        await pipedriveMarkLost(dealId, lostReasonId)
        markedLost = true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        lostWarning = msg.includes('403')
          ? `Sin permiso para editar este deal (403 — usa un API token de admin): ${msg.slice(0, 120)}`
          : msg
        if (!msg.includes('403')) {
          console.error(`[caixa/process] Mark-lost error on ${numeroPeticion}:`, msg)
        }
      }
    }

    // Step 2b: Update Pipedrive stage (non-fatal)
    let stageUpdated = false
    let stageId: number | undefined
    let stageName: string | undefined
    let markedWon = false
    let stageWarning: string | undefined

    if (!isClosed) {
      const target = getTargetStage(estadoNorm, motivoNorm)
      if (target) {
        stageId = target.stageId
        stageName = STAGE_NAMES[target.stageId]
        markedWon = target.markWon
        try {
          await pipedriveUpdateStage(dealId, target.stageId, target.markWon)
          stageUpdated = true
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          stageWarning = msg.includes('403')
            ? `Sin permiso para mover stage (403 — usa un API token de admin): ${msg.slice(0, 120)}`
            : msg
          console.error(`[caixa/process] Stage update error on ${numeroPeticion}:`, msg)
        }
      }
    }

    // Step 3: Record in caixa_processed (note was added successfully)
    const combinedWarning = [reopenWarning, lostWarning, stageWarning, externalIdWarning, hubWarning].filter(Boolean).join(' | ') || null
    const { error: insertError } = await supabase.from('caixa_processed').insert({
      numero_peticion: numeroPeticion,
      deal_id: dealId,
      note_added: true,
      pipedrive_note_id: noteId,
      marked_lost: markedLost,
      lost_reason_id: lostReasonId ?? null,
      estado_del_lead: estadoNorm,
      motivo_pendiente: motivoNorm,
      resolucion: resolucionNorm,
      // resolution_text: derived reason — resolución si cerrado, motivo pendiente si no
      resolution_text: isClosed ? resolucionNorm : motivoNorm,
      error_message: combinedWarning,
    })

    if (insertError) {
      console.error('[caixa/process] Supabase insert error:', insertError.message)
    }

    results.push({
      numero_peticion: numeroPeticion,
      deal_id: dealId,
      status: 'processed',
      pipedrive_note_id: noteId ?? undefined,
      lost_reason_id: lostReasonId,
      lost_reason_label: lostReasonId ? LOST_REASON_OPTIONS[lostReasonId] : undefined,
      marked_lost: markedLost,
      stage_id: stageId,
      stage_name: stageName,
      stage_updated: stageUpdated,
      marked_won: markedWon,
      hub_comment_added: hubCommentAdded,
      hub_ticket_id: hubTicketId,
      reopened,
      detail: combinedWarning ?? undefined,
    })
    processed++
  }

  return NextResponse.json({
    total: rows.length,
    processed,
    skipped,
    errors,
    results,
  })
}
