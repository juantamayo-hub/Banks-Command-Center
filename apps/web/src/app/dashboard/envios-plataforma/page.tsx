'use client'

import { useEffect, useState, useCallback } from 'react'
import PlatformDispatchCard from '@/components/dashboard/PlatformDispatchCard'
import type { PlatformDealItem } from '@/app/api/platform-dispatches/route'
import { PLATFORM_BANKS, BANK_COLOR, type PlatformBankName } from '@/lib/platformDispatch'

export default function EnviosPlataformaPage() {
  const [deals, setDeals] = useState<PlatformDealItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bankFilter, setBankFilter] = useState<PlatformBankName | 'Todos'>('Todos')

  const fetchDeals = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/platform-dispatches')
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

  useEffect(() => {
    fetchDeals()
    const interval = setInterval(fetchDeals, 2 * 60 * 1000) // auto-refresh every 2 minutes
    return () => clearInterval(interval)
  }, [fetchDeals])

  function removeDeal(dealId: number) {
    setDeals((prev) => prev.filter((d) => d.deal_id !== dealId))
  }

  const filtered =
    bankFilter === 'Todos'
      ? deals
      : deals.filter((d) => d.banks.some((b) => b.name === bankFilter))

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--bayteca-green)' }}>
            Envíos por plataforma
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Deals en <span className="font-medium">Doc. Completed</span> con bancos que requieren envío manual: CaixaBank, Abanca, Bankinter y Santander.
          </p>
        </div>
        <button
          onClick={fetchDeals}
          disabled={loading}
          className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Cargando…' : '↻ Actualizar'}
        </button>
      </div>

      {/* Summary pills */}
      {!loading && !error && (
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

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-20">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-600" />
            <p className="text-sm text-gray-400">Consultando Pipedrive…</p>
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={fetchDeals}
            className="mt-3 text-sm text-red-600 underline hover:text-red-800"
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white py-20 text-center">
          <p className="text-2xl mb-3">✅</p>
          <p className="text-sm font-medium text-gray-700">
            {bankFilter === 'Todos'
              ? 'No hay envíos pendientes'
              : `No hay envíos pendientes para ${bankFilter}`}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            No se encontraron deals en Doc. Completed con bancos de plataforma.
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
