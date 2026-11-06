/**
 * Solo servidor. Motor de envío del Command Center (bancos con bank_config.dispatch_engine = 'cc').
 *
 *   dispatchRow()           → claim_dispatch (reserva atómica: status → sending) + POST al webhook n8n del banco.
 *                             Si n8n no contesta 2xx, la línea pasa a 'failed' al momento con el motivo.
 *   createRowsForDossier()  → dossier listo: crea la línea por banco (solo bancos en 'cc') y la envía sola.
 *
 * El resultado final (enviado / bloqueado / falló) lo informa n8n en /api/dispatch/report.
 * Modo prueba: líneas de prueba (sheet_rows.test_mode, también en producción), fuera de producción SIEMPRE o con
 * DISPATCH_FORCE_TEST_MODE=true. En modo prueba n8n desvía el correo a quien pulsó (o al email de prueba).
 */

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSendPayload, type PayloadRow } from './payload'
import { isCcBank, isDispatchableBank, loadDispatchBanks, resolveDispatchBank, type DispatchBank } from './banks'
import { getGeneralDeal } from './pipedriveDeal'
import { isTestDeal } from './testDeals'

const N8N_WEBHOOK_BASE = 'https://huspy.app.n8n.cloud/webhook'
const ROW_SELECT =
  'id, uid, bank_id, opportunity_id, bank_deal_id, nombre_cliente, importe, link_dossier, timestamp_entry, autorizacion, ' +
  'autorizacion_red_flag, status, status_raw, red_flags_raw, clasificacion, dossier, auto_bayteca, auto_banco, notas, ' +
  'test_time, process_status, owner, engine, test_mode'

export function isTestMode(): boolean {
  if ((process.env.DISPATCH_FORCE_TEST_MODE || '').toLowerCase() === 'true') return true
  return process.env.VERCEL_ENV !== 'production'
}

/**
 * URL pública de este Command Center, para que n8n informe al mismo entorno que lanzó el envío.
 * En producción devuelve null: n8n usa su $vars.COMMAND_CENTER_URL (producción). Así, aunque
 * COMMAND_CENTER_PUBLIC_URL se configure por error también en Production, un envío real nunca informa a staging.
 */
export function reportBaseUrl(): string | null {
  if (process.env.VERCEL_ENV === 'production') return null
  const explicit = process.env.COMMAND_CENTER_PUBLIC_URL
  if (explicit) return explicit.replace(/\/$/, '')
  // Alias fijo de la rama staging: es el que n8n tiene en su lista ($vars.COMMAND_CENTER_STAGING_URL)
  if (process.env.VERCEL_GIT_COMMIT_REF === 'staging') return 'https://staging-banks-command-center.vercel.app'
  return process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : null
}

export type DispatchAction = 'ENVIAR' | 'AUTORIZACION'

export type DispatchResult =
  | { ok: true; previous_status: string | null; attempt: number }
  | { ok: false; code: string; error: string; current_status?: string }

