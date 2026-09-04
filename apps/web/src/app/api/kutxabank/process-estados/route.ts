/**
 * POST /api/kutxabank/process-estados
 *
 * Processes rows from the Kutxabank "Ops. Enviadas" Excel.
 * Columns (0-indexed):
 *   A(0): ID (general deal_id)
 *   B(1): DNI
 *   C(2): Estado actual Rastreator
 *   D(3): Otros comentarios
 *
 * Stage mapping (bank deal, pipeline 7):
 *   "Pendiente de envío a Kutxabank" → 70 (BS)
 *   "Enviado a Kutxabank"            → 70 (BS)
 *   "Pendiente de llamada"           → no change
 *   "Oferta recibida"                → 71 (BoR)
 *   "Solicitan más doc."             → no change
 *   "Tasación"                       → 72 (Valuation)
 *   "Riesgos"                        → 72 (Valuation)
 *   "Aprobada por Riesgos"           → 73 (FEIN)
 *   "Pendiente de FEIN"              → 73 (FEIN)
 *   "FEIN emitida"                   → 74 (Notary Formalization)
 *   "Fechada para firma"             → 74 (Notary Formalization)
 *   "Firmada"                        → status=won, stage 75
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const PIPEDRIVE_TOKEN = process.env.PIPEDRIVE_API_TOKEN!
const PIPEDRIVE_BASE  = 'https://api.pipedrive.com/v1'

// ── Stage map ─────────────────────────────────────────────────────────────────

const STAGE_MAP: Record<string, number | null> = {
  'Pendiente de envío a Kutxabank': 77,
  'Enviado a Kutxabank':            70,
  'Pendiente de llamada':           null,
  'Oferta recibida':                71,
  'Solicitan más doc.':             null,
  'Tasación':                       72,
  'Riesgos':                        72,
  'Aprobada por Riesgos':           73,
  'Pendiente de FEIN':              73,
  'FEIN emitida':                   74,
  'Fechada para firma':             74,
  'Firmada':                        75,
}

const STAGE_NAMES: Record<number, string> = {
  77: 'BS (Pendiente envío)',
  70: 'BS (Enviado)',
  71: 'BoR',
  72: 'Valuation',
  73: 'FEIN',
  74: 'Notary Formalization',
  75: 'Notary Signature (Won)',
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedEstadosRow {
  deal_id:           string  // col A (0)
  dni:               string  // col B (1)
  estado_rastreator: string  // col C (2)
  otros_comentarios: string  // col D (3)
}

interface RowResult {
  deal_id:          string
  dni:              string
  estado:           string
  status:           'processed' | 'skipped' | 'error' | 'no_change'
  detail?:          string
  bank_deal_id?:    number | null
  stage_updated_to?: number
  stage_name?:      string
  marked_won?:      boolean
  note_added?:      boolean
}

// ── Pipedrive helpers ─────────────────────────────────────────────────────────

async function updateDealStage(bankDealId: number, stageId: number, won: boolean): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = { stage_id: stageId }
    if (won) payload.status = 'won'
    const res = await fetch(
      `${PIPEDRIVE_BASE}/deals/${bankDealId}?api_token=${PIPEDRIVE_TOKEN}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    return res.ok
  } catch {
    return false
  }
}

async function addPipedriveNote(dealId: number, content: string): Promise<boolean> {
  try {
    const res = await fetch(`${PIPEDRIVE_BASE}/notes?api_token=${PIPEDRIVE_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: dealId, content }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { rows?: ParsedEstadosRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows requerido' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const results: RowResult[] = []

  for (const row of rows) {
    const dealIdStr  = String(row.deal_id ?? '').trim()
    const estado     = String(row.estado_rastreator ?? '').trim()
    const dni        = String(row.dni ?? '').trim()
    const comentario = String(row.otros_comentarios ?? '').trim()

    if (!estado) {
      results.push({ deal_id: dealIdStr, dni, estado, status: 'skipped', detail: 'Sin estado' })
      continue
    }

    const dealId = parseInt(dealIdStr, 10)
    if (isNaN(dealId) || dealId <= 0) {
      results.push({ deal_id: dealIdStr, dni, estado, status: 'error', detail: 'deal_id inválido' })
      continue
    }

    // Check dedup
    const { data: existing } = await supabase
      .from('kutxabank_estados_processed')
      .select('id')
      .eq('deal_id', dealId)
      .eq('estado_rastreator', estado)
      .single()

    if (existing) {
      results.push({
        deal_id: dealIdStr, dni, estado, status: 'skipped',
        detail: 'Ya procesado (mismo estado)',
      })
      continue
    }

    // Look up submission for bank_deal_id
    const { data: sub } = await supabase
      .from('kutxabank_submissions')
      .select('bank_deal_id')
      .eq('deal_id', dealId)
      .single()

    const bankDealId = sub?.bank_deal_id ?? null
    const result: RowResult = {
      deal_id: dealIdStr, dni, estado, status: 'no_change', bank_deal_id: bankDealId,
    }

    const targetStage = estado in STAGE_MAP ? STAGE_MAP[estado] : undefined
    const isWon = estado === 'Firmada'

    // Update Pipedrive stage if we have a bank deal and a stage to set
    let stageUpdated = false
    if (bankDealId && targetStage !== undefined && targetStage !== null) {
      stageUpdated = await updateDealStage(bankDealId, targetStage, isWon)
      if (stageUpdated) {
        result.stage_updated_to = targetStage
        result.stage_name       = STAGE_NAMES[targetStage] ?? String(targetStage)
        result.marked_won       = isWon
        result.status           = 'processed'
      } else {
        result.status = 'error'
        result.detail = 'Error al actualizar stage en Pipedrive'
      }
    } else if (targetStage === null) {
      // Known estado with no stage change — still record + add note if comentario
      result.status = 'processed'
    } else if (!(estado in STAGE_MAP)) {
      result.status = 'no_change'
      result.detail = `Estado no reconocido: ${estado}`
    }

    // Add note if Otros comentarios has content
    if (bankDealId && comentario) {
      const noteAdded = await addPipedriveNote(
        bankDealId,
        `📊 Kutxabank Estado: ${estado}\n${comentario}`
      )
      result.note_added = noteAdded
    }

    // Record in DB for dedup (even if no stage change, to avoid re-processing)
    if (result.status === 'processed' || result.status === 'no_change') {
      await supabase.from('kutxabank_estados_processed').upsert(
        {
          deal_id:           dealId,
          bank_deal_id:      bankDealId,
          estado_rastreator: estado,
          stage_updated_to:  result.stage_updated_to ?? null,
          marked_won:        result.marked_won ?? false,
          otros_comentarios: comentario || null,
        },
        { onConflict: 'deal_id,estado_rastreator', ignoreDuplicates: false }
      )
    }

    results.push(result)
  }

  const processed = results.filter((r) => r.status === 'processed').length
  const skipped   = results.filter((r) => r.status === 'skipped').length
  const errors    = results.filter((r) => r.status === 'error').length
  const no_change = results.filter((r) => r.status === 'no_change').length

  return NextResponse.json({ total: rows.length, processed, skipped, errors, no_change, results })
}
