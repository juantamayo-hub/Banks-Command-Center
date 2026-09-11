/**
 * POST /api/kutxabank/process-envios
 *
 * Processes rows from the Kutxabank "1 Filtro" Excel.
 * Columns (0-indexed):
 *   A(0): ID (deal_id — general or bank)
 *   B(1): DNI 1T
 *   C(2): DNI 2T
 *   D(3): Importe compraventa
 *   E(4): Importe hipoteca
 *   F(5): Ingresos 1T
 *   G(6): Tipo contrato 1T
 *   H(7): Ingresos 2T
 *   I(8): Tipo contrato 2T
 *   J(9): Respuesta Rastreator ("Enviar" / "No enviar" / empty)
 *
 * "Enviar"    → update rastreator_status='approved' in Supabase (enriched from Pipedrive)
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

// ── Kutxabank Bank 1–5 detection (same IDs as n8n ZIP Creator) ──────────────
const KUTXA_OPTION_IDS = [2633, 2651, 2669, 2687, 2705]
const BANK_FIELD_IDS = [
  'af536dbfe7d00fd441ae9bd4b144c25bc1d4c725',
  '8e4b44a3f3973d1f524f8cd0ec6f6babe9e96965',
  'ed0a30972778ac2c3d29cab53e27a89f5b52a1b2',
  '9049591570e78d3274a72cfb7a28076789ce0676',
  '36ff3525fb8a73637e069099967b2afe164e408a',
]
const BANK_ID_FIELD_IDS = [
  '04d666f12e4d27a3867daa5d7d6b777d76d24eb9',
  '75d8963d89d47daf37349722c531677263173484',
  '874add027adde7fa7690874e3bac581489387651',
  '467feaa56488620159ef39890e6d8f96489bdbac',
  'b3dfef96dce320a1cfa4605056757f7e79731676',
]
const BANK_LINK_FIELD_IDS = [
  'fc8312a76b8fe194ba55b60f3e09ac7e7800a5bd',
  'd78cdb37e370d21facdea787f4bd7a22520ac62d',
  'b3b1fd8fba90a455d01fb4aa4805569d4b60070a',
  '9a4d771432722d30f6e4abe8f0cee6a542793475',
  '963244c4d383295066674c693d813b4abb27ae11',
]
const DRIVE_FOLDER_FIELD = 'c2ea08d72de437ee4957ff3807c48cebe7a1aa3e'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedEnviosRow {
  deal_id:            string   // col A (0)
  dni:                string   // col B (1) — DNI 1T
  dni_2t:             string   // col C (2) — DNI 2T
  importe_compra:     string   // col D (3)
  importe_hipoteca:   string   // col E (4)
  ingresos_1t:        string   // col F (5)
  tipo_contrato_1t:   string   // col G (6)
  ingresos_2t:        string   // col H (7)
  tipo_contrato_2t:   string   // col I (8)
  respuesta:          string   // col J (9) — "Enviar" / "No enviar" / ""
}

interface RowResult {
  deal_id:     string
  dni:         string
  respuesta:   string
  status:      'approved' | 'rejected' | 'skipped' | 'error'
  detail?:     string
  bank_deal_id?: number | null
}

interface DealContext {
  generalDealId: number
  bankDealId: number | null
  nombreCliente: string | null
  plan: string | null
  driveFolderId: string | null
}

// ── Pipedrive helpers ─────────────────────────────────────────────────────────

function rawScalar(raw: unknown): string | number {
  if (raw === null || raw === undefined) return ''
  if (typeof raw !== 'object') return raw as string | number
  const obj = raw as Record<string, unknown>
  return (obj.id ?? obj.value ?? obj.label ?? obj.name ?? obj.url ?? '') as string | number
}

function enumId(raw: unknown): number | null {
  const scalar = rawScalar(raw)
  const n = parseInt(String(scalar).trim(), 10)
  return Number.isFinite(n) ? n : null
}

function parseBankDealId(raw: unknown): number | null {
  if (raw == null) return null
  const scalar = rawScalar(raw)
  const str = String(scalar).trim()
  if (!str) return null
  if (/^\d+$/.test(str)) {
    const id = parseInt(str, 10)
    return id > 0 ? id : null
  }
  const m = str.match(/\/deal\/(\d+)/i) || str.match(/[?&](?:deal_?id|id)=(\d+)/i)
  if (!m) return null
  const id = parseInt(m[1], 10)
  return Number.isFinite(id) && id > 0 ? id : null
}

function parseDriveFolderId(raw: string): string | null {
  const str = String(raw ?? '').trim()
  if (!str) return null
  const fm = str.match(/\/folders\/([a-zA-Z0-9_-]+)/i)
  if (fm) return fm[1]
  const im = str.match(/[?&]id=([a-zA-Z0-9_-]+)/i)
  if (im) return im[1]
  if (/^[a-zA-Z0-9_-]{10,}$/.test(str)) return str
  return null
}

async function fetchDeal(dealId: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${PIPEDRIVE_BASE}/deals/${dealId}?api_token=${PIPEDRIVE_TOKEN}`)
    if (!res.ok) return null
    const json = await res.json()
    return json?.data ?? null
  } catch {
    return null
  }
}

/** Resolve general deal ID, bank deal ID, and client info from Pipedrive */
async function resolveDealContext(excelDealId: number): Promise<DealContext | null> {
  const deal = await fetchDeal(excelDealId)
  if (!deal) return null

  // Try to find Kutxabank in Bank 1–5
  let bankDealId: number | null = null
  for (let i = 0; i < BANK_FIELD_IDS.length; i++) {
    const raw = deal[BANK_FIELD_IDS[i]]
    const id = enumId(raw)
    const label = String(rawScalar(raw)).toLowerCase()
    if (id === KUTXA_OPTION_IDS[i] || label.includes('kutxabank')) {
      bankDealId =
        parseBankDealId(deal[BANK_ID_FIELD_IDS[i]]) ??
        parseBankDealId(deal[BANK_LINK_FIELD_IDS[i]])
      break
    }
  }

  const driveUrl = String(deal[DRIVE_FOLDER_FIELD] ?? '')
  const driveFolderId = parseDriveFolderId(driveUrl)
  const nombreCliente = (deal.person_name as string) || null
  const plan = (deal['b5d36c005e38a4cd72d831be655996a3d6b34dc1'] as string) || null

  // If we found Bank 1–5 fields, this IS the general deal
  if (bankDealId) {
    return {
      generalDealId: excelDealId,
      bankDealId,
      nombreCliente,
      plan,
      driveFolderId,
    }
  }

  // Maybe excelDealId IS the bank deal — check if it's in a bank pipeline
  // Bank deals don't have Bank 1–5 fields. Return with bankDealId = excelDealId
  // and generalDealId unknown (we'll try to find the submission by bank_deal_id)
  return {
    generalDealId: excelDealId, // fallback, may be overridden by submission lookup
    bankDealId: null,
    nombreCliente,
    plan,
    driveFolderId,
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

async function syncToSheet(rows: Array<{ deal_id: string; dni: string; respuesta: string }>): Promise<void> {
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
  const rowsForSync: Array<{ deal_id: string; dni: string; respuesta: string }> = []

  for (const row of rows) {
    const dealIdStr  = String(row.deal_id ?? '').trim()
    const respuesta  = String(row.respuesta ?? '').trim()
    const dni        = String(row.dni ?? '').trim()

    // Skip rows without respuesta
    if (!respuesta || (respuesta !== 'Enviar' && respuesta !== 'No enviar')) {
      results.push({ deal_id: dealIdStr, dni, respuesta, status: 'skipped', detail: 'Sin respuesta' })
      continue
    }

    const excelDealId = parseInt(dealIdStr, 10)
    if (isNaN(excelDealId) || excelDealId <= 0) {
      results.push({ deal_id: dealIdStr, dni, respuesta, status: 'error', detail: 'deal_id inválido' })
      continue
    }

    // ── 1. Find existing submission ──────────────────────────────────────────
    // Try by deal_id first, then by bank_deal_id (Excel may have either)
    let { data: sub } = await supabase
      .from('kutxabank_submissions')
      .select('id, deal_id, bank_deal_id, nombre_cliente, plan, drive_folder_id, zip_file_id, zip_drive_link, rastreator_status')
      .eq('deal_id', excelDealId)
      .single()

    if (!sub) {
      const { data: subByBank } = await supabase
        .from('kutxabank_submissions')
        .select('id, deal_id, bank_deal_id, nombre_cliente, plan, drive_folder_id, zip_file_id, zip_drive_link, rastreator_status')
        .eq('bank_deal_id', excelDealId)
        .single()
      if (subByBank) sub = subByBank
    }

    // ── 2. Resolve deal context from Pipedrive ──────────────────────────────
    const ctx = await resolveDealContext(excelDealId)

    // Determine the correct IDs
    const generalDealId = sub?.deal_id ?? ctx?.generalDealId ?? excelDealId
    const bankDealId = sub?.bank_deal_id ?? ctx?.bankDealId ??
      (sub && sub.deal_id !== excelDealId ? excelDealId : null)

    // Enrich fields: prefer existing submission data, fill gaps from Pipedrive
    const nombreCliente = sub?.nombre_cliente ?? ctx?.nombreCliente ?? null
    const plan = sub?.plan ?? ctx?.plan ?? null
    const driveFolderId = sub?.drive_folder_id ?? ctx?.driveFolderId ?? null

    // ── 3. Process ──────────────────────────────────────────────────────────
    if (respuesta === 'Enviar') {
      const { data: upserted } = await supabase
        .from('kutxabank_submissions')
        .upsert(
          {
            deal_id: generalDealId,
            bank_deal_id: bankDealId,
            nombre_cliente: nombreCliente,
            plan,
            drive_folder_id: driveFolderId,
            dni: dni || null,
            rastreator_status: 'approved',
            ...(sub ? {} : { missing_docs: [] }),
          },
          { onConflict: 'deal_id' }
        )
        .select('bank_deal_id')
        .single()

      rowsForSync.push({ deal_id: dealIdStr, dni, respuesta: 'Enviar' })
      results.push({
        deal_id: dealIdStr,
        dni,
        respuesta,
        status: 'approved',
        bank_deal_id: upserted?.bank_deal_id ?? bankDealId,
      })
    } else {
      // "No enviar" → mark rejected + mark Pipedrive deal as lost
      let lostOk = false
      const effectiveBankDealId = bankDealId ?? (sub && sub.deal_id !== excelDealId ? excelDealId : null)

      if (effectiveBankDealId) {
        lostOk = await markDealLost(effectiveBankDealId)
        if (lostOk) {
          await addPipedriveNote(
            effectiveBankDealId,
            `❌ Kutxabank — Rastreator rechazó el envío\nDNI: ${dni}\nDeal general: ${generalDealId}`
          )
        }
      }

      await supabase
        .from('kutxabank_submissions')
        .upsert(
          {
            deal_id: generalDealId,
            bank_deal_id: effectiveBankDealId,
            nombre_cliente: nombreCliente,
            plan,
            drive_folder_id: driveFolderId,
            dni: dni || null,
            rastreator_status: 'rejected',
            ...(sub ? {} : { missing_docs: [] }),
          },
          { onConflict: 'deal_id' }
        )

      rowsForSync.push({ deal_id: dealIdStr, dni, respuesta: 'No enviar' })
      results.push({
        deal_id: dealIdStr,
        dni,
        respuesta,
        status: 'rejected',
        bank_deal_id: effectiveBankDealId,
        detail: effectiveBankDealId
          ? (lostOk ? 'Marcado como perdido en Pipedrive' : 'Error al marcar en Pipedrive')
          : 'Sin bank_deal_id — no se pudo marcar en Pipedrive',
      })
    }
  }

  // Sync rows to Google Sheet (non-blocking)
  if (rowsForSync.length > 0) {
    void syncToSheet(rowsForSync)
  }

  const approved = results.filter((r) => r.status === 'approved').length
  const rejected = results.filter((r) => r.status === 'rejected').length
  const skipped  = results.filter((r) => r.status === 'skipped').length
  const errors   = results.filter((r) => r.status === 'error').length

  return NextResponse.json({ total: rows.length, approved, rejected, skipped, errors, results })
}
