/**
 * Envíos de dossier por banco en un periodo, sumando las tres fuentes del Command Center sin duplicar.
 * Usado por /api/health/offers (reporte diario de Alma) y por el chat de Alma (métricas).
 */

import type { createAdminClient } from '@/lib/supabase/server'

// Inicio (UTC) del día de Madrid que empieza `daysAgo` días antes de hoy
export function madridDayStart(daysAgo: number): Date {
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
export async function dossierSends(supabase: Awaited<ReturnType<typeof createAdminClient>>, from: Date, to: Date) {
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

