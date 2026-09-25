/**
 * POST /api/bank-responses
 *
 * Llamado por los workflows n8n *_Offers_Received (sub-workflow "OFFERS · Registrar respuesta")
 * al terminar CADA rama: oferta, más info, rechazo, sin deal o error.
 *
 * Idempotente: upsert por (source, external_id). Reprocesar el mismo correo actualiza la fila.
 *
 * Body (JSON, un objeto o { responses: [...] }):
 * {
 *   bank_slug: 'bankinter',            // obligatorio (= ACTIVE_BANKS.slug)
 *   external_id: '1a0d78d054703176',   // obligatorio (Gmail message id / id API)
 *   source?: 'email' | 'api' | 'platform' | 'sheet' | 'backfill',
 *   thread_id?, received_at?, subject?, from_email?,
 *   general_deal_id?, bank_deal_id?, client_name?, resolved_by?,
 *   match_status?: 'matched' | 'unmatched' | 'ambiguous',
 *   classification?: 'OFERTA' | 'MAS_INFO' | 'RECHAZO' | 'offer' | ...,
 *   summary?, required_action?, lost_reason?,
 *   offer?: OfferData, raw_extraction?: object,
 *   status?: 'processed' | 'error' | 'manual_review',
 *   error_step?, error_message?, pipedrive_actions?: object[],
 *   workflow_id?, execution_id?
 * }
 *
 * Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizeClassification, RESPONSE_BANKS } from '@/lib/bankResponses'

const BANK_SLUGS = new Set<string>(RESPONSE_BANKS.map((b) => b.slug))
const SOURCES = new Set(['email', 'api', 'platform', 'sheet', 'manual', 'backfill'])
const MATCH = new Set(['matched', 'unmatched', 'ambiguous'])
const STATUS = new Set(['processed', 'error', 'manual_review'])

const str = (v: unknown, max = 2000): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s && s !== 'null' && s !== 'undefined' ? s.slice(0, max) : null
}
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const obj = (v: unknown): Record<string, unknown> | null => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

function toRow(input: Record<string, unknown>): { row?: Record<string, unknown>; error?: string } {
  const bank_slug = str(input.bank_slug, 64)
  const external_id = str(input.external_id, 256)
  if (!bank_slug || !BANK_SLUGS.has(bank_slug)) return { error: `bank_slug inválido: ${bank_slug}` }
  if (!external_id) return { error: 'external_id obligatorio' }

  const source = str(input.source, 16) ?? 'email'
  const general_deal_id = int(input.general_deal_id)
  const bank_deal_id = int(input.bank_deal_id)
  const receivedAt = str(input.received_at, 64)
  const received_at = receivedAt && !isNaN(Date.parse(receivedAt)) ? new Date(receivedAt).toISOString() : undefined

  const matchRaw = str(input.match_status, 16)
  const match_status = matchRaw && MATCH.has(matchRaw) ? matchRaw : bank_deal_id ? 'matched' : 'unmatched'
  const statusRaw = str(input.status, 16)
  const status = statusRaw && STATUS.has(statusRaw) ? statusRaw : input.error_message ? 'error' : 'processed'

  return {
    row: {
      bank_slug,
      source: SOURCES.has(source) ? source : 'email',
      external_id,
      thread_id: str(input.thread_id, 256),
      ...(received_at && { received_at }),
      subject: str(input.subject, 500),
      from_email: str(input.from_email, 320),
      general_deal_id,
      bank_deal_id,
      client_name: str(input.client_name, 200),
      resolved_by: str(input.resolved_by, 32),
      match_status,
      classification: normalizeClassification(input.classification),
      summary: str(input.summary, 4000),
      required_action: str(input.required_action, 2000),
      lost_reason: str(input.lost_reason, 300),
      offer: obj(input.offer),
      raw_extraction: obj(input.raw_extraction),
      status,
      error_step: str(input.error_step, 200),
      error_message: str(input.error_message, 2000),
      pipedrive_actions: Array.isArray(input.pipedrive_actions) ? input.pipedrive_actions : [],
      workflow_id: str(input.workflow_id, 64),
      execution_id: str(input.execution_id, 64),
    },
  }
}

export async function POST(req: Request) {
  const secret = process.env.OFFERS_API_SECRET
  if (!secret || req.headers.get('x-offers-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const inputs = (obj(body)?.responses as unknown[] | undefined) ?? [body]
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 200) {
    return NextResponse.json({ error: 'Se esperan entre 1 y 200 respuestas' }, { status: 400 })
  }

  const rows: Record<string, unknown>[] = []
  const errors: string[] = []
  inputs.forEach((input, i) => {
    const r = obj(input)
    if (!r) return errors.push(`[${i}] no es un objeto`)
    const { row, error } = toRow(r)
    if (error) errors.push(`[${i}] ${error}`)
    else rows.push(row!)
  })

  if (rows.length === 0) {
    return NextResponse.json({ saved: 0, errors }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // No pisar la revisión manual hecha en el Command Center si n8n reprocesa el mismo correo
  const { data: reviewed } = await supabase
    .from('bank_responses')
    .select('source, external_id, resolved_by')
    .in('external_id', rows.map((r) => r.external_id as string))
    .not('reviewed_at', 'is', null)
  for (const prev of reviewed ?? []) {
    const row = rows.find((r) => r.source === prev.source && r.external_id === prev.external_id)
    if (!row) continue
    delete row.status
    if (prev.resolved_by === 'manual') {
      delete row.bank_deal_id
      delete row.match_status
      delete row.resolved_by
    }
  }

  const { data, error } = await supabase
    .from('bank_responses')
    .upsert(rows, { onConflict: 'source,external_id' })
    .select('id, external_id')

  if (error) {
    console.error('[bank-responses] upsert error:', error)
    return NextResponse.json({ error: 'Error al guardar', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ saved: data?.length ?? 0, ids: data, errors: errors.length ? errors : undefined })
}
