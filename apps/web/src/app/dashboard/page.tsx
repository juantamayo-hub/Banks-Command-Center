import { createClient } from '@/lib/supabase/server'
import StatsCard from '@/components/ui/StatsCard'
import BankFilter from '@/components/dashboard/BankFilter'
import SubmissionsTable from '@/components/dashboard/SubmissionsTable'
import Pagination from '@/components/dashboard/Pagination'
import { Suspense } from 'react'
import { ACTIVE_BANKS } from '@/lib/banks'

const PAGE_SIZE = 50

const VALID_STATUSES = new Set([
  'pending_ready', 'blocked_red_flag', 'blocked_missing_docs', 'blocked_validation',
  'sent', 'sending', 'failed', 'relaunch_requested', 'offer_received',
  'rejected', 'more_info_requested', 'unknown',
])
const VALID_SLUGS: Set<string> = new Set(ACTIVE_BANKS.map((b) => b.slug))
const SLUG_RE = /^[a-z0-9_]{1,40}$/

interface DashboardPageProps {
  searchParams: Promise<{
    status?: string
    bank?: string
    page?: string
  }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  const currentPage = Math.max(1, parseInt(params.page ?? '1', 10))
  const from = (currentPage - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = await createClient()

  // Fetch stats and banks list in parallel
  const [
    { count: sentCount },
    { count: blockedCount },
    { count: pendingCount },
    { count: failedCount },
    { count: offerCount },
    { count: unknownCount },
    { count: totalCount },
    { data: banksData },
  ] = await Promise.all([
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'sent'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .in('status', ['blocked_red_flag', 'blocked_missing_docs', 'blocked_validation']),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending_ready'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'offer_received'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'unknown'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('banks')
      .select('slug, name')
      .eq('active', true)
      .order('name', { ascending: true }),
  ])

  // Build the main table query
  let query = supabase
    .from('sheet_rows')
    .select(
      'id, opportunity_id, nombre_cliente, importe, status, status_raw, red_flags, timestamp_sent, timestamp_entry, synced_at, owner, banks(name, slug)',
      { count: 'exact' }
    )
    .order('timestamp_sent', { ascending: false, nullsFirst: false })
    .range(from, to)

  // Apply status filter — only accept known enum values
  if (params.status) {
    const statuses = params.status.split(',').filter((s) => VALID_STATUSES.has(s))
    if (statuses.length === 1) {
      query = query.eq('status', statuses[0])
    } else if (statuses.length > 1) {
      query = query.in('status', statuses)
    }
  }

  // Apply bank filter — validate slug format and known list before DB call
  if (params.bank && SLUG_RE.test(params.bank) && VALID_SLUGS.has(params.bank)) {
    const { data: bankData } = await supabase
      .from('banks')
      .select('id')
      .eq('slug', params.bank)
      .single()

    if (bankData) {
      query = query.eq('bank_id', bankData.id)
    }
  }

  const { data: rows, count: filteredCount } = await query

  const banks = banksData ?? []
  const tableRows = rows ?? []
  const tableTotal = filteredCount ?? 0

  // Determine active filter label
  let filterLabel = 'Todos los envios'
  if (params.status) {
    const statusMap: Record<string, string> = {
      sent: 'Enviados',
      pending_ready: 'Pendientes',
      failed: 'Fallidos',
      offer_received: 'Ofertas recibidas',
      'blocked_red_flag,blocked_missing_docs,blocked_validation': 'Bloqueados',
    }
    filterLabel = statusMap[params.status] ?? params.status
  }
  if (params.bank) {
    const bankName = banks.find((b) => b.slug === params.bank)?.name
    filterLabel += bankName ? ` — ${bankName}` : ''
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Dashboard de envios</h1>
        <p className="mt-1 text-sm text-gray-500">
          Vision general del estado de los envios bancarios.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatsCard
          label="Total"
          value={totalCount ?? 0}
          href="/dashboard"
          color="text-gray-900"
        />
        <StatsCard
          label="Enviados"
          value={sentCount ?? 0}
          href="/dashboard?status=sent"
          color="text-green-700"
        />
        <StatsCard
          label="Pendientes"
          value={pendingCount ?? 0}
          href="/dashboard?status=pending_ready"
          color="text-blue-700"
        />
        <StatsCard
          label="Bloqueados"
          value={blockedCount ?? 0}
          href="/dashboard?status=blocked_red_flag,blocked_missing_docs,blocked_validation"
          color="text-orange-700"
        />
        <StatsCard
          label="Fallidos"
          value={failedCount ?? 0}
          href="/dashboard?status=failed"
          color="text-red-700"
        />
        <StatsCard
          label="Ofertas"
          value={offerCount ?? 0}
          href="/dashboard?status=offer_received"
          color="text-emerald-700"
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{filterLabel}</span>
          <span className="text-sm text-gray-400">
            ({tableTotal.toLocaleString('es-ES')} resultados)
          </span>
        </div>
        <Suspense fallback={null}>
          <BankFilter banks={banks} currentBank={params.bank} />
        </Suspense>
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
        <Pagination
          totalCount={tableTotal}
          currentPage={currentPage}
          pageSize={PAGE_SIZE}
        />
      </Suspense>

      {/* Unknown status note */}
      {(unknownCount ?? 0) > 0 && !params.status && (
        <p className="text-xs text-gray-400">
          {unknownCount} envios con estado desconocido no clasificado.
        </p>
      )}
    </div>
  )
}
