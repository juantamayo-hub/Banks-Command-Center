import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import Image from 'next/image'
import { Suspense } from 'react'
import { CLUSTERS } from '@/lib/redFlagClusters'
import { getBankLogo, getBankAvatarColor } from '@/lib/bankLogos'
import PageHeader from '@/components/ui/PageHeader'
import StatusDonut from '@/components/metricas/StatusDonut'
import BankPerformanceChart from '@/components/metricas/BankPerformanceChart'
import RedFlagBarChart from '@/components/metricas/RedFlagBarChart'
import SuccessRateRanking from '@/components/metricas/SuccessRateRanking'
import RedFlagBankMatrix from '@/components/metricas/RedFlagBankMatrix'
import MetricasFilters from '@/components/metricas/MetricasFilters'

/** Slug → platform_dispatches.bank_name mapping */
const PLATFORM_BANK_NAMES: Record<string, string> = {
  santander: 'Santander',
  bankinter: 'Bankinter',
  sabadell: 'Sabadell',
  abanca: 'Abanca',
}

interface BankStat {
  slug: string
  name: string
  total: number
  sent: number
  blocked: number
  pending: number
  failed: number
  offers: number
  source: 'sheets' | 'platform' | 'kutxabank'
}

interface MetricasPageProps {
  searchParams: Promise<{
    bank?: string
    date_from?: string
    date_to?: string
  }>
}

