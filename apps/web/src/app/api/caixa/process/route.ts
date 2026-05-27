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
}

// ── Pipedrive lost-reason options (field key: 5af7c8a4d8341bfe53526b6a7b4e2fc793503a90) ──
const LOST_REASON_OPTIONS: Record<number, string> = {
  3135: '201- CANCELA - NO PROCEDE OPERACION',
  3136: '202- CANCELA - DESISTE CLIENTE',
  3137: '203- CANCELA - OTRA ENTIDAD',
  3138: '204- CANCELA - PROBLEMA DOCUMENTACION',
  3139: '205- CANCELA - DENEGADO',
  3140: '206- CANCELA - NO FINANCIABLE',
  3141: '207- CANCELA - INMUEBLE',
  3142: '208- CANCELA - FALLECIMIENTO CLIENTE',
  3143: '209- CANCELA - PRECIO',
  3144: '210- CANCELA - SCORE/RIESGO',
  3145: '211- CANCELA - TASA DE ESFUERZO',
  3146: '212- CANCELA - ENDEUDAMIENTO',
  3147: '213- CANCELA - DEUDA FISCAL',
  3148: '214- CANCELA - SIN AHORROS',
  3149: '215- CANCELA - SITUACION LABORAL',
  3584: '216- CANCELA - OTROS',
}

const VALID_REASON_IDS = new Set(Object.keys(LOST_REASON_OPTIONS).map(Number))
const FALLBACK_REASON_ID = 3584 // "OTROS"

const PIPEDRIVE_LOST_REASON_FIELD = '5af7c8a4d8341bfe53526b6a7b4e2fc793503a90'

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
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const optionsList = Object.entries(LOST_REASON_OPTIONS)
    .map(([id, label]) => `${id} - ${label}`)
    .join('\n')

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      system: 'Eres un clasificador. Dada la Resolución de Caixa, devuelve SOLO el ID numérico (ej: 3137) de la opción más cercana de la lista. No añadas explicación ni texto adicional.',
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

// ── Request Hub Bancos ────────────────────────────────────────────────────────

/** Returns the first open ticket ID for a deal, or null if none. */
async function requestHubGetTicket(dealId: string): Promise<string | null> {
  const base = process.env.REQUEST_HUB_BASE_URL
  const secret = process.env.REQUEST_HUB_EXTERNAL_API_SECRET
  if (!base || !secret) return null // feature disabled if not configured

  const res = await fetch(`${base}/api/external/tickets/deal/${dealId}`, {
    headers: { Authorization: `Bearer ${secret}` },
  })
  if (res.status === 404) return null
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
    body: JSON.stringify({ body, visibility: 'internal', author_email: authorEmail }),
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
  let body: { rows?: unknown; date_from?: unknown }
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

  const rows = body.rows as ParsedCaixaRow[]
  const dateFrom = new Date(body.date_from)
  if (isNaN(dateFrom.getTime())) {
    return NextResponse.json({ error: '`date_from` no es una fecha válida' }, { status: 400 })
  }

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

    // Filter by fecha_creacion
    if (row.col_I) {
      const creacion = new Date(row.col_I)
      if (!isNaN(creacion.getTime()) && creacion < dateFrom) {
        // silently skip — filtered by date
        continue
      }
    }

    // Dedup check
    const { data: existing } = await supabase
      .from('caixa_processed')
      .select('id')
      .eq('numero_peticion', numeroPeticion)
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
    const isClosed = (row.col_D ?? '').trim() === '5 - CERRADA'

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

    // Step 1b: Request Hub Bancos comment (non-fatal, skipped if env vars not set)
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
      const target = getTargetStage(row.col_D ?? '', row.col_E ?? '')
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
    const combinedWarning = [lostWarning, stageWarning, hubWarning].filter(Boolean).join(' | ') || null
    const { error: insertError } = await supabase.from('caixa_processed').insert({
      numero_peticion: numeroPeticion,
      deal_id: dealId,
      note_added: true,
      pipedrive_note_id: noteId,
      marked_lost: markedLost,
      lost_reason_id: lostReasonId ?? null,
      resolution_text: (row.col_F ?? '').trim() || null,
      estado_del_lead: (row.col_D ?? '').trim() || null,
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
