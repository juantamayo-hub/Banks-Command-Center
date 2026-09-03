/**
 * POST /api/kutxabank/process-envios
 *
 * Processes rows from the Kutxabank "1 Filtro" Excel.
 * Columns (0-indexed):
 *   A(0): ID (general deal_id)
 *   B(1): DNI
 *   C(2): Importe compraventa
 *   D(3): Importe hipoteca
 *   E(4): Ingresos 1T
 *   F(5): Tipo contrato 1T
 *   G(6): Ingresos 2T
 *   H(7): Tipo contrato 2T
 *   I(8): Respuesta Rastreator ("Enviar" / "No enviar" / empty)
 *
 * "Enviar"    → update rastreator_status='approved' in Supabase
 *             → call Apps Script to sync Google Sheet
 * "No enviar" → mark bank deal as lost in Pipedrive (reason 3144)
 *             → update rastreator_status='rejected' in Supabase
 *             → add Pipedrive note
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const PIPEDRIVE_TOKEN = process.env.PIPEDRIVE_API_TOKEN!
const PIPEDRIVE_BASE  = 'https://api.pipedrive.com/v1'

// "401- DUPLICADO CON OTRO BROKER"
const LOST_REASON_ID    = 3144
const LOST_REASON_FIELD = '5af7c8a4d8341bfe53526b6a7b4e2fc793503a90'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedEnviosRow {
  deal_id:            string   // col A (0) — general deal_id
  dni:                string   // col B (1)
  importe_compra:     string   // col C (2)
  importe_hipoteca:   string   // col D (3)
  ingresos_1t:        string   // col E (4)
  tipo_contrato_1t:   string   // col F (5)
  ingresos_2t:        string   // col G (6)
  tipo_contrato_2t:   string   // col H (7)
  respuesta:          string   // col I (8) — "Enviar" / "No enviar" / ""
}

interface RowResult {
  deal_id:     string
  dni:         string
  respuesta:   string
  status:      'approved' | 'rejected' | 'skipped' | 'error'
  detail?:     string
  bank_deal_id?: number | null
}

// ── Pipedrive helpers ─────────────────────────────────────────────────────────

async function getBankDealId(generalDealId: number): Promise<number | null> {
  try {
    const res = await fetch(
      `${PIPEDRIVE_BASE}/deals/${generalDealId}?api_token=${PIPEDRIVE_TOKEN}`
    )
    if (!res.ok) return null
    const json = await res.json()
    // bank_deal_id is a custom field — look for linked deal in pipeline 7
    // We use the stored value in kutxabank_submissions first
    return json?.data?.id ?? null
  } catch {
    return null
  }
}

async function markDealLost(bankDealId: number): Promise<boolean> {
  try {
    const res = await fetch(
      `${PIPEDRIVE_BASE}/deals/${bankDealId}?api_token=${PIPEDRIVE_TOKEN}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'lost',
          [LOST_REASON_FIELD]: LOST_REASON_ID,
        }),
      }
    )
    return res.ok
  } catch {
    return false
  }
}

async function addPipedriveNote(dealId: number, content: string): Promise<void> {
  try {
    await fetch(`${PIPEDRIVE_BASE}/notes?api_token=${PIPEDRIVE_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: dealId, content }),
    })
  } catch {
    // non-fatal
  }
}

// ── Apps Script sync ──────────────────────────────────────────────────────────

async function syncToSheet(rows: Array<{ deal_id: string; dni: string }>): Promise<void> {
  const url    = process.env.APPS_SCRIPT_WEB_APP_URL
  const secret = process.env.APPS_SCRIPT_RELAUNCH_SECRET
  if (!url || !secret) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        action: 'KUTXA_SYNC_ENVIOS',
        rows,
      }),
    })
  } catch {
    // non-fatal
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { rows?: ParsedEnviosRow[] }
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

  // Collect "Enviar" rows for Sheet sync
  const approvedForSync: Array<{ deal_id: string; dni: string }> = []

  for (const row of rows) {
    const dealIdStr  = String(row.deal_id ?? '').trim()
    const respuesta  = String(row.respuesta ?? '').trim()
    const dni        = String(row.dni ?? '').trim()

    // Skip rows without respuesta
    if (!respuesta || (respuesta !== 'Enviar' && respuesta !== 'No enviar')) {
      results.push({ deal_id: dealIdStr, dni, respuesta, status: 'skipped', detail: 'Sin respuesta' })
      continue
    }

    const dealId = parseInt(dealIdStr, 10)
    if (isNaN(dealId) || dealId <= 0) {
      results.push({ deal_id: dealIdStr, dni, respuesta, status: 'error', detail: 'deal_id inválido' })
      continue
    }

    // Look up submission in Supabase
    const { data: sub } = await supabase
      .from('kutxabank_submissions')
      .select('id, bank_deal_id, rastreator_status')
      .eq('deal_id', dealId)
      .single()

    if (respuesta === 'Enviar') {
      // Mark as approved
      if (sub) {
        await supabase
          .from('kutxabank_submissions')
          .update({ rastreator_status: 'approved' })
          .eq('deal_id', dealId)
      }
      approvedForSync.push({ deal_id: dealIdStr, dni })
      results.push({
        deal_id: dealIdStr,
        dni,
        respuesta,
        status: 'approved',
        bank_deal_id: sub?.bank_deal_id ?? null,
      })
    } else {
      // "No enviar" → mark rejected + mark Pipedrive deal as lost
      let lostOk = false
      const bankDealId = sub?.bank_deal_id ?? null

      if (bankDealId) {
        lostOk = await markDealLost(bankDealId)
        if (lostOk) {
          await addPipedriveNote(
            bankDealId,
            `❌ Kutxabank — Rastreator rechazó el envío\nDNI: ${dni}\nDeal general: ${dealId}`
          )
        }
      }

      if (sub) {
        await supabase
          .from('kutxabank_submissions')
          .update({ rastreator_status: 'rejected' })
          .eq('deal_id', dealId)
      }

      results.push({
        deal_id: dealIdStr,
        dni,
        respuesta,
        status: 'rejected',
        bank_deal_id: bankDealId,
        detail: bankDealId
          ? (lostOk ? 'Marcado como perdido en Pipedrive' : 'Error al marcar en Pipedrive')
          : 'Sin bank_deal_id — no se pudo marcar en Pipedrive',
      })
    }
  }

  // Sync approved rows to Google Sheet (non-blocking)
  if (approvedForSync.length > 0) {
    void syncToSheet(approvedForSync)
  }

  const approved = results.filter((r) => r.status === 'approved').length
  const rejected = results.filter((r) => r.status === 'rejected').length
  const skipped  = results.filter((r) => r.status === 'skipped').length
  const errors   = results.filter((r) => r.status === 'error').length

  return NextResponse.json({ total: rows.length, approved, rejected, skipped, errors, results })
}