export default async function MetricasPage({ searchParams }: MetricasPageProps) {
  const params = await searchParams
  const filterBank = params.bank ?? ''
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(params.date_from ?? '') ? params.date_from! : undefined
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(params.date_to ?? '') ? params.date_to! : undefined

  const supabase = await createClient()

  // ── Build date-filtered queries ──
  let sheetRowsQuery = supabase.from('sheet_rows').select('bank_id, status')
  if (dateFrom) sheetRowsQuery = sheetRowsQuery.gte('created_at', `${dateFrom}T00:00:00`)
  if (dateTo) sheetRowsQuery = sheetRowsQuery.lte('created_at', `${dateTo}T23:59:59`)

  let platformQuery = supabase.from('platform_dispatches').select('bank_name, sent_at, dismissed_at')
  if (dateFrom) platformQuery = platformQuery.gte('created_at', `${dateFrom}T00:00:00`)
  if (dateTo) platformQuery = platformQuery.lte('created_at', `${dateTo}T23:59:59`)

  let kutxaQuery = supabase.from('kutxabank_submissions').select('rastreator_status, sent_at, dismissed_at')
  if (dateFrom) kutxaQuery = kutxaQuery.gte('created_at', `${dateFrom}T00:00:00`)
  if (dateTo) kutxaQuery = kutxaQuery.lte('created_at', `${dateTo}T23:59:59`)

  let flagQuery = supabase.from('red_flag_events').select('normalized_reason, bank_id').limit(50_000)
  if (dateFrom) flagQuery = flagQuery.gte('created_at', `${dateFrom}T00:00:00`)
  if (dateTo) flagQuery = flagQuery.lte('created_at', `${dateTo}T23:59:59`)

  // ── Parallel data fetch ──
  const hasDateFilter = Boolean(dateFrom || dateTo)

  const [
    bankStatsResult,
    { data: clusterData },
    { data: banksData },
    { data: platformData },
    { data: kutxaData },
    sheetRowsResult,
  ] = await Promise.all([
    // Use RPC only when no date filter (it doesn't support date filtering)
    hasDateFilter ? { data: null } : supabase.rpc('bank_stats'),
    flagQuery,
    supabase.from('banks').select('id, slug, name, has_dispatch').eq('active', true),
    platformQuery,
    kutxaQuery,
    // Fetch raw sheet_rows only when date-filtering (replaces RPC)
    hasDateFilter ? sheetRowsQuery : { data: null },
  ])

  const bankStatsData = bankStatsResult.data
  const sheetRowsData = sheetRowsResult.data

  const allBanks = banksData ?? []
  const platformBankSlugs = new Set(
    allBanks.filter((b) => !b.has_dispatch).map((b) => b.slug)
  )

  // bank_id → slug/name lookups (needed early)
  const bankById: Record<number, { slug: string; name: string }> = {}
  for (const b of allBanks) bankById[b.id] = { slug: b.slug, name: b.name }

  // ── Build platform dispatch stats by bank name ──
  const platformByBank: Record<string, { total: number; sent: number; pending: number; dismissed: number }> = {}
  for (const d of platformData ?? []) {
    const bn = d.bank_name as string
    if (!platformByBank[bn]) platformByBank[bn] = { total: 0, sent: 0, pending: 0, dismissed: 0 }
    platformByBank[bn].total++
    if (d.sent_at) platformByBank[bn].sent++
    else if (d.dismissed_at) platformByBank[bn].dismissed++
    else platformByBank[bn].pending++
  }

  // ── Build Kutxabank stats ──
  const kutxa = { total: 0, sent: 0, pending: 0, dismissed: 0 }
  for (const k of kutxaData ?? []) {
    kutxa.total++
    if (k.sent_at) kutxa.sent++
    else if (k.dismissed_at) kutxa.dismissed++
    else kutxa.pending++
  }

  // ── Build sheet bank stats (from RPC or raw rows depending on date filter) ──
  let sheetBanks: BankStat[]

  if (bankStatsData) {
    // No date filter — use efficient RPC
    sheetBanks = (bankStatsData as Record<string, unknown>[])
      .map((b) => ({
        slug: String(b.slug),
        name: String(b.name),
        total: Number(b.total),
        sent: Number(b.sent),
        blocked: Number(b.blocked),
        pending: Number(b.pending),
        failed: Number(b.failed),
        offers: Number(b.offers),
        source: 'sheets' as const,
      }))
      .filter((b) => !platformBankSlugs.has(b.slug))
  } else {
    // Date-filtered — aggregate from raw sheet_rows
    const byBankId: Record<number, { total: number; sent: number; blocked: number; pending: number; failed: number; offers: number }> = {}
    for (const row of sheetRowsData ?? []) {
      const bid = row.bank_id as number
      if (!byBankId[bid]) byBankId[bid] = { total: 0, sent: 0, blocked: 0, pending: 0, failed: 0, offers: 0 }
      byBankId[bid].total++
      const st = row.status as string
      if (st === 'sent') byBankId[bid].sent++
      else if (st?.startsWith('blocked')) byBankId[bid].blocked++
      else if (st === 'pending_ready') byBankId[bid].pending++
      else if (st === 'failed') byBankId[bid].failed++
      else if (st === 'offer_received') byBankId[bid].offers++
    }
    sheetBanks = Object.entries(byBankId)
      .map(([bidStr, stats]): BankStat | null => {
        const bid = Number(bidStr)
        const info = bankById[bid]
        if (!info || platformBankSlugs.has(info.slug)) return null
        return { slug: info.slug, name: info.name, ...stats, source: 'sheets' as const }
      })
      .filter((b): b is BankStat => b !== null)
  }

  // Convert platform dispatches to BankStat format
  const platformBanks = Object.entries(PLATFORM_BANK_NAMES)
    .map(([slug, bankName]): BankStat | null => {
      const stats = platformByBank[bankName]
      if (!stats || stats.total === 0) return null
      const bankRow = allBanks.find((b) => b.slug === slug)
      return {
        slug,
        name: bankRow?.name ?? bankName,
        total: stats.total,
        sent: stats.sent,
        blocked: 0,
        pending: stats.pending,
        failed: 0,
        offers: 0,
        source: 'platform' as const,
      }
    })
    .filter((b): b is BankStat => b !== null)

  // Kutxabank as BankStat
  const kutxaBankStat: BankStat | null = kutxa.total > 0
    ? {
        slug: 'kutxabank',
        name: 'Kutxabank',
        total: kutxa.total,
        sent: kutxa.sent,
        blocked: 0,
        pending: kutxa.pending,
        failed: 0,
        offers: 0,
        source: 'kutxabank' as const,
      }
    : null

  // All banks merged and sorted by total
  let sortedBanks: BankStat[] = [
    ...sheetBanks,
    ...platformBanks,
    ...(kutxaBankStat ? [kutxaBankStat] : []),
  ].sort((a, b) => b.total - a.total)

  // Apply bank filter
  if (filterBank) {
    sortedBanks = sortedBanks.filter((b) => b.slug === filterBank)
  }

  const flagEvents = clusterData ?? []

  // slug → name lookup
  const bankNameBySlug: Record<string, string> = {}
  for (const b of sortedBanks) bankNameBySlug[b.slug] = b.name
  for (const b of allBanks) bankNameBySlug[b.slug] = b.name

  // bank_id → slug lookup
  const bankIdToSlug: Record<number, string> = {}
  for (const b of allBanks) bankIdToSlug[b.id] = b.slug

  // Bank filter for red flag events
  const filterBankId = filterBank
    ? allBanks.find((b) => b.slug === filterBank)?.id
    : undefined
  const filteredFlagEvents = filterBankId
    ? flagEvents.filter((ev) => ev.bank_id === filterBankId)
    : flagEvents

  // ── Global aggregates ──
  const globalTotal = sortedBanks.reduce((s, b) => s + b.total, 0)
  const globalSent = sortedBanks.reduce((s, b) => s + b.sent, 0)
  const globalBlocked = sortedBanks.reduce((s, b) => s + b.blocked, 0)
  const globalPending = sortedBanks.reduce((s, b) => s + b.pending, 0)
  const globalFailed = sortedBanks.reduce((s, b) => s + b.failed, 0)
  const globalOffers = sortedBanks.reduce((s, b) => s + b.offers, 0)
  const globalOther = globalTotal - globalSent - globalBlocked - globalPending - globalFailed - globalOffers

  const successRate = globalTotal > 0 ? Math.round((globalSent / globalTotal) * 100) : 0
  const blockRate = globalTotal > 0 ? Math.round((globalBlocked / globalTotal) * 100) : 0
  const offerConversion = globalSent > 0 ? Math.round((globalOffers / globalSent) * 100) : 0

  // ── Per-bank derived metrics ──
  const banksWithRates = sortedBanks.map((b) => ({
    ...b,
    successRate: b.total > 0 ? Math.round((b.sent / b.total) * 100) : 0,
    blockRate: b.total > 0 ? Math.round((b.blocked / b.total) * 100) : 0,
    offerRate: b.sent > 0 ? Math.round((b.offers / b.sent) * 100) : 0,
  }))

  const topSuccessRate = [...banksWithRates]
    .filter((b) => b.total >= 5)
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 5)

  const topBlocked = [...banksWithRates]
    .filter((b) => b.blocked > 0)
    .sort((a, b) => b.blockRate - a.blockRate)
    .slice(0, 5)

  const topOfferConversion = [...banksWithRates]
    .filter((b) => b.sent >= 3 && b.offerRate > 0)
    .sort((a, b) => b.offerRate - a.offerRate)
    .slice(0, 5)

  // ── Cluster aggregation ──
  const clusterCounts: Record<string, number> = {}
  const clusterByBank: Record<string, Record<string, number>> = {}

  for (const ev of filteredFlagEvents) {
    const cat = ev.normalized_reason ?? 'otro'
    const bankSlug = bankIdToSlug[ev.bank_id] ?? 'unknown'
    clusterCounts[cat] = (clusterCounts[cat] ?? 0) + 1
    if (!clusterByBank[cat]) clusterByBank[cat] = {}
    clusterByBank[cat][bankSlug] = (clusterByBank[cat][bankSlug] ?? 0) + 1
  }

  const knownSlugs = new Set(CLUSTERS.map((c) => c.slug))
  const unknownSlugs = Object.keys(clusterCounts).filter((s) => !knownSlugs.has(s))
  const HIDDEN_SLUGS = new Set(['no_red_flag'])

  const allClusterEntries = [
    ...CLUSTERS.map((c) => ({ cluster: c, count: clusterCounts[c.slug] ?? 0 })).filter((e) => e.count > 0),
    ...unknownSlugs.map((s) => ({
      cluster: { slug: s, label: s, color: 'bg-gray-100 text-gray-600', description: '' },
      count: clusterCounts[s],
    })),
  ].sort((a, b) => b.count - a.count)

  const visibleClusterEntries = allClusterEntries.filter((e) => !HIDDEN_SLUGS.has(e.cluster.slug))
  const totalRealFlags = visibleClusterEntries.reduce((s, e) => s + e.count, 0)

  // ── Heatmap matrix ──
  const topClusterSlugs = visibleClusterEntries.slice(0, 8).map((e) => e.cluster.slug)
  const topClusterLabels = visibleClusterEntries.slice(0, 8).map((e) => e.cluster.label)

  const bankFlagTotals: Record<string, number> = {}
  for (const ev of filteredFlagEvents) {
    const slug = bankIdToSlug[ev.bank_id] ?? 'unknown'
    if (!HIDDEN_SLUGS.has(ev.normalized_reason ?? ''))
      bankFlagTotals[slug] = (bankFlagTotals[slug] ?? 0) + 1
  }
  const topFlagBanks = Object.entries(bankFlagTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([slug]) => slug)

  const maxCellValue = Math.max(
    1,
    ...topClusterSlugs.flatMap((cs) =>
      topFlagBanks.map((bs) => clusterByBank[cs]?.[bs] ?? 0)
    )
  )
  const matrix = topClusterSlugs.map((cs) =>
    topFlagBanks.map((bs) => {
      const count = clusterByBank[cs]?.[bs] ?? 0
      return { count, intensity: count / maxCellValue }
    })
  )

  // ── Chart data ──
  const donutData = [
    { name: 'sent', value: globalSent, color: '#22c55e' },
    { name: 'blocked', value: globalBlocked, color: '#f97316' },
    { name: 'pending', value: globalPending, color: '#3b82f6' },
    { name: 'failed', value: globalFailed, color: '#ef4444' },
    { name: 'offers', value: globalOffers, color: '#10b981' },
    ...(globalOther > 0 ? [{ name: 'other', value: globalOther, color: '#9ca3af' }] : []),
  ].filter((d) => d.value > 0)

  const redFlagChartData = visibleClusterEntries.map((e) => ({
    label: e.cluster.label,
    count: e.count,
    color: e.cluster.color,
    pct: totalRealFlags > 0 ? Math.round((e.count / totalRealFlags) * 100) : 0,
  }))

  return (
    <div className="flex flex-col gap-8 p-6 pb-12">
      <PageHeader
        title="Métricas generales"
        subtitle="Rendimiento operativo, distribución de estados, red flags y análisis por banco."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }]}
      />

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <Suspense fallback={null}>
        <MetricasFilters
          banks={allBanks.map((b) => ({ slug: b.slug, name: b.name })).sort((a, b) => a.name.localeCompare(b.name))}
          currentBank={filterBank || undefined}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      </Suspense>

      {filterBank && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">
          {(() => { const logo = getBankLogo(filterBank); return logo ? <Image src={logo} alt="" width={20} height={20} className="rounded object-contain" /> : null })()}
          <span>Filtrando por <strong>{bankNameBySlug[filterBank] ?? filterBank}</strong></span>
          {dateFrom && <span>desde {dateFrom}</span>}
          {dateTo && <span>hasta {dateTo}</span>}
        </div>
      )}

      {/* ── 1. Hero KPIs ─────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <GlassKpi
          label="Total operaciones"
          value={globalTotal.toLocaleString('es-ES')}
          sublabel={`${sortedBanks.length} bancos`}
          gradient="from-slate-500 to-slate-700"
          icon="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
        />
        <GlassKpi
          label="Enviados"
          value={globalSent.toLocaleString('es-ES')}
          sublabel={`${successRate}% del total`}
          gradient="from-green-500 to-emerald-600"
          icon="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
        <GlassKpi
          label="Bloqueados"
          value={globalBlocked.toLocaleString('es-ES')}
          sublabel={`${blockRate}% del total`}
          gradient="from-orange-500 to-amber-600"
          icon="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"
        />
        <GlassKpi
          label="Pendientes"
          value={globalPending.toLocaleString('es-ES')}
          gradient="from-blue-500 to-indigo-600"
          icon="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
        />
        <GlassKpi
          label="Fallidos"
          value={globalFailed.toLocaleString('es-ES')}
          gradient="from-red-500 to-rose-600"
          icon="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
        <GlassKpi
          label="Ofertas"
          value={globalOffers.toLocaleString('es-ES')}
          sublabel={globalSent > 0 ? `${offerConversion}% conversión` : undefined}
          gradient="from-emerald-500 to-teal-600"
          icon="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
        />
      </section>

      {/* ── 2. Status distribution + Top success ─────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Distribución de estados" subtitle="Pipeline global de operaciones">
          {donutData.length > 0 ? (
            <StatusDonut data={donutData} total={globalTotal} />
          ) : (
            <p className="text-sm text-gray-400">Sin datos disponibles.</p>
          )}
        </Card>

        <SuccessRateRanking
          title="Top bancos por tasa de envío"
          subtitle="Mayor % de envíos exitosos (min. 5 operaciones)"
          banks={topSuccessRate.map((b) => ({
            slug: b.slug,
            name: b.name,
            rate: b.successRate,
            total: b.total,
            color: '#22c55e',
          }))}
          metric="total"
        />
      </section>

      {/* ── 3. Bank performance chart ────────────────────────────────────── */}
      <Card
        title="Composición por banco"
        subtitle="Desglose de estados por volumen de operaciones"
        headerRight={
          <div className="flex items-center gap-4">
            <Legend color="#22c55e" label="Enviados" />
            <Legend color="#f97316" label="Bloqueados" />
            <Legend color="#3b82f6" label="Pendientes" />
            <Legend color="#ef4444" label="Fallidos" />
          </div>
        }
      >
        <BankPerformanceChart banks={banksWithRates} />
      </Card>

      {/* ── 4. Efficiency rankings ───────────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <SuccessRateRanking
          title="Bancos con más bloqueos"
          subtitle="Mayor % de operaciones bloqueadas"
          banks={topBlocked.map((b) => ({
            slug: b.slug,
            name: b.name,
            rate: b.blockRate,
            total: b.blocked,
            color: '#f97316',
          }))}
          metric="bloqueados"
        />
        <SuccessRateRanking
          title="Mejor conversión a oferta"
          subtitle="Mayor % de ofertas sobre enviados (min. 3 enviados)"
          banks={topOfferConversion.map((b) => ({
            slug: b.slug,
            name: b.name,
            rate: b.offerRate,
            total: b.offers,
            color: '#10b981',
          }))}
          metric="ofertas"
        />
      </section>

      {/* ── 5. Red flag analysis ─────────────────────────────────────────── */}
      {visibleClusterEntries.length > 0 && (
        <section className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Red flags por categoría"
            subtitle="Frecuencia de cada tipo de bloqueo"
            headerRight={
              <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-red-600">
                {totalRealFlags.toLocaleString('es-ES')} eventos
              </span>
            }
          >
            <RedFlagBarChart clusters={redFlagChartData} />
          </Card>

          <Card title="Red flags por banco" subtitle="Qué tipos de bloqueo afectan a cada banco">
            <RedFlagBankMatrix
              clusters={topClusterLabels}
              banks={topFlagBanks.map((s) => ({
                slug: s,
                name: bankNameBySlug[s] ?? s,
                logo: getBankLogo(s),
                avatarColor: getBankAvatarColor(s),
              }))}
              matrix={matrix}
            />
          </Card>
        </section>
      )}

      {/* ── 6. Bank detail table ─────────────────────────────────────────── */}
      <Card title="Detalle por banco" subtitle="Datos completos de cada banco">
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {['Banco', 'Total', 'Enviados', 'Tasa', 'Bloq.', 'Pend.', 'Fall.', 'Ofertas', 'Conv.', 'Fuente'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 ${
                      i === 0 ? 'text-left' : 'text-right'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {banksWithRates.map((b) => {
                const logo = getBankLogo(b.slug)
                const avatarColor = getBankAvatarColor(b.slug)
                return (
                  <tr key={b.slug} className="group hover:bg-gray-50/50 transition-colors">
                    <td className="px-3 py-2.5">
                      <Link
                        href={b.source === 'platform' ? '/dashboard/envios-plataforma' : b.source === 'kutxabank' ? '/dashboard/kutxabank/envios' : `/dashboard/bancos/${b.slug}`}
                        className="flex items-center gap-2.5 group-hover:opacity-80 transition-opacity"
                      >
                        {logo ? (
                          <Image src={logo} alt="" width={22} height={22} className="rounded object-contain" />
                        ) : (
                          <span className={`flex h-[22px] w-[22px] items-center justify-center rounded text-[10px] font-bold text-white ${avatarColor}`}>
                            {b.name.charAt(0)}
                          </span>
                        )}
                        <span className="text-sm font-medium text-gray-800">{b.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium text-gray-900">
                      {b.total.toLocaleString('es-ES')}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-green-600">
                      {b.sent.toLocaleString('es-ES')}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                        b.successRate >= 70 ? 'bg-green-50 text-green-700' :
                        b.successRate >= 40 ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-600'
                      }`}>
                        {b.successRate}%
                      </span>
                    </td>
                    <Td value={b.blocked} color="text-orange-500" />
                    <Td value={b.pending} color="text-blue-500" />
                    <Td value={b.failed} color="text-red-500" />
                    <Td value={b.offers} color="text-emerald-500" />
                    <td className="px-3 py-2.5 text-right">
                      {b.sent > 0 && b.offerRate > 0 ? (
                        <span className="text-[11px] font-bold tabular-nums text-emerald-600">{b.offerRate}%</span>
                      ) : (
                        <span className="text-[11px] text-gray-200">&mdash;</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        b.source === 'platform' ? 'bg-violet-50 text-violet-600' :
                        b.source === 'kutxabank' ? 'bg-sky-50 text-sky-600' :
                        'bg-gray-50 text-gray-500'
                      }`}>
                        {b.source === 'platform' ? 'Plataforma' : b.source === 'kutxabank' ? 'Kutxabank' : 'Sheets'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── 7. Red flag cluster detail cards ──────────────────────────────── */}
      {visibleClusterEntries.length > 0 && (
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Detalle de clusters</h2>
              <p className="text-xs text-gray-400">Desglose por categoría de bloqueo con bancos más afectados</p>
            </div>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium tabular-nums text-gray-500">
              {totalRealFlags.toLocaleString('es-ES')} eventos
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleClusterEntries.map(({ cluster, count }) => {
              const pct = totalRealFlags > 0 ? Math.round((count / totalRealFlags) * 100) : 0
              const topBanks = Object.entries(clusterByBank[cluster.slug] ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)

              return (
                <div key={cluster.slug} className="group rounded-xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold ${cluster.color}`}>
                        {cluster.label}
                      </span>
                      {cluster.description && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">{cluster.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xl font-bold tabular-nums text-gray-900">{count}</span>
                      <span className="ml-1 text-xs tabular-nums text-gray-400">{pct}%</span>
                    </div>
                  </div>
                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-red-400 to-red-500 transition-all"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  {topBanks.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {topBanks.map(([slug, n]) => {
                        const logo = getBankLogo(slug)
                        return (
                          <Link
                            key={slug}
                            href={`/dashboard/bancos/${slug}`}
                            className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                          >
                            {logo && (
                              <Image src={logo} alt="" width={14} height={14} className="rounded-sm object-contain" />
                            )}
                            {bankNameBySlug[slug] ?? slug}
                            <span className="font-semibold tabular-nums">{n}</span>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {filteredFlagEvents.length === 0 && !filterBank && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <strong>Sin datos de clustering.</strong> Aplica las migraciones 006 y 007 en el SQL editor
          de Supabase y luego llama a{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">POST /api/cluster-flags</code>.
        </div>
      )}
    </div>
  )
}

// ── Reusable components ──

function GlassKpi({
  label,
  value,
  sublabel,
  gradient,
  icon,
}: {
  label: string
  value: string
  sublabel?: string
  gradient: string
  icon: string
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${gradient} p-4 text-white shadow-lg`}>
      <div className="absolute -right-2 -top-2 opacity-10">
        <svg className="h-16 w-16" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <span className="text-2xl font-extrabold tabular-nums tracking-tight">{value}</span>
      <span className="mt-0.5 block text-[11px] font-medium text-white/70">{label}</span>
      {sublabel && (
        <span className="mt-0.5 block text-[11px] tabular-nums text-white/50">{sublabel}</span>
      )}
    </div>
  )
}

function Card({
  title,
  subtitle,
  headerRight,
  children,
}: {
  title: string
  subtitle?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-gray-500">{label}</span>
    </div>
  )
}

function Td({ value, color }: { value: number; color: string }) {
  return (
    <td className="px-3 py-2.5 text-right">
      {value > 0 ? (
        <span className={`text-sm tabular-nums ${color}`}>{value.toLocaleString('es-ES')}</span>
      ) : (
        <span className="text-[11px] text-gray-200">&mdash;</span>
      )}
    </td>
  )
}