export async function dispatchRow(
  db: SupabaseClient,
  args: { rowId: string; action?: DispatchAction; force?: boolean; actor: string; source: 'auto' | 'manual' | 'nuevo_envio'; banks?: DispatchBank[] },
): Promise<DispatchResult> {
  const action = args.action ?? 'ENVIAR'
  const force = args.force === true

  const { data: rowRaw, error: rowErr } = await db.from('sheet_rows').select(ROW_SELECT).eq('id', args.rowId).single()
  if (rowErr || !rowRaw) return { ok: false, code: 'NOT_FOUND', error: 'Línea no encontrada' }
  const row = rowRaw as unknown as PayloadRow & { bank_id: number; engine: string; test_mode: boolean }

  const banks = args.banks ?? (await loadDispatchBanks(db))
  const bank = banks.find((b) => b.bank_id === row.bank_id)
  // Líneas de prueba (test_mode en un deal de prueba, ver testDeals.ts): salen siempre en modo prueba —el correo va a
  // quien pulsa, nunca al banco— aunque el banco siga en "Hoja"; así se prueba en producción antes de activarlo.
  // Fuera de producción solo se envían líneas de prueba: staging comparte base y nunca debe tocar una línea real.
  const testRow = row.test_mode === true && isTestDeal(row.opportunity_id)
  if (!testRow && process.env.VERCEL_ENV !== 'production') {
    return { ok: false, code: 'STAGING_REAL_ROW', error: 'Desde staging solo se pueden enviar líneas de prueba' }
  }
  if (!isDispatchableBank(bank) || (!testRow && !isCcBank(bank))) {
    return { ok: false, code: 'NOT_CC', error: 'Este banco se envía todavía por la hoja (interruptor en "Hoja")' }
  }

  // Datos que faltaban al crear la línea (p. ej. "Importe Banco N" rellenado después): se releen del deal general.
  // El importe es imprescindible: n8n busca el dossier en Drive por "<importe>€<expediente>".
  if (!row.importe || !row.bank_deal_id) {
    try {
      const deal = await getGeneralDeal(row.opportunity_id)
      const slot = deal?.slots.find((s) => resolveDispatchBank(banks, s.bank_name)?.bank_slug === bank.bank_slug)
      const patch: Record<string, unknown> = {}
      if (!row.importe && slot?.importe) patch.importe = row.importe = slot.importe
      if (!row.bank_deal_id && slot?.bank_deal_id) patch.bank_deal_id = row.bank_deal_id = slot.bank_deal_id
      if (Object.keys(patch).length) await db.from('sheet_rows').update(patch).eq('id', row.id)
    } catch (e) {
      console.error('[dispatch] relectura de Pipedrive', row.id, e)
    }
  }

  const { data: claim, error: claimErr } = await db.rpc('claim_dispatch', {
    p_row_id: row.id,
    p_action: action,
    p_force: force,
    p_actor: args.actor,
    p_source: args.source,
  })
  if (claimErr) return { ok: false, code: 'DB_ERROR', error: claimErr.message }
  const c = claim as { ok: boolean; code?: string; error?: string; current_status?: string; previous_status?: string | null; attempt?: number }
  if (!c.ok) return { ok: false, code: c.code ?? 'BLOCKED', error: c.error ?? 'No se pudo reservar el envío', current_status: c.current_status }

  const testMode = testRow || isTestMode()
  const base = reportBaseUrl()
  const payload = buildSendPayload(row, {
    action,
    prefix: bank.send_payload_prefix || bank.bank_slug,
    force,
    testMode,
    reportUrl: base ? `${base}/api/dispatch/report` : null,
    // Líneas de prueba: el correo va a quien pulsó (n8n solo lo acepta si es una dirección @huspy.io / @bayteca.com).
    // Nunca en otra línea: con DISPATCH_FORCE_TEST_MODE un dossier real iría al correo de un empleado
    testRecipient: testRow && args.actor.startsWith('user:') ? args.actor.slice(5) : null,
  })

  const url = `${N8N_WEBHOOK_BASE}/${bank.send_webhook_path}`
  let failure: string | null = null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) failure = `n8n respondió HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
  } catch (e) {
    failure = `No se pudo contactar con n8n: ${e instanceof Error ? e.message : String(e)}`
  }

  if (failure) {
    await db
      .from('sheet_rows')
      .update({ status: 'failed', last_error: failure, process_status: `Error n8n (${action})` })
      .eq('id', row.id)
      .eq('status', 'sending')
    await db.from('event_log').insert({
      event_type: 'dispatch', sheet_row_id: row.id, bank_id: row.bank_id, opportunity_id: row.opportunity_id,
      actor: args.actor, payload: { result: 'webhook_error', error: failure, action },
    })
    return { ok: false, code: 'WEBHOOK_ERROR', error: failure }
  }

  // test_mode no se guarda aquí: solo lo llevan las líneas de prueba creadas a mano (una línea real nunca se vuelve de prueba)
  await db.from('sheet_rows').update({ process_status: `Enviado a n8n (${action})` }).eq('id', row.id)
  return { ok: true, previous_status: c.previous_status ?? null, attempt: c.attempt ?? 1 }
}

// ── Dossier listo → líneas por banco ─────────────────────────────────────────

export interface DossierReadyInput {
  opportunity_id: number
  dossier_id: string
  link_dossier: string | null
  cliente: string | null
  owner: string | null
  importe: number | null
  bank_names: string[] | null       // bancos de este dossier (si viene vacío: todos los del deal)
  dossier_key: string               // UNICO | A | B | C
  test_mode: boolean
}

export interface LineResult {
  bank: string
  bank_slug: string | null
  result: 'dispatched' | 'dispatch_failed' | 'existing' | 'engine_sheets' | 'not_email' | 'unknown_bank' | 'error'
  row_id?: string
  detail?: string
}

/**
 * Crea/actualiza las líneas de envío del dossier. Devuelve las líneas nuevas que hay que lanzar
 * (la llamada a n8n se hace fuera, en waitUntil, para responder rápido al generador).
 */
export async function createRowsForDossier(
  db: SupabaseClient,
  input: DossierReadyInput,
): Promise<{ results: LineResult[]; toDispatch: string[]; banks: DispatchBank[] }> {
  const banks = await loadDispatchBanks(db)
  // Staging comparte base con producción: allí solo se crean líneas de deals de prueba
  if (process.env.VERCEL_ENV !== 'production' && !isTestDeal(input.opportunity_id)) return { results: [], toDispatch: [], banks }
  const deal = await getGeneralDeal(input.opportunity_id)
  if (!deal) throw new Error(`El deal ${input.opportunity_id} no existe en Pipedrive`)

  const wanted = input.bank_names?.length ? new Set(input.bank_names.map((n) => n.trim().toLowerCase())) : null
  // Dossier por tipo (A/B/C = un dossier por importe distinto): solo los bancos con ESE importe. Así un banco no sale
  // antes de que exista su dossier (n8n lo busca en Drive por "<importe>€<expediente>").
  const byImporte = input.dossier_key !== 'UNICO' && input.importe ? Math.round(input.importe) : null
  const slots = deal.slots.filter((s) =>
    (!wanted || wanted.has(s.bank_name.trim().toLowerCase())) &&
    (byImporte === null || (s.importe !== null && Math.round(s.importe) === byImporte)))

  const results: LineResult[] = []
  const toDispatch: string[] = []
  for (const slot of slots) {
    const bank = resolveDispatchBank(banks, slot.bank_name)
    if (!bank) { results.push({ bank: slot.bank_name, bank_slug: null, result: 'unknown_bank' }); continue }
    if (bank.channel !== 'email') { results.push({ bank: slot.bank_name, bank_slug: bank.bank_slug, result: 'not_email' }); continue }
    if (!isCcBank(bank)) { results.push({ bank: slot.bank_name, bank_slug: bank.bank_slug, result: 'engine_sheets' }); continue }

    const common = {
      nombre_cliente: input.cliente || deal.person_name || deal.title || '',
      importe: slot.importe ?? input.importe,
      link_dossier: input.link_dossier,
      bank_deal_id: slot.bank_deal_id,
      owner: input.owner || deal.owner_name,
      dossier_id: input.dossier_id,
      engine: 'cc',
    }

    const { data: existing } = await db
      .from('sheet_rows')
      .select('id, status, uid')
      .eq('bank_id', bank.bank_id)
      .eq('opportunity_id', input.opportunity_id)
      .maybeSingle()

    if (existing) {
      // Igual que el distribuidor de la hoja: si ya hay línea para este banco y deal, no se reenvía sola.
      // Se actualizan los datos del dossier y queda en el CC (Reenviar desde Pendientes si hace falta).
      const { error } = await db.from('sheet_rows')
        .update({ ...common, uid: existing.uid || randomUUID() })
        .eq('id', existing.id)
      results.push({ bank: slot.bank_name, bank_slug: bank.bank_slug, row_id: existing.id as string,
        result: error ? 'error' : 'existing', detail: error?.message ?? `estado actual: ${existing.status}` })
      continue
    }

    const { data: inserted, error } = await db.from('sheet_rows').insert({
      ...common,
      bank_id: bank.bank_id,
      opportunity_id: input.opportunity_id,
      uid: randomUUID(),
      status: 'pending_ready',
      status_raw: null,
      send_trigger: true,
      timestamp_entry: new Date().toISOString(),
      dispatch_source: 'auto',
      test_mode: input.test_mode,
    }).select('id').single()
    if (error || !inserted) {
      results.push({ bank: slot.bank_name, bank_slug: bank.bank_slug, result: 'error', detail: error?.message })
      continue
    }
    toDispatch.push(inserted.id as string)
    results.push({ bank: slot.bank_name, bank_slug: bank.bank_slug, row_id: inserted.id as string, result: 'dispatched' })
  }
  return { results, toDispatch, banks }
}
