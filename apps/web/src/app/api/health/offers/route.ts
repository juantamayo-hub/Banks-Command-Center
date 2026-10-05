/**
 * GET /api/health/offers
 *
 * Datos para la revisión diaria automática (n8n "OFFERS · Revisión diaria con IA").
 * Solo lectura. Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 *
 * Devuelve:
 *  - responses: respuestas bancarias de las últimas 24 h por banco + cola de atención
 *  - kutxabank: envíos aprobados, con documentos faltantes
 *  - platform: envíos por plataforma pendientes
 *  - misplaced: deals bancarios (título de banco) en el pipeline de Opportunity (6)
 *    modificados en las últimas 48 h — síntoma de automatizaciones que mueven de pipeline
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { RESPONSE_BANKS } from '@/lib/bankResponses'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BANK_PREFIXES = RESPONSE_BANKS.map((b) => b.name.toLowerCase()).concat(['caixa', 'unicaja', 'ing'])

// Inicio (UTC) del día de Madrid que empieza `daysAgo` días antes de hoy
function madridDayStart(daysAgo: number): Date {
  const now = new Date()
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(now.getTime() - daysAgo * 86400_000))
  const [y, m, d] = ymd.split('-').map(Number)
  const utcMidnight = new Date(Date.UTC(y, m - 1, d))
  const madridAsUtc = new Date(utcMidnight.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))
  const asUtc = new Date(utcMidnight.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(utcMidnight.getTime() - (madridAsUtc.getTime() - asUtc.getTime()))
}

// Bancos cuyos envíos se registran fuera de la hoja (no se cuentan sus filas para no duplicar)
const NON_SHEET_SLUGS = new Set(['santander', 'bankinter', 'sabadell', 'abanca', 'kutxabank'])

/**
 * Envíos de dossier entre `from` y `to`, por banco, sumando las tres fuentes del Command Center:
 *  - bancos con hoja: sheet_rows.timestamp_sent (lo que el equipo/n8n marca como "Enviado")
 *  - envíos por plataforma (Santander, CaixaBank, Sabadell, Bankinter, Abanca): platform_dispatches.sent_at
 *  - Kutxabank: kutxabank_submissions.sent_at
 */
async function dossierSends(supabase: Awaited<ReturnType<typeof createAdminClient>>, from: Date, to: Date) {
  const [banks, sheet, platform, kutxa] = await Promise.all([
    supabase.from('banks').select('id, slug, name'),
    supabase.from('sheet_rows').select('bank_id').gte('timestamp_sent', from.toISOString()).lt('timestamp_sent', to.toISOString()).limit(5000),
    supabase.from('platform_dispatches').select('bank_name').gte('sent_at', from.toISOString()).lt('sent_at', to.toISOString()).is('dismissed_at', null).limit(5000),
    supabase.from('kutxabank_submissions').select('id').gte('sent_at', from.toISOString()).lt('sent_at', to.toISOString()).limit(5000),
  ])
  const bankById = new Map((banks.data ?? []).map((b) => [b.id, b]))
  const counts = new Map<string, { banco: string; envios: number; fuente: string }>()
  const add = (banco: string, fuente: string) => {
    const k = banco.toLowerCase()
    const cur = counts.get(k) ?? { banco, envios: 0, fuente }
    cur.envios += 1
    counts.set(k, cur)
  }
  for (const r of sheet.data ?? []) {
    const b = bankById.get(r.bank_id)
    if (b && !NON_SHEET_SLUGS.has(b.slug)) add(b.slug === 'uci' ? 'UCI / Hipotecas.com' : b.name, 'hoja')
  }
  for (const r of platform.data ?? []) add(r.bank_name, 'plataforma')
  for (let i = 0; i < (kutxa.data ?? []).length; i++) add('Kutxabank', 'kutxabank')
  const por_banco = [...counts.values()].sort((a, b) => b.envios - a.envios)
  return {
    desde: from.toISOString(),
    hasta: to.toISOString(),
    total: por_banco.reduce((n, b) => n + b.envios, 0),
    por_banco,
    error: banks.error?.message ?? sheet.error?.message ?? platform.error?.message ?? kutxa.error?.message ?? null,
  }
}

function looksLikeBankDeal(title: string): boolean {
  const t = title.toLowerCase().replace(/^[^a-z0-9]+/, '')
  return BANK_PREFIXES.some((p) => t.startsWith(p + ' ') || t.startsWith(p + '-') || t.startsWith(p + '🏠'))
}

