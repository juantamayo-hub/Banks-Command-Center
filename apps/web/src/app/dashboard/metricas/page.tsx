import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { CLUSTERS, CLUSTER_BY_SLUG } from '@/lib/redFlagClusters'

export default async function MetricasPage() {
  const supabase = await createClient()

  // ── bank_stats() replaces the full sheet_rows JS aggregation (HIGH-3 fix) ──
  // ── red_flag_events fetch is lean (2 small columns, capped at 50k)        ──
  const [{ data: bankStatsData }, { data: clusterData }, { data: banksData }] =
    await Promise.all([
      supabase.rpc('bank_stats'),
      supabase
        .from('red_flag_events')
        .select('normalized_reason, bank_id')
        .limit(50_000),
      supabase.from('banks').select('id, slug').eq('active', true),
    ])

  const sortedBanks = (bankStatsData ?? []) as {
    slug: string; name: string
    total: number; sent: number; blocked: number
    pending: number; failed: number; offers: number
  }[]

  const flagEvents = clusterData ?? []
  const maxTotal = sortedBanks[0]?.total ?? 1

  // slug → name lookup built from bankStatsData
  const bankNameBySlug: Record<string, string> = {}
  for (const b of sortedBanks) bankNameBySlug[b.slug] = b.name

  // bank_id → slug lookup
  const bankIdToSlug: Record<number, string> = {}
  for (const b of banksData ?? []) bankIdToSlug[b.id] = b.slug

  // ── Cluster aggregation ──────────────────────────────────────────────────
  const clusterCounts: Record<string, number> = {}
  const clusterByBank: Record<string, Record<string, number>> = {}

  for (const ev of flagEvents) {
    const cat = ev.normalized_reason ?? 'otro'
    const bankSlug = bankIdToSlug[ev.bank_id] ?? 'unknown'
    clusterCounts[cat] = (clusterCounts[cat] ?? 0) + 1
    if (!clusterByBank[cat]) clusterByBank[cat] = {}
    clusterByBank[cat][bankSlug] = (clusterByBank[cat][bankSlug] ?? 0) + 1
  }

  const knownSlugs = new Set(CLUSTERS.map((c) => c.slug))
  const unknownSlugs = Object.keys(clusterCounts).filter((s) => !knownSlugs.has(s))

  const allClusterEntries = [
    ...CLUSTERS.map((c) => ({ cluster: c, count: clusterCounts[c.slug] ?? 0 })).filter((e) => e.count > 0),
    ...unknownSlugs.map((s) => ({
      cluster: { slug: s, label: s, color: 'bg-gray-100 text-gray-600', description: '' },
      count: clusterCounts[s],
    })),
  ].sort((a, b) => b.count - a.count)

  const maxCluster = allClusterEntries[0]?.count ?? 1

  return (
    <div className="flex flex-col gap-8 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Métricas generales</h1>
        <p className="mt-1 text-sm text-gray-500">
          Actividad por banco, clustering de red flags y distribución de bloqueos.
        </p>
      </div>

      {/* ── Per-bank stats (from bank_stats() RPC) ──────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Actividad por banco
        </h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Banco', 'Total', 'Enviados', 'Bloqueados', 'Pendientes', 'Fallidos', 'Ofertas', 'Volumen'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {sortedBanks.map((b) => {
                const barWidth = Math.round((Number(b.total) / maxTotal) * 100)
                const sentPct = Number(b.total) > 0 ? Math.round((Number(b.sent) / Number(b.total)) * 100) : 0
                return (
                  <tr key={b.slug} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/bancos/${b.slug}`} className="text-sm font-medium text-blue-600 hover:underline">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-900">{Number(b.total).toLocaleString('es-ES')}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-green-700">{Number(b.sent).toLocaleString('es-ES')}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-orange-600">
                      {Number(b.blocked) > 0 ? Number(b.blocked).toLocaleString('es-ES') : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-blue-600">
                      {Number(b.pending) > 0 ? Number(b.pending).toLocaleString('es-ES') : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-red-600">
                      {Number(b.failed) > 0 ? Number(b.failed).toLocaleString('es-ES') : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-emerald-600">
                      {Number(b.offers) > 0 ? Number(b.offers).toLocaleString('es-ES') : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-green-500" style={{ width: `${barWidth}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-gray-400">{sentPct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Red flag clusters ────────────────────────────────────────────── */}
      {allClusterEntries.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Clustering de red flags
            </h2>
            <span className="text-xs text-gray-400">
              {flagEvents.length.toLocaleString('es-ES')} eventos totales
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allClusterEntries.map(({ cluster, count }) => {
              const pct = Math.round((count / maxCluster) * 100)
              const topBanks = Object.entries(clusterByBank[cluster.slug] ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)

              return (
                <div key={cluster.slug} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cluster.color}`}>
                      {cluster.label}
                    </span>
                    <span className="shrink-0 text-lg font-semibold tabular-nums text-gray-900">{count}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-red-400" style={{ width: `${pct}%` }} />
                  </div>
                  {topBanks.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {topBanks.map(([slug, n]) => (
                        <Link
                          key={slug}
                          href={`/dashboard/bancos/${slug}`}
                          className="text-xs text-gray-500 hover:text-blue-600 hover:underline"
                        >
                          {bankNameBySlug[slug] ?? slug} ({n})
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {flagEvents.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <strong>Sin datos de clustering.</strong> Aplica las migraciones 006 y 007 en el SQL editor
          de Supabase y luego llama a{' '}
          <code className="font-mono text-xs">POST /api/cluster-flags</code>.
        </div>
      )}
    </div>
  )
}
