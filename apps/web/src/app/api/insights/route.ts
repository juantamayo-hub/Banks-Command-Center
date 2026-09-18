/**
 * GET /api/insights
 *
 * Returns a random insight based on real data from Supabase.
 * Called periodically by SmartInsights component to show non-intrusive toasts.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

interface Insight {
  text: string
  type: 'info' | 'success' | 'warning'
}

export async function GET() {
  const supabase = await createAdminClient()
  const insights: Insight[] = []

  try {
    // ── Pending platform dispatches ────────────────────────────────────
    const { count: pendingPlatform } = await supabase
      .from('platform_dispatches')
      .select('*', { count: 'exact', head: true })
      .is('sent_at', null)
      .is('dismissed_at', null)

    if (pendingPlatform && pendingPlatform > 0) {
      insights.push({
        text: `Tienes ${pendingPlatform} envío${pendingPlatform !== 1 ? 's' : ''} pendiente${pendingPlatform !== 1 ? 's' : ''} por plataforma`,
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
        text: `${kutxaPending} envío${kutxaPending !== 1 ? 's' : ''} de Kutxabank listo${kutxaPending !== 1 ? 's' : ''} para enviar`,
        type: 'warning',
      })
    }

    // ── Bank stats from sheet_rows ─────────────────────────────────────
    const year = new Date().getFullYear()
    const ytdStart = `${year}-01-01T00:00:00`

    const { data: rows } = await supabase
      .from('sheet_rows')
      .select('bank_id, status')
      .gte('created_at', ytdStart)

    if (rows && rows.length > 0) {
      // Total envíos YTD
      const totalRows = rows.length
      insights.push({
        text: `Este año se han procesado ${totalRows.toLocaleString('es-ES')} operaciones en total`,
        type: 'info',
      })

      // Sent count
      const sentRows = rows.filter((r) => r.status === 'sent')
      if (sentRows.length > 0) {
        insights.push({
          text: `Se han completado ${sentRows.length.toLocaleString('es-ES')} envíos exitosos en ${year}`,
          type: 'success',
        })
      }

      // Per-bank stats
      const bankCounts = new Map<string, { total: number; sent: number; offers: number; blocked: number }>()
      for (const row of rows) {
        const bank = row.bank_id as string
        const entry = bankCounts.get(bank) ?? { total: 0, sent: 0, offers: 0, blocked: 0 }
        entry.total++
        if (row.status === 'sent') entry.sent++
        if (row.status === 'offer_received') entry.offers++
        if (String(row.status).startsWith('blocked_')) entry.blocked++
        bankCounts.set(bank, entry)
      }

      // Top bank by volume
      const sorted = [...bankCounts.entries()].sort((a, b) => b[1].total - a[1].total)
      if (sorted.length > 0) {
        const [topSlug, topStats] = sorted[0]
        const bankName = slugToName(topSlug)
        const avg = totalRows / bankCounts.size
        const pctAbove = Math.round(((topStats.total - avg) / avg) * 100)
        if (pctAbove > 10) {
          insights.push({
            text: `${bankName} lidera con ${topStats.total} operaciones, ${pctAbove}% por encima de la media`,
            type: 'info',
          })
        }
      }

      // Bank with most offers
      const sortedOffers = [...bankCounts.entries()]
        .filter(([, s]) => s.offers > 0)
        .sort((a, b) => b[1].offers - a[1].offers)
      if (sortedOffers.length > 0) {
        const [topSlug, topStats] = sortedOffers[0]
        insights.push({
          text: `${slugToName(topSlug)} es el banco con más ofertas recibidas: ${topStats.offers} este año`,
          type: 'success',
        })
      }

      // Best offer rate (min 5 sent)
      const withRate = [...bankCounts.entries()]
        .filter(([, s]) => s.sent >= 5 && s.offers > 0)
        .map(([slug, s]) => ({ slug, rate: Math.round((s.offers / s.sent) * 100), ...s }))
        .sort((a, b) => b.rate - a.rate)
      if (withRate.length > 0) {
        const best = withRate[0]
        insights.push({
          text: `${slugToName(best.slug)} tiene el mejor ratio de oferta: ${best.rate}% sobre enviados`,
          type: 'success',
        })
      }

      // Most blocked bank
      const sortedBlocked = [...bankCounts.entries()]
        .filter(([, s]) => s.blocked > 0 && s.total >= 5)
        .map(([slug, s]) => ({ slug, rate: Math.round((s.blocked / s.total) * 100), ...s }))
        .sort((a, b) => b.rate - a.rate)
      if (sortedBlocked.length > 0) {
        const worst = sortedBlocked[0]
        insights.push({
          text: `${slugToName(worst.slug)} tiene el mayor ratio de bloqueo: ${worst.rate}% de sus operaciones`,
          type: 'warning',
        })
      }
    }

    // ── Platform dispatches stats ──────────────────────────────────────
    const { count: sentPlatform } = await supabase
      .from('platform_dispatches')
      .select('*', { count: 'exact', head: true })
      .not('sent_at', 'is', null)
      .gte('created_at', ytdStart)

    if (sentPlatform && sentPlatform > 0) {
      insights.push({
        text: `Se han completado ${sentPlatform} envíos por plataforma este año`,
        type: 'info',
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

/** Convert bank slug to display name */
function slugToName(slug: string): string {
  const map: Record<string, string> = {
    caixabank: 'CaixaBank', abanca: 'Abanca', bankinter: 'Bankinter',
    santander: 'Santander', sabadell: 'Sabadell', kutxabank: 'Kutxabank',
    deutsche_bank: 'Deutsche Bank', evo_banco: 'EVO Banco', ibercaja: 'Ibercaja',
    unicaja: 'Unicaja', openbank: 'Openbank', bbva: 'BBVA',
    ing: 'ING', myinvestor: 'MyInvestor', targobank: 'Targobank',
    cajamar: 'Cajamar', liberbank: 'Liberbank', laboral_kutxa: 'Laboral Kutxa',
    cajasur: 'Cajasur', imaginbank: 'ImaginBank', pibank: 'Pibank',
    cr_navarra: 'CR Navarra', cr_teruel: 'CR Teruel', cr_extremadura: 'CR Extremadura',
    banca_360: 'Banca 360',
  }
  return map[slug] ?? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
