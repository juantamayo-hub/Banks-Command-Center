/**
 * GET /api/cron/dispatch-watchdog — Vercel Cron cada 5 min (CRON_SECRET).
 *
 * 1. Líneas del CC en 'sending' hace más de 15 min sin informe de n8n → 'failed' ("sin respuesta de n8n"),
 *    para que aparezcan en Pendientes con su motivo (antes Apps Script reintentaba cada 5–10 min a ciegas).
 * 2. pipedrive_lost de las líneas del CC (lo que hacía syncPipedriveStatus_ de Apps Script): las de deals
 *    perdidos desaparecen de Pendientes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const STUCK_MS = 15 * 60 * 1000
const LOST_WINDOW_MS = 15 * 24 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = await createAdminClient()

  // 1) Envíos sin respuesta
  const cutoff = new Date(Date.now() - STUCK_MS).toISOString()
  const { data: stuck, error } = await db
    .from('sheet_rows')
    .select('id, bank_id, opportunity_id, last_attempt_at, reported_at')
    .eq('engine', 'cc')
    .eq('status', 'sending')
    .lt('last_attempt_at', cutoff)
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let failed = 0
  for (const r of stuck ?? []) {
    // n8n informó "Procesando" tras el intento: se le da más margen (compresión, esperas de Drive…), hasta 45 min
    const reportedAfter = r.reported_at && r.reported_at > (r.last_attempt_at ?? '')
    if (reportedAfter && Date.parse(r.reported_at as string) > Date.now() - 3 * STUCK_MS) continue
    const { data: upd } = await db.from('sheet_rows')
      .update({ status: 'failed', last_error: 'Sin respuesta de n8n en 15 min: revisar la ejecución y reenviar' })
      .eq('id', r.id).eq('status', 'sending').select('id')
    if (upd?.length) {
      failed++
      await db.from('event_log').insert({
        event_type: 'status_change', sheet_row_id: r.id, bank_id: r.bank_id, opportunity_id: r.opportunity_id,
        actor: 'cron:dispatch-watchdog', payload: { from: 'sending', to: 'failed', reason: 'no_report_15min' },
      })
    }
  }

  // 1b) Líneas creadas que nunca llegaron a lanzarse (p. ej. se cortó la función antes del webhook)
  const { data: neverSent } = await db
    .from('sheet_rows')
    .select('id, bank_id, opportunity_id')
    .eq('engine', 'cc')
    .eq('status', 'pending_ready')
    .eq('attempts', 0)
    .lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(200)
  for (const r of neverSent ?? []) {
    const { data: upd } = await db.from('sheet_rows')
      .update({ status: 'failed', last_error: 'No se llegó a lanzar el envío: reenviar desde Pendientes' })
      .eq('id', r.id).eq('status', 'pending_ready').eq('attempts', 0).select('id')
    if (upd?.length) failed++
  }

  // 2) Deals perdidos en Pipedrive (solo líneas del CC; las de la hoja las sigue manteniendo Apps Script)
  let lostUpdated = 0
  const token = process.env.PIPEDRIVE_API_TOKEN_HIPOTECAS || process.env.PIPEDRIVE_API_TOKEN
  if (token) {
    const since = new Date(Date.now() - LOST_WINDOW_MS).toISOString()
    const { data: rows } = await db
      .from('sheet_rows')
      .select('id, opportunity_id, pipedrive_lost')
      .eq('engine', 'cc')
      .not('status', 'in', '(sent,offer_received,sending)')
      .gte('created_at', since)
      .limit(300)
    const byDeal = new Map<number, { id: string; lost: boolean }[]>()
    for (const r of rows ?? []) {
      const list = byDeal.get(r.opportunity_id as number) ?? []
      list.push({ id: r.id as string, lost: r.pipedrive_lost as boolean })
      byDeal.set(r.opportunity_id as number, list)
    }
    for (const [dealId, list] of byDeal) {
      try {
        const res = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}`, { cache: 'no-store', headers: { 'x-api-token': token } })
        if (!res.ok) continue
        const lost = (await res.json())?.data?.status === 'lost'
        const ids = list.filter((x) => x.lost !== lost).map((x) => x.id)
        if (ids.length) {
          await db.from('sheet_rows').update({ pipedrive_lost: lost }).in('id', ids)
          lostUpdated += ids.length
        }
      } catch { /* siguiente deal */ }
    }
  }

  return NextResponse.json({ ok: true, stuck_checked: stuck?.length ?? 0, marked_failed: failed, lost_updated: lostUpdated })
}
