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
 *   "Denegada LTV"                   → status=lost, 302- DENEGADO - LTV
 *   "Denegada endeudamiento"         → status=lost, 303- DENEGADO - ENDEUDAMIENTO
 *   "Denegada perfil"                → status=lost, 304- DENEGADO - PERFIL DEL CLIENTE
 *
 * Nunca retrocede: solo avanza si la etapa destino va después de la actual
 * (según STAGE_ORDER) y nunca toca deals ya ganados/perdidos.
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

// Orden de etapas del pipeline 7 (Pipedrive order_nr)
const STAGE_ORDER: Record<number, number> = { 77: 1, 70: 2, 71: 3, 79: 4, 72: 5, 73: 6, 74: 7, 75: 8 }

// Denegaciones → deal bancario lost con motivo ([Bayteca] Lost reason in Bank_area)
const BANK_LOST_REASON_FIELD = '5af7c8a4d8341bfe53526b6a7b4e2fc793503a90'
const DENIAL_MAP: Record<string, { optionId: number; label: string }> = {
  'Denegada LTV':           { optionId: 3137, label: '302- DENEGADO - LTV (FASE BANCARIA)' },
  'Denegada endeudamiento': { optionId: 3138, label: '303- DENEGADO - ENDEUDAMIENTO (FASE BANCARIA)' },
  'Denegada perfil':        { optionId: 3139, label: '304- DENEGADO - PERFIL DEL CLIENTE (FASE BANCARIA)' },
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
  marked_lost?:     boolean
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

async function getDeal(bankDealId: number): Promise<{ stage_id: number; status: string } | null> {
  try {
    const res = await fetch(`${PIPEDRIVE_BASE}/deals/${bankDealId}?api_token=${PIPEDRIVE_TOKEN}`)
    if (!res.ok) return null
    const json = await res.json()
    return json?.data ? { stage_id: json.data.stage_id, status: json.data.status } : null
  } catch {
    return null
  }
}

async function markDealLost(bankDealId: number, denial: { optionId: number; label: string }): Promise<boolean> {
  try {
    const res = await fetch(`${PIPEDRIVE_BASE}/deals/${bankDealId}?api_token=${PIPEDRIVE_TOKEN}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'lost',
        lost_reason: denial.label,
        [BANK_LOST_REASON_FIELD]: denial.optionId,
      }),
    })
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

    const denial = DENIAL_MAP[estado]
    let targetStage = estado in STAGE_MAP ? STAGE_MAP[estado] : undefined
    const isWon = estado === 'Firmada'

    // Estado actual del deal bancario: nunca retroceder ni tocar deals cerrados
    const current = bankDealId && (denial || (targetStage !== undefined && targetStage !== null))
      ? await getDeal(bankDealId)
      : null
    if (current && current.status !== 'open') {
      result.status = 'no_change'
      result.detail = `Deal bancario ya ${current.status === 'won' ? 'ganado' : 'perdido'}: no se modifica`
      targetStage = null
    } else if (current && targetStage && (STAGE_ORDER[targetStage] ?? 0) <= (STAGE_ORDER[current.stage_id] ?? 0)) {
      result.status = 'no_change'
      result.detail = `No retrocede: ya está en ${STAGE_NAMES[current.stage_id] ?? current.stage_id}`
      targetStage = null
    }

    // Update Pipedrive stage if we have a bank deal and a stage to set
    let stageUpdated = false
    if (bankDealId && denial && (!current || current.status === 'open')) {
      if (await markDealLost(bankDealId, denial)) {
        result.status      = 'processed'
        result.marked_lost = true
        result.detail      = denial.label
      } else {
        result.status = 'error'
        result.detail = 'Error al marcar lost en Pipedrive'
      }
    } else if (bankDealId && targetStage !== undefined && targetStage !== null) {
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
    } else if (targetStage === null && !result.detail) {
      // Known estado with no stage change — still record + add note if comentario
      result.status = 'processed'
    } else if (!(estado in STAGE_MAP) && !denial) {
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
