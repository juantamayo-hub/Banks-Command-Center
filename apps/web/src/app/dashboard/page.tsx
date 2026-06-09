import { createClient } from '@/lib/supabase/server'
import StatsCard from '@/components/ui/StatsCard'
import BankFilter from '@/components/dashboard/BankFilter'
import SubmissionsTable from '@/components/dashboard/SubmissionsTable'
import Pagination from '@/components/dashboard/Pagination'
import SearchInput from '@/components/dashboard/SearchInput'
import { Suspense } from 'react'
import { ACTIVE_BANKS } from '@/lib/banks'

const PAGE_SIZE = 50

const VALID_SLUGS: Set<string> = new Set(ACTIVE_BANKS.map((b) => b.slug))
const SLUG_RE = /^[a-z0-9_]{1,40}$/

interface DashboardPageProps {
  searchParams: Promise<{
    tab?: string
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

  const tab: 'pendientes' | 'enviados' =
    params.tab === 'enviados' ? 'enviados' : 'pendientes'

  const supabase = await createClient()

  // Counts and bank list in parallel
  const [
    { count: pendingCount },
    { count: sentCount },
    { data: banksData },
  ] = await Promise.all([
    supabase.from('sheet_rows').select('*', { count: 'exact', head: true }).neq('status', 'sent'),
    supabase.from('sheet_rows').select('*', { count: 'exact', head: true }).eq('status', 'sent'),
    supabase.from('banks').select('slug, name').eq('active', true).order('name', { ascending: true }),
  ])

  // Main table query
  let query = supabase
    .from('sheet_rows')
    .select(
      'id, opportunity_id, bank_deal_id, nombre_cliente, importe, status, status_raw, red_flags, notas, timestamp_sent, timestamp_entry, synced_at, owner, sheet_row_number, banks(name, slug, has_dispatch)',
      { count: 'exact' }
    )

  if (tab === 'enviados') {
    query = query
      .eq('status', 'sent')
      .order('timestamp_sent', { ascending: false, nullsFirst: false })
  } else {
    query = query
      .neq('status', 'sent')
      .order('timestamp_entry', { ascending: false, nullsFirst: false })
  }

  query = query.range(from, to)

  // Bank filter
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

  // Text search
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

  // Build URL param fragments for tab links (preserves bank + q filters)
  const bankParam = params.bank ? `&bank=${encodeURIComponent(params.bank)}` : ''
  const qParam = q ? `&q=${encodeURIComponent(q)}` : ''

  const bankName = params.bank ? banks.find((b) => b.slug === params.bank)?.name : null

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

      {/* Stats — just two cards */}
      <div className="grid grid-cols-2 gap-3 max-w-xs">
        <StatsCard
          label="Pendientes"
          value={pendingCount ?? 0}
          href="/dashboard?tab=pendientes"
          color="text-blue-700"
        />
        <StatsCard
          label="Enviados"
          value={sentCount ?? 0}
          href="/dashboard?tab=enviados"
          color="text-green-700"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <a
          href={`/dashboard?tab=pendientes${bankParam}${qParam}`}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            tab === 'pendientes'
              ? 'border-b-2 border-indigo-600 text-indigo-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Pendientes&nbsp;
          <span className="text-xs tabular-nums">({(pendingCount ?? 0).toLocaleString('es-ES')})</span>
        </a>
        <a
          href={`/dashboard?tab=enviados${bankParam}${qParam}`}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            tab === 'enviados'
              ? 'border-b-2 border-indigo-600 text-indigo-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Enviados&nbsp;
          <span className="text-xs tabular-nums">({(sentCount ?? 0).toLocaleString('es-ES')})</span>
        </a>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {tab === 'pendientes' ? 'Pendientes' : 'Enviados'}
            {bankName ? ` — ${bankName}` : ''}
            {q ? ` · "${q}"` : ''}
          </span>
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
        mode={tab}
      />

      {/* Pagination */}
      <Suspense fallback={null}>
        <Pagination totalCount={tableTotal} currentPage={currentPage} pageSize={PAGE_SIZE} />
      </Suspense>
    </div>
  )
}
