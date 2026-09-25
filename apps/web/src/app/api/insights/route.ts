/**
 * GET /api/insights
 *
 * Returns a random insight based on real data from Supabase.
 * Called periodically by SmartInsights component to show non-intrusive toasts.
 *
 * Todas las cifras son exactas: conteos con count='exact' o agregados en SQL
 * (bank_stats, bank_responses_summary). Nunca se agregan filas en memoria, porque
 * PostgREST corta en 1000 filas.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { RESPONSE_BANKS } from '@/lib/bankResponses'

interface Insight {
  text: string
  type: 'info' | 'success' | 'warning'
}

const BANK_NAME = new Map<string, string>(RESPONSE_BANKS.map((b) => [b.slug, b.name]))
const plural = (n: number, s: string, p = s + 's') => (n === 1 ? s : p)
const fmt = (n: number) => n.toLocaleString('es-ES')

export async function GET() {

  const supabase = await createAdminClient()
  const insights: Insight[] = []
  const year = new Date().getFullYear()
  const ytdStart = `${year}-01-01T00:00:00Z`
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()

  try {
    // ── Pending platform dispatches ────────────────────────────────────
    const { count: pendingPlatform } = await supabase
      .from('platform_dispatches')
      .select('*', { count: 'exact', head: true })
      .is('sent_at', null)
      .is('dismissed_at', null)

    if (pendingPlatform && pendingPlatform > 0) {
      insights.push({
        text: `Tienes ${fmt(pendingPlatform)} ${plural(pendingPlatform, 'envío')} ${plural(pendingPlatform, 'pendiente')} por plataforma`,
        type: 'warning',
      })
    }

    // ── Kutxabank approved waiting to send ─────────────────────────────
    const { count: kutxaPending } = await supabase
      .from('kutxabank_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('rastreator_status', 'approved')
      .is('dismissed_at', null)

    if (kutxaPending && kutxaPending > 0) {
      insights.push({
        text: `${fmt(kutxaPending)} ${plural(kutxaPending, 'envío')} de Kutxabank ${plural(kutxaPending, 'listo')} para enviar`,
        type: 'warning',
      })
    }

    // ── Envíos por Sheets este año (fecha real de envío) ───────────────
    const { count: sentYtd } = await supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('timestamp_sent', ytdStart)

    if (sentYtd && sentYtd > 0) {
      insights.push({
        text: `En ${year} se han enviado ${fmt(sentYtd)} operaciones a bancos desde los Sheets`,
        type: 'success',
      })
    }

    // ── Platform dispatches enviados este año ──────────────────────────
    const { count: sentPlatform } = await supabase
      .from('platform_dispatches')
      .select('*', { count: 'exact', head: true })
      .gte('sent_at', ytdStart)

    if (sentPlatform && sentPlatform > 0) {
      insights.push({
        text: `En ${year} se han completado ${fmt(sentPlatform)} envíos por plataforma`,
        type: 'info',
      })
    }

    // ── Volumen y bloqueos por banco (agregado en SQL, histórico) ──────
    const { data: stats } = await supabase.rpc('bank_stats')
    const bankStats = ((stats ?? []) as Array<{ name: string; total: number; blocked: number }>)
      .map((s) => ({ name: s.name, total: Number(s.total), blocked: Number(s.blocked) }))

    if (bankStats.length > 1) {
      const top = [...bankStats].sort((a, b) => b.total - a.total)[0]
      const all = bankStats.reduce((n, s) => n + s.total, 0)
      const share = Math.round((top.total / all) * 100)
      insights.push({
        text: `${top.name} concentra el ${share}% de las operaciones registradas (${fmt(top.total)} de ${fmt(all)})`,
        type: 'info',
      })

      const worst = bankStats
        .filter((s) => s.total >= 20 && s.blocked > 0)
        .map((s) => ({ ...s, rate: Math.round((s.blocked / s.total) * 100) }))
        .sort((a, b) => b.rate - a.rate)[0]
      if (worst) {
        insights.push({
          text: `${worst.name} es el banco con más bloqueos: ${worst.rate}% de sus operaciones (${fmt(worst.blocked)} de ${fmt(worst.total)})`,
          type: 'warning',
        })
      }
    }

    // ── Ofertas y rechazos de los últimos 30 días (bank_responses) ─────
    const { data: summary } = await supabase.rpc('bank_responses_summary', { p_since: since30 })
    const responses = ((summary ?? []) as Array<{ bank_slug: string; offers: number; rejections: number; attention: number }>)
      .map((r) => ({ slug: r.bank_slug, offers: Number(r.offers), rejections: Number(r.rejections), attention: Number(r.attention) }))

    const offers30 = responses.reduce((n, r) => n + r.offers, 0)
    if (offers30 > 0) {
      insights.push({
        text: `En los últimos 30 días se han recibido ${fmt(offers30)} ${plural(offers30, 'oferta')} de bancos`,
        type: 'success',
      })
      const topOffers = [...responses].sort((a, b) => b.offers - a.offers)[0]
      insights.push({
        text: `${BANK_NAME.get(topOffers.slug) ?? topOffers.slug} es el banco con más ofertas en los últimos 30 días: ${fmt(topOffers.offers)}`,
        type: 'success',
      })
    }

    const bestRatio = responses
      .filter((r) => r.offers + r.rejections >= 10)
      .map((r) => ({ ...r, rate: Math.round((r.offers / (r.offers + r.rejections)) * 100) }))
      .sort((a, b) => b.rate - a.rate)[0]
    if (bestRatio) {
      insights.push({
        text: `${BANK_NAME.get(bestRatio.slug) ?? bestRatio.slug} convierte el ${bestRatio.rate}% de sus respuestas en oferta (últimos 30 días)`,
        type: 'success',
      })
    }

    const attention = responses.reduce((n, r) => n + r.attention, 0)
    if (attention > 0) {
      insights.push({
        text: `${fmt(attention)} ${plural(attention, 'respuesta')} de bancos ${plural(attention, 'requiere', 'requieren')} revisión manual en Ofertas recibidas`,
        type: 'warning',
      })
    }

  } catch (err) {
    console.error('[insights] Error:', err)
  }

  // Return one random insight (or null if none)
  if (insights.length === 0) {
    return NextResponse.json({ insight: null })
  }

  const picked = insights[Math.floor(Math.random() * insights.length)]
  return NextResponse.json({ insight: picked })
}
