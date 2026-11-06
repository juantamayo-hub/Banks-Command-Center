/**
 * POST /api/nuevo-envio/create
 *
 * Appends a new row to the bank's Google Sheet via Apps Script Web App.
 * Does NOT auto-dispatch — just writes the row.
 *
 * Body: {
 *   deal_id:        number,   // Pipedrive general deal ID → col A
 *   nombre_cliente: string,   // → col B
 *   importe:        number,   // → col C
 *   bank_slug:      string,   // which sheet to write to
 *   bank_deal_id:   number,   // Pipedrive banking deal ID → col F
 * }
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ACTIVE_BANKS } from '@/lib/banks'
import { requireAuth } from '@/lib/auth/requireAuth'
import { createAdminClient } from '@/lib/supabase/server'
import { isCcBank, loadDispatchBanks } from '@/lib/dispatch/banks'
import { dispatchRow, isTestMode } from '@/lib/dispatch/engine'
import { isTestDeal } from '@/lib/dispatch/testDeals'

const VALID_SLUGS: Set<string> = new Set(ACTIVE_BANKS.map((b) => b.slug))

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

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
  if (typeof bank_deal_id !== 'number' || !Number.isInteger(bank_deal_id) || bank_deal_id <= 0) {
    return NextResponse.json({ error: '`bank_deal_id` debe ser un entero positivo' }, { status: 400 })
  }

  // Banco con el interruptor en "Command Center": la línea se crea aquí y se envía, sin hoja ni Apps Script
  const db = await createAdminClient()
  const banks = await loadDispatchBanks(db).catch(() => [])
  const ccBank = banks.find((b) => b.banks_slug === bank_slug)
  if (isCcBank(ccBank)) {
    // Staging comparte base con producción: allí solo se crean líneas de deals de prueba (una línea creada en staging
    // para un deal real ocuparía su sitio y producción ya no la enviaría)
    if (process.env.VERCEL_ENV !== 'production' && !isTestDeal(deal_id)) {
      return NextResponse.json({ error: 'Desde staging solo se pueden crear envíos de deals de prueba', code: 'STAGING_REAL_DEAL' }, { status: 409 })
    }
    const { data: existing } = await db.from('sheet_rows').select('id')
      .eq('bank_id', ccBank.bank_id).eq('opportunity_id', deal_id).maybeSingle()
    let rowId = existing?.id as string | undefined
    if (!rowId) {
      const { data: inserted, error } = await db.from('sheet_rows').insert({
        bank_id: ccBank.bank_id, opportunity_id: deal_id, bank_deal_id, nombre_cliente: nombre_cliente.trim(), importe,
        uid: randomUUID(), engine: 'cc', status: 'pending_ready', send_trigger: true,
        timestamp_entry: new Date().toISOString(), dispatch_source: 'nuevo_envio', test_mode: isTestMode(),
      }).select('id').single()
      if (error || !inserted) return NextResponse.json({ error: error?.message ?? 'No se pudo crear la línea' }, { status: 500 })
      rowId = inserted.id as string
    }
    const r = await dispatchRow(db, { rowId, actor: `user:${auth.user.email}`, source: 'nuevo_envio', banks })
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.code === 'WEBHOOK_ERROR' ? 502 : 409 })
    return NextResponse.json({ ok: true, engine: 'cc', row_id: rowId })
  }

  const webAppUrl = process.env.APPS_SCRIPT_WEB_APP_URL
  const secret    = process.env.APPS_SCRIPT_RELAUNCH_SECRET
  if (!webAppUrl || !secret) {
    return NextResponse.json({ error: 'Apps Script no configurado' }, { status: 500 })
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
        bank_deal_id,
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
