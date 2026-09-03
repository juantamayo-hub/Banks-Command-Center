'use client'

import { useEffect, useState, useCallback } from 'react'
import PlatformDispatchCard from '@/components/dashboard/PlatformDispatchCard'
import KutxabankCard from '@/components/dashboard/KutxabankCard'
import type { PlatformDealItem } from '@/app/api/platform-dispatches/route'
import { PLATFORM_BANKS, BANK_COLOR, type PlatformBankName } from '@/lib/platformDispatch'

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

export default function EnviosPlataformaPage() {
  const [deals, setDeals] = useState<PlatformDealItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bankFilter, setBankFilter] = useState<PlatformBankName | 'Todos'>('Todos')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Kutxabank section
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

  const filtered =
    bankFilter === 'Todos'
      ? deals
      : deals.filter((d) => d.banks.some((b) => b.name === bankFilter))

  return (
    <div className="flex flex-col gap-8 p-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--bayteca-green)' }}>
            Envíos por plataforma
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Deals en <span className="font-medium">Doc. Completed</span> con bancos de envío manual.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
        </div>
      </div>

      {/* ── Section: CaixaBank, Abanca, Bankinter, Santander ─────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700">
            CaixaBank · Abanca · Bankinter · Santander
          </h2>
          <span className="text-xs text-gray-400">{deals.length} pendientes</span>
        </div>

        {/* Bank filter pills */}
        {!loading && !error && deals.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setBankFilter('Todos')}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                bankFilter === 'Todos'
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              Todos ({deals.length})
            </button>
            {PLATFORM_BANKS.map((bank) => {
              const count = deals.filter((d) => d.banks.some((b) => b.name === bank)).length
              if (count === 0) return null
              return (
                <button
                  key={bank}
                  onClick={() => setBankFilter(bankFilter === bank ? 'Todos' : bank)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    bankFilter === bank
                      ? BANK_COLOR[bank] + ' border-current'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {bank} ({count})
                </button>
              )
            })}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-14">
            <div className="text-center">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-600" />
              <p className="text-sm text-gray-400">Consultando Pipedrive…</p>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={() => void fetchDeals(dateFrom || undefined, dateTo || undefined)}
              className="mt-3 text-sm text-red-600 underline hover:text-red-800"
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center">
            <p className="text-xl mb-2">✅</p>
            <p className="text-sm font-medium text-gray-700">
              {bankFilter === 'Todos' ? 'No hay envíos pendientes' : `Sin pendientes para ${bankFilter}`}
            </p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((deal) => (
              <PlatformDispatchCard
                key={deal.deal_id}
                dealId={deal.deal_id}
                dealTitle={deal.deal_title}
                personName={deal.person_name}
                banks={deal.banks}
                onAllSent={() => removeDeal(deal.deal_id)}
                santander_info={deal.santander_info}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section: Kutxabank ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700">Kutxabank</h2>
          <span className="text-xs text-gray-400">
            {kutxaSubs.length > 0 ? `${kutxaSubs.length} caso${kutxaSubs.length !== 1 ? 's' : ''}` : ''}
          </span>
          <span className="rounded-full bg-teal-50 border border-teal-200 px-2 py-0.5 text-xs font-medium text-teal-700">
            Listos para enviar
          </span>
        </div>

        {kutxaLoading && (
          <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-14">
            <div className="text-center">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-teal-600" />
              <p className="text-sm text-gray-400">Cargando Kutxabank…</p>
            </div>
          </div>
        )}

        {!kutxaLoading && kutxaError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center">
            <p className="text-sm text-red-700">{kutxaError}</p>
            <button
              onClick={fetchKutxa}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800"
            >
              Reintentar
            </button>
          </div>
        )}

        {!kutxaLoading && !kutxaError && kutxaSubs.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center">
            <p className="text-xl mb-2">✅</p>
            <p className="text-sm font-medium text-gray-700">No hay casos Kutxabank pendientes</p>
            <p className="text-xs text-gray-400 mt-1">
              Los casos aparecen automáticamente cuando un deal llega a Doc. Completed con Kutxabank seleccionado.
            </p>
          </div>
        )}

        {!kutxaLoading && !kutxaError && kutxaSubs.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {kutxaSubs.map((sub) => (
              <KutxabankCard
                key={sub.id}
                submission={sub}
                onSent={removeKutxa}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