export async function GET(req: Request) {
  const secret = process.env.OFFERS_API_SECRET
  if (!secret || req.headers.get('x-offers-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()
  // ?hours=N (1–168, por defecto 24): ventana de respuestas. La revisión de las 18:00 pide 72 h los lunes (fin de semana).
  const hoursParam = Number(new URL(req.url).searchParams.get('hours'))
  const hours = Number.isFinite(hoursParam) && hoursParam >= 1 && hoursParam <= 168 ? Math.round(hoursParam) : 24
  const since24 = new Date(Date.now() - hours * 3600_000).toISOString()

  const [summary, attention, kutxa, platform] = await Promise.all([
    supabase.rpc('bank_responses_summary', { p_since: since24 }),
    supabase
      .from('bank_responses')
      .select('bank_slug, classification, status, match_status, subject, error_step, error_message, received_at, bank_deal_id')
      .neq('status', 'resolved')
      .or('status.in.(error,manual_review),match_status.neq.matched')
      .order('received_at', { ascending: false })
      .limit(25),
    supabase
      .from('kutxabank_submissions')
      .select('deal_id, nombre_cliente, missing_docs, rastreator_status, updated_at')
      .eq('rastreator_status', 'approved')
      .is('dismissed_at', null),
    supabase
      .from('platform_dispatches')
      .select('*', { count: 'exact', head: true })
      .is('sent_at', null)
      .is('dismissed_at', null),
  ])

  // Deals bancarios en el pipeline de Opportunity modificados en las últimas 48 h
  let misplaced: Array<{ id: number; title: string; stage_id: number; status: string; update_time: string }> = []
  let misplacedError: string | null = null
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (token) {
    try {
      const res = await fetch(
        `https://api.pipedrive.com/v1/pipelines/6/deals?limit=500&sort=update_time%20DESC&api_token=${token}`,
        { cache: 'no-store' }
      )
      const json = await res.json()
      const cutoff = Date.now() - 48 * 3600_000
      misplaced = ((json?.data ?? []) as Array<{ id: number; title: string; stage_id: number; status: string; update_time: string }>)
        .filter((d) => Date.parse(d.update_time.replace(' ', 'T') + 'Z') > cutoff && looksLikeBankDeal(d.title))
        .map(({ id, title, stage_id, status, update_time }) => ({ id, title, stage_id, status, update_time }))
    } catch (e) {
      misplacedError = e instanceof Error ? e.message : 'error'
    }
  }

  // Estado en el Command Center de correos concretos (?message_ids=id1,id2…, IDs de Gmail):
  // la revisión diaria descarta así los correos sin etiqueta "Procesado" que ya están resueltos.
  const messageIds = (new URL(req.url).searchParams.get('message_ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{8,32}$/i.test(s))
    .slice(0, 200)
  let messageStatus: Record<string, string> = {}
  if (messageIds.length) {
    const { data } = await supabase
      .from('bank_responses')
      .select('external_id, status')
      .in('external_id', messageIds)
    messageStatus = Object.fromEntries((data ?? []).map((r) => [r.external_id, r.status]))
  }

  // Envíos de dossier: ayer (día completo de Madrid) y últimos 7 días
  const today = madridDayStart(0)
  const [sendsYesterday, sends7d, sendsToday] = await Promise.all([
    dossierSends(supabase, madridDayStart(1), today),
    dossierSends(supabase, madridDayStart(7), today),
    dossierSends(supabase, today, new Date(Date.now() + 60_000)),
  ])

  const kutxaRows = kutxa.data ?? []
  return NextResponse.json({
    dossier_sends: { today: sendsToday, yesterday: sendsYesterday, last7d: sends7d },
    responses_window_hours: hours,
    generated_at: new Date().toISOString(),
    responses: {
      last24h_by_bank: summary.data ?? [],
      attention_open: attention.data ?? [],
      error: summary.error?.message ?? attention.error?.message ?? null,
    },
    kutxabank: {
      approved: kutxaRows.length,
      approved_with_missing_docs: kutxaRows.filter((r) => (r.missing_docs ?? []).length > 0),
    },
    platform: { pending_dispatches: platform.count ?? null },
    misplaced_bank_deals_in_opportunity: misplaced,
    misplaced_error: misplacedError,
    message_status: messageStatus,
  })
}
