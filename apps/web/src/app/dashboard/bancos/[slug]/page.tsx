import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import StatsCard from '@/components/ui/StatsCard'
import SubmissionsTable from '@/components/dashboard/SubmissionsTable'
import Pagination from '@/components/dashboard/Pagination'
import { Suspense } from 'react'

const PAGE_SIZE = 50

interface BankPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string; status?: string }>
}

export default async function BankPage({ params, searchParams }: BankPageProps) {
  const { slug } = await params
  const sp = await searchParams
  const currentPage = Math.max(1, parseInt(sp.page ?? '1', 10))
  const from = (currentPage - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = await createClient()

  // Resolve the bank
  const { data: bank } = await supabase
    .from('banks')
    .select('id, name, slug, has_dispatch')
    .eq('slug', slug)
    .eq('active', true)
    .single()

  if (!bank) notFound()

  // Stats + rows in parallel
  const [
    { count: sentCount },
    { count: blockedCount },
    { count: pendingCount },
    { count: failedCount },
    { count: offerCount },
    { count: totalCount },
  ] = await Promise.all([
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('bank_id', bank.id)
      .eq('status', 'sent'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('bank_id', bank.id)
      .in('status', ['blocked_red_flag', 'blocked_missing_docs', 'blocked_validation']),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('bank_id', bank.id)
      .eq('status', 'pending_ready'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('bank_id', bank.id)
      .eq('status', 'failed'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('bank_id', bank.id)
      .eq('status', 'offer_received'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('bank_id', bank.id),
  ])

  // Main table query
  let query = supabase
    .from('sheet_rows')
    .select(
      'id, opportunity_id, bank_deal_id, nombre_cliente, importe, status, status_raw, red_flags, notas, timestamp_sent, timestamp_entry, synced_at, owner, sheet_row_number, banks(name, slug, has_dispatch)',
      { count: 'exact' }
    )
    .eq('bank_id', bank.id)
    .order('timestamp_sent', { ascending: false, nullsFirst: false })
    .range(from, to)

  if (sp.status) {
    const statuses = sp.status.split(',').filter(Boolean)
    if (statuses.length === 1) {
      query = query.eq('status', statuses[0])
    } else if (statuses.length > 1) {
      query = query.in('status', statuses)
    }
  }

  const { data: rows, count: filteredCount } = await query
  const tableRows = rows ?? []
  const tableTotal = filteredCount ?? 0

  // Top red flags — bank_top_flags() RPC replaces full red_flags column fetch (HIGH-4 fix)
  const { data: flagData } = await supabase.rpc('bank_top_flags', {
    p_bank_id: bank.id,
    p_limit: 10,
  })
  const topFlags: [string, number][] = (flagData ?? []).map(
    (r: { flag: string; cnt: number }) => [r.flag, Number(r.cnt)]
  )

  const base = `/dashboard/bancos/${slug}`

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wide">Banco</p>
        <h1 className="text-xl font-semibold text-gray-900">{bank.name}</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatsCard label="Total" value={totalCount ?? 0} href={base} color="text-gray-900" />
        <StatsCard
          label="Enviados"
          value={sentCount ?? 0}
          href={`${base}?status=sent`}
          color="text-green-700"
        />
        <StatsCard
          label="Pendientes"
          value={pendingCount ?? 0}
          href={`${base}?status=pending_ready`}
          color="text-blue-700"
        />
        <StatsCard
          label="Bloqueados"
          value={blockedCount ?? 0}
          href={`${base}?status=blocked_red_flag,blocked_missing_docs,blocked_validation`}
          color="text-orange-700"
        />
        <StatsCard
          label="Fallidos"
          value={failedCount ?? 0}
          href={`${base}?status=failed`}
          color="text-red-700"
        />
        <StatsCard
          label="Ofertas"
          value={offerCount ?? 0}
          href={`${base}?status=offer_received`}
          color="text-emerald-700"
        />
      </div>

      {/* Top red flags */}
      {topFlags.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Red flags mas frecuentes</h2>
          <ul className="flex flex-col gap-1.5">
            {topFlags.map(([flag, count]) => (
              <li key={flag} className="flex items-center justify-between gap-4">
                <span className="truncate text-sm text-gray-700">{flag}</span>
                <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  {count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filter label */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <span className="text-sm font-medium text-gray-900">
          {sp.status ? sp.status : 'Todos los envios'}
        </span>
        <span className="text-sm text-gray-400">
          ({tableTotal.toLocaleString('es-ES')} resultados)
        </span>
      </div>

      {/* Table */}
      <SubmissionsTable
        rows={tableRows}
        totalCount={tableTotal}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
      />

      {/* Pagination */}
      <Suspense fallback={null}>
        <Pagination totalCount={tableTotal} currentPage={currentPage} pageSize={PAGE_SIZE} />
      </Suspense>
    </div>
  )
}
