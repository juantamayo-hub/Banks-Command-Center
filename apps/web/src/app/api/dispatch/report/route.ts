/**
 * POST /api/dispatch/report — los flujos n8n "Send Dossier" informan del resultado de un envío del CC
 * (sustituye a las escrituras en la hoja). Lo llama el sub-workflow "DOSSIER · Reportar estado (CC)".
 *
 * Body: { item_id (= ITEM ID / sheet_rows.uid) | cc_row_id, status, reason_text?, process_status?, notas?,
 *         red_flags?, timestamp_sent?, dossier?, auto_bayteca?, auto_banco?, execution_id? }
 * status: sending | sent | blocked_red_flag | blocked_missing_docs | blocked_validation | failed
 *
 * Una línea 'sent' no retrocede (un "Procesando" que llega tarde no la devuelve a pendiente). Para reenviar algo ya
 * enviado hay que relanzar con confirmación (claim_dispatch con force, que la vuelve a 'sending').
 * Requiere cabecera x-offers-secret.
 */

import { NextResponse } from 'next/server'
import { hasOffersSecret } from '@/lib/auth/offersSecret'
import { createAdminClient } from '@/lib/supabase/server'
import { classifySheetValues, type SheetValues } from '@/lib/dispatch/classify'

export const dynamic = 'force-dynamic'

const STATUSES = ['sending', 'sent', 'blocked_red_flag', 'blocked_missing_docs', 'blocked_validation', 'failed'] as const
type ReportStatus = (typeof STATUSES)[number]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const str = (v: unknown, max = 2000): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  return s ? s.slice(0, max) : null
}

export async function POST(req: Request) {
  if (!hasOffersSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: Record<string, unknown>
  try {
    const raw = await req.json()
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error()
    b = raw as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // Los flujos pueden mandar el estado ya decidido (status) o los mismos valores que escribían en la hoja (sheet):
  // en ese caso el estado se deduce aquí (lib/dispatch/classify.ts)
  let status = STATUSES.find((s) => s === b.status) as ReportStatus | undefined
  const sheet = b.sheet && typeof b.sheet === 'object' && !Array.isArray(b.sheet) ? (b.sheet as SheetValues) : null
  if (!status && sheet) {
    const c = classifySheetValues(sheet)
    if (!c) return NextResponse.json({ ok: true, ignored: 'nothing_to_report' })
    status = c.status
    if (!str(b.reason_text) && c.reason) b.reason_text = c.reason
    if (!str(b.notas) && str(sheet.NOTAS)) b.notas = sheet.NOTAS
    if (!str(b.red_flags) && str(sheet['Red Flag'])) b.red_flags = sheet['Red Flag']
    if (!str(b.process_status) && str(sheet['Process Status'])) b.process_status = sheet['Process Status']
    for (const [k, col] of [['dossier', 'Dossier'], ['auto_bayteca', 'Auto Bayteca'], ['auto_banco', 'Auto Banco']] as const) {
      if (!str(b[k]) && str(sheet[col])) b[k] = sheet[col]
    }
  }
  const itemId = str(b.item_id, 64)
  const rowId = str(b.cc_row_id, 64)
  if (!status || (!itemId && !(rowId && UUID_RE.test(rowId)))) {
    return NextResponse.json({ error: `status (${STATUSES.join(' | ')}) o sheet, e item_id o cc_row_id obligatorios` }, { status: 400 })
  }

  const db = await createAdminClient()
  let q = db.from('sheet_rows').select('id, status, bank_id, opportunity_id, engine, timestamp_sent, test_mode').eq('engine', 'cc')
  q = rowId && UUID_RE.test(rowId) ? q.eq('id', rowId) : q.eq('uid', itemId!)
  const { data: row, error } = await q.maybeSingle()
  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Línea del CC no encontrada' }, { status: 404 })

  if (row.status === 'sent' && status !== 'sent') {
    await db.from('event_log').insert({
      event_type: 'status_change', sheet_row_id: row.id, bank_id: row.bank_id, opportunity_id: row.opportunity_id,
      actor: 'n8n', payload: { ignored: true, reason: 'already_sent', reported: status, execution_id: str(b.execution_id, 64) },
    })
    return NextResponse.json({ ok: true, ignored: 'already_sent' })
  }

  const reason = str(b.reason_text)
  const patch: Record<string, unknown> = {
    status,
    reported_at: new Date().toISOString(),
    n8n_execution_id: str(b.execution_id, 64),
  }
  const processStatus = str(b.process_status, 300)
  if (processStatus) patch.process_status = processStatus
  // Las notas de n8n son las del intento actual: un resultado final (enviado / bloqueado / falló) sustituye las del
  // intento anterior (si no trae notas, se limpian: un "Faltan…" viejo no debe quedarse en una línea ya enviada)
  const notas = str(b.notas, 5000)
  if (notas) patch.notas = notas
  else if (status !== 'sending') patch.notas = null
  for (const k of ['dossier', 'auto_bayteca', 'auto_banco'] as const) { const v = str(b[k], 50); if (v) patch[k] = v }
  const redFlags = str(b.red_flags, 5000)
  if (redFlags) {
    patch.red_flags_raw = redFlags
    patch.red_flags = redFlags.split('|').map((s) => s.trim()).filter(Boolean)
  }

  if (status === 'sent') {
    patch.timestamp_sent = str(b.timestamp_sent, 40) ?? new Date().toISOString()
    patch.status_raw = 'Enviado ✅'
    patch.block_reason = null
    patch.last_error = null
  } else if (status.startsWith('blocked_')) {
    patch.block_reason = reason ?? processStatus ?? 'Bloqueado'
    patch.status_raw = reason ?? null
  } else if (status === 'failed') {
    patch.last_error = reason ?? processStatus ?? 'Error en el envío'
    patch.status_raw = reason ?? null
  }

  const { error: updErr } = await db.from('sheet_rows').update(patch).eq('id', row.id)
  if (updErr) {
    console.error('[dispatch/report] update', updErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  await db.from('event_log').insert({
    event_type: 'status_change', sheet_row_id: row.id, bank_id: row.bank_id, opportunity_id: row.opportunity_id,
    actor: 'n8n', payload: { from: row.status, to: status, reason, process_status: processStatus, execution_id: patch.n8n_execution_id },
  })
  // Prueba superada: la línea de prueba de un banco llegó a "Enviado" → su flujo n8n funciona con el CC y el interruptor
  // de Configuración se desbloquea (cc_ready). Quién lo activa y cuándo lo decide el equipo.
  if (status === 'sent' && row.test_mode === true) {
    const { data: bank } = await db.from('banks').select('slug').eq('id', row.bank_id).maybeSingle()
    if (bank?.slug) {
      await db.from('bank_config')
        .update({ cc_ready: true, cc_ready_note: `Prueba enviada OK ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC (n8n ${patch.n8n_execution_id ?? '?'})` })
        .eq('banks_slug', bank.slug)
        .eq('cc_ready', false)
    }
  }

  if (status !== 'sending') {
    await db.from('dispatch_attempts').insert({
      sheet_row_id: row.id, bank_id: row.bank_id, opportunity_id: row.opportunity_id, uid: itemId,
      triggered_by: 'n8n', status, error_message: status === 'sent' ? null : reason,
    })
  }

  return NextResponse.json({ ok: true, row_id: row.id, status })
}
