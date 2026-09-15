'use client'

import { useEffect, useState, useCallback } from 'react'
import PlatformDispatchCard from '@/components/dashboard/PlatformDispatchCard'
import KutxabankCard from '@/components/dashboard/KutxabankCard'
import type { PlatformDealItem } from '@/app/api/platform-dispatches/route'
import { PLATFORM_BANKS, BANK_COLOR, BANK_ICON, type PlatformBankName } from '@/lib/platformDispatch'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

interface KutxabankSubmission {
  id: string
  deal_id: number
  bank_deal_id: number | null
  nombre_cliente: string | null
  dni: string | null
  plan: string | null
  zip_file_id: string | null
  zip_drive_link: string | null
  missing_docs: string[]
  rastreator_status: 'pending' | 'approved' | 'rejected' | 'sent'
  sent_at: string | null
  created_at: string
}

type BankFilter = PlatformBankName | 'Kutxabank' | 'Todos'

const KUTXABANK_COLOR = 'bg-teal-50 text-teal-700 border-teal-200'

export default function EnviosPlataformaPage() {
  const [deals, setDeals] = useState<PlatformDealItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bankFilter, setBankFilter] = useState<BankFilter>('Todos')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Kutxabank
  const [kutxaSubs, setKutxaSubs] = useState<KutxabankSubmission[]>([])
  const [kutxaLoading, setKutxaLoading] = useState(true)
  const [kutxaError, setKutxaError] = useState<string | null>(null)

  const fetchDeals = useCallback(async (from?: string, to?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (from) params.set('date_from', from)
      if (to) params.set('date_to', to)
      const url = '/api/platform-dispatches' + (params.size > 0 ? '?' + params.toString() : '')
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Error al cargar')
        return
      }
      setDeals(data.deals ?? [])
    } catch {
      setError('Error de red')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchKutxa = useCallback(async () => {
    setKutxaLoading(true)
    setKutxaError(null)
    try {
      const res = await fetch('/api/kutxabank/submissions')
      const data = await res.json()
      if (!res.ok) {
        setKutxaError(data?.error ?? 'Error al cargar Kutxabank')
        return
      }
      setKutxaSubs(data.submissions ?? [])
    } catch {
      setKutxaError('Error de red')
    } finally {
      setKutxaLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDeals(dateFrom || undefined, dateTo || undefined)
    const interval = setInterval(
      () => fetchDeals(dateFrom || undefined, dateTo || undefined),
      2 * 60 * 1000
    )
    return () => clearInterval(interval)
  }, [fetchDeals, dateFrom, dateTo])

  useEffect(() => {
    fetchKutxa()
    const interval = setInterval(fetchKutxa, 2 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchKutxa])

  function removeDeal(dealId: number) {
    setDeals((prev) => prev.filter((d) => d.deal_id !== dealId))
  }

  function removeKutxa(id: string) {
    setKutxaSubs((prev) => prev.filter((s) => s.id !== id))
  }

  // Unified filtering
  const isKutxaFilter = bankFilter === 'Kutxabank'
  const isPlatformFilter = PLATFORM_BANKS.includes(bankFilter as PlatformBankName)

  const filteredDeals =
    bankFilter === 'Todos'
      ? deals
      : isPlatformFilter
        ? deals.filter((d) => d.banks.some((b) => b.name === bankFilter))
        : [] // Kutxabank filter → hide platform deals

  const filteredKutxa =
    bankFilter === 'Todos' || isKutxaFilter
      ? kutxaSubs
      : [] // Platform bank filter → hide kutxa

  const bothLoading = loading && kutxaLoading
  const anyError = error || kutxaError
  const totalPending = deals.length + kutxaSubs.length
  const totalFiltered = filteredDeals.length + filteredKutxa.length

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <PageHeader
        title="Envíos por plataforma"
        subtitle="Deals en Doc. Completed con bancos de envío manual."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }]}
        actions={
          <>
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5">
              <span className="text-xs text-gray-500 whitespace-nowrap">Desde</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="text-sm text-gray-700 border-none outline-none bg-transparent"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5">
              <span className="text-xs text-gray-500 whitespace-nowrap">Hasta</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="text-sm text-gray-700 border-none outline-none bg-transparent"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo('') }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Limpiar
              </button>
            )}
            <button
              onClick={() => {
                void fetchDeals(dateFrom || undefined, dateTo || undefined)
                void fetchKutxa()
              }}
              disabled={loading}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Cargando…' : '↻ Actualizar'}
            </button>
          </>
        }
      />

      {/* ── Filter pills ─────────────────────────────────────────────────── */}
      {!bothLoading && !anyError && totalPending > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setBankFilter('Todos')}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              bankFilter === 'Todos'
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            Todos ({totalPending})
          </button>
          {PLATFORM_BANKS.map((bank) => {
            const count = deals.filter((d) => d.banks.some((b) => b.name === bank)).length
            if (count === 0) return null
            return (
              <button
                key={bank}
                onClick={() => setBankFilter(bankFilter === bank ? 'Todos' : bank)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  bankFilter === bank
                    ? BANK_COLOR[bank] + ' border-current'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                <img src={BANK_ICON[bank]} alt={bank} width={14} height={14} className="rounded-sm" />
                {bank} ({count})
              </button>
            )
          })}
          {kutxaSubs.length > 0 && (
            <button
              onClick={() => setBankFilter(bankFilter === 'Kutxabank' ? 'Todos' : 'Kutxabank')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                bankFilter === 'Kutxabank'
                  ? KUTXABANK_COLOR + ' border-current'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              <img src={BANK_ICON.Kutxabank} alt="Kutxabank" width={14} height={14} className="rounded-sm" />
              Kutxabank ({kutxaSubs.length})
            </button>
          )}
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {bothLoading && (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white py-14">
          <div className="text-center">
            <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600" />
            <p className="text-sm text-gray-400">Consultando Pipedrive…</p>
          </div>
        </div>
      )}

      {/* ── Errors ───────────────────────────────────────────────────────── */}
      {!bothLoading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => void fetchDeals(dateFrom || undefined, dateTo || undefined)}
            className="mt-3 text-sm text-red-600 underline hover:text-red-800"
          >
            Reintentar
          </button>
        </div>
      )}
      {!bothLoading && kutxaError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{kutxaError}</p>
          <button
            onClick={fetchKutxa}
            className="mt-3 text-sm text-red-600 underline hover:text-red-800"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {!bothLoading && !anyError && totalFiltered === 0 && (
        <EmptyState
          title={bankFilter === 'Todos'
            ? 'No hay envíos pendientes'
            : `Sin pendientes para ${bankFilter}`
          }
        />
      )}

      {/* ── Unified card grid ────────────────────────────────────────────── */}
      {!bothLoading && totalFiltered > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredDeals.map((deal) => (
            <PlatformDispatchCard
              key={`pd-${deal.deal_id}`}
              dealId={deal.deal_id}
              dealTitle={deal.deal_title}
              personName={deal.person_name}
              banks={deal.banks}
              onAllSent={() => removeDeal(deal.deal_id)}
              santander_info={deal.santander_info}
            />
          ))}
          {filteredKutxa.map((sub) => (
            <KutxabankCard
              key={`kx-${sub.id}`}
              submission={sub}
              onSent={removeKutxa}
            />
          ))}
        </div>
      )}
    </div>
  )
}
