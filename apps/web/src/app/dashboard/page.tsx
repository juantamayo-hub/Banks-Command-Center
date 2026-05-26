import { createClient } from '@/lib/supabase/server'
import StatsCard from '@/components/ui/StatsCard'
import BankFilter from '@/components/dashboard/BankFilter'
import SubmissionsTable from '@/components/dashboard/SubmissionsTable'
import Pagination from '@/components/dashboard/Pagination'
import SearchInput from '@/components/dashboard/SearchInput'
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

// These statuses only make sense for banks with dispatch — exclude manual banks
const DISPATCH_ONLY_STATUSES = new Set([
  'pending_ready', 'blocked_red_flag', 'blocked_missing_docs', 'blocked_validation', 'failed',
])

interface DashboardPageProps {
  searchParams: Promise<{
    status?: string
    bank?: string
    page?: string
    q?: string
  }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  const currentPage = Math.max(1, parseInt(params.page ?? '1', 10))
  const from = (currentPage - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const q = (params.q ?? '').trim().slice(0, 100)

  const supabase = await createClient()

  // Fetch dispatch-enabled bank IDs first (used to exclude manual banks from
  // pending/blocked/failed stats and table views)
  const { data: dispatchBanksData } = await supabase
    .from('banks')
    .select('id')
    .eq('has_dispatch', true)
    .eq('active', true)
  const dispatchBankIds: string[] = (dispatchBanksData ?? []).map((b) => (b as { id: string }).id)

  // Determine if the current status filter only shows platform-actionable statuses
  const activeStatuses = params.status
    ? params.status.split(',').filter((s) => VALID_STATUSES.has(s))
    : []
  const isDispatchOnlyView =
    activeStatuses.length > 0 && activeStatuses.every((s) => DISPATCH_ONLY_STATUSES.has(s))

  // Fetch stats and banks list in parallel
  // pending, blocked, failed counts exclude manual-only banks
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
    supabase.from('sheet_rows').select('*', { count: 'exact', head: true }).eq('status', 'sent'),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .in('status', ['blocked_red_flag', 'blocked_missing_docs', 'blocked_validation'])
      .in('bank_id', dispatchBankIds),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending_ready')
      .in('bank_id', dispatchBankIds),
    supabase
      .from('sheet_rows')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
      .in('bank_id', dispatchBankIds),
    supabase.from('sheet_rows').select('*', { count: 'exact', head: true }).eq('status', 'offer_received'),
    supabase.from('sheet_rows').select('*', { count: 'exact', head: true }).eq('status', 'unknown'),
    supabase.from('sheet_rows').select('*', { count: 'exact', head: true }),
    supabase.from('banks').select('slug, name').eq('active', true).order('name', { ascending: true }),
  ])

  // Build the main table query
  let query = supabase
    .from('sheet_rows')
    .select(
      'id, opportunity_id, bank_deal_id, nombre_cliente, importe, status, status_raw, red_flags, timestamp_sent, timestamp_entry, synced_at, owner, sheet_row_number, banks(name, slug, has_dispatch)',
      { count: 'exact' }
    )
    .order('timestamp_sent', { ascending: false, nullsFirst: false })
    .range(from, to)

  // Status filter
  if (activeStatuses.length === 1) {
    query = query.eq('status', activeStatuses[0])
  } else if (activeStatuses.length > 1) {
    query = query.in('status', activeStatuses)
  }

  // Exclude manual-only banks from platform-actionable views
  if (isDispatchOnlyView && dispatchBankIds.length > 0) {
    query = query.in('bank_id', dispatchBankIds)
  }

  // Bank filter — validate slug format and known list before DB call
  if (params.bank && SLUG_RE.test(params.bank) && VALID_SLUGS.has(params.bank)) {
    const { data: bankData } = await supabase
      .from('banks')
      .select('id')
      .eq('slug', params.bank)
      .single()

    if (bankData) {
      query = query.eq('bank_id', (bankData as { id: string }).id)
    }
  }

  // Text search: numeric → match opportunity_id or bank_deal_id; text → ilike nombre_cliente
  if (q) {
    if (/^\d+$/.test(q)) {
      const numVal = parseInt(q, 10)
      query = query.or(`opportunity_id.eq.${numVal},bank_deal_id.eq.${numVal}`)
    } else {
      query = query.ilike('nombre_cliente', `%${q}%`)
    }
  }

  const { data: rows, count: filteredCount } = await query

  const banks = banksData ?? []
  const tableRows = rows ?? []
  const tableTotal = filteredCount ?? 0

  // Determine active filter label
  let filterLabel = 'Todos los envíos'
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
  if (q) {
    filterLabel += ` · "${q}"`
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--bayteca-green)' }}>
          Dashboard de envíos
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Visión general del estado de los envíos bancarios.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatsCard label="Total" value={totalCount ?? 0} href="/dashboard" color="text-gray-900" />
        <StatsCard label="Enviados" value={sentCount ?? 0} href="/dashboard?status=sent" color="text-green-700" />
        <StatsCard label="Pendientes" value={pendingCount ?? 0} href="/dashboard?status=pending_ready" color="text-blue-700" />
        <StatsCard
          label="Bloqueados"
          value={blockedCount ?? 0}
          href="/dashboard?status=blocked_red_flag,blocked_missing_docs,blocked_validation"
          color="text-orange-700"
        />
        <StatsCard label="Fallidos" value={failedCount ?? 0} href="/dashboard?status=failed" color="text-red-700" />
        <StatsCard label="Ofertas" value={offerCount ?? 0} href="/dashboard?status=offer_received" color="text-emerald-700" />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{filterLabel}</span>
          <span className="text-sm text-gray-400">
            ({tableTotal.toLocaleString('es-ES')} resultados)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Suspense fallback={null}>
            <SearchInput defaultValue={q || undefined} />
          </Suspense>
          <Suspense fallback={null}>
            <BankFilter banks={banks} currentBank={params.bank} />
          </Suspense>
        </div>
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

      {/* Unknown status note */}
      {(unknownCount ?? 0) > 0 && !params.status && (
        <p className="text-xs text-gray-400">
          {unknownCount} envíos con estado desconocido no clasificado.
        </p>
      )}
    </div>
  )
}
