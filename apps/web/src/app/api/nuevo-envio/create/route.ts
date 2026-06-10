/**
 * POST /api/nuevo-envio/create
 *
 * Appends a new row to the bank's Google Sheet via Apps Script Web App.
 * Does NOT auto-dispatch — just writes the row.
 *
 * Body: {
 *   deal_id:       number,   // Pipedrive opportunity ID → col A
 *   nombre_cliente: string,  // → col B
 *   importe:       number,   // → col C
 *   bank_slug:     string,   // which sheet to write to
 *   bank_deal_id:  string,   // → col F
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { ACTIVE_BANKS } from '@/lib/banks'

const VALID_SLUGS: Set<string> = new Set(ACTIVE_BANKS.map((b) => b.slug))

export async function POST(req: NextRequest) {
  const webAppUrl = process.env.APPS_SCRIPT_WEB_APP_URL
  const secret    = process.env.APPS_SCRIPT_RELAUNCH_SECRET
  if (!webAppUrl || !secret) {
    return NextResponse.json({ error: 'Apps Script no configurado' }, { status: 500 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { deal_id, nombre_cliente, importe, bank_slug, bank_deal_id } =
    (body ?? {}) as Record<string, unknown>

  if (typeof deal_id !== 'number' || !Number.isInteger(deal_id) || deal_id <= 0) {
    return NextResponse.json({ error: '`deal_id` debe ser entero positivo' }, { status: 400 })
  }
  if (typeof nombre_cliente !== 'string' || nombre_cliente.trim() === '') {
    return NextResponse.json({ error: '`nombre_cliente` requerido' }, { status: 400 })
  }
  if (typeof importe !== 'number' || !isFinite(importe) || importe <= 0) {
    return NextResponse.json({ error: '`importe` debe ser número positivo' }, { status: 400 })
  }
  if (typeof bank_slug !== 'string' || !VALID_SLUGS.has(bank_slug as string)) {
    return NextResponse.json({ error: '`bank_slug` inválido' }, { status: 400 })
  }
  if (typeof bank_deal_id !== 'string' || bank_deal_id.trim() === '') {
    return NextResponse.json({ error: '`bank_deal_id` requerido' }, { status: 400 })
  }

  const res = await fetch(webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      action: 'APPEND_ROW',
      bank_slug,
      row_data: {
        opportunity_id: deal_id,
        nombre_cliente: nombre_cliente.trim(),
        importe,
        bank_deal_id: bank_deal_id.trim(),
      },
    }),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok || data?.ok === false) {
    return NextResponse.json(
      { error: data?.error ?? `Error Apps Script: ${res.status}` },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true })
}
