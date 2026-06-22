'use client'

import { useState, useEffect, useCallback } from 'react'

interface Deal {
  deal_id: number
  deal_title: string
  person_name: string
  add_time: string
}

const REFRESH_MS = 5 * 60 * 1000

export default function DocCompletedWidget() {
  const [deals, setDeals]       = useState<Deal[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch('/api/doc-completed')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      setDeals(data.deals ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDeals()
    const interval = setInterval(fetchDeals, REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchDeals])

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Doc. Completados</h2>
          {!loading && !error && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {deals.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          title="Ver todos"
        >
          🔍 Ver todos
        </button>
      </div>

      {loading && <p className="text-xs text-gray-400">Cargando…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!loading && !error && deals.length === 0 && (
        <p className="text-xs text-gray-400">No hay deals en Doc. Completados.</p>
      )}
      {!loading && !error && deals.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {deals.slice(0, 5).map((d) => (
            <li key={d.deal_id} className="flex items-center justify-between gap-2">
              <a
                href={`https://mdsl.pipedrive.com/deal/${d.deal_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-sm text-gray-700 hover:text-indigo-600 hover:underline"
              >
                {d.deal_title}
              </a>
              <span className="shrink-0 text-xs text-gray-400">{d.person_name}</span>
            </li>
          ))}
          {deals.length > 5 && (
            <li className="text-xs text-gray-400">+{deals.length - 5} más</li>
          )}
        </ul>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">
                Doc. Completados — {deals.length} deals
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="overflow-auto max-h-[60vh]">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Deal ID</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Título</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {deals.map((d) => (
                    <tr key={d.deal_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-500 tabular-nums">
                        <a
                          href={`https://mdsl.pipedrive.com/deal/${d.deal_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-indigo-600 underline"
                        >
                          {d.deal_id}
                        </a>
                      </td>
                      <td className="px-4 py-2 text-gray-700">{d.person_name || '—'}</td>
                      <td className="px-4 py-2 text-gray-700">{d.deal_title}</td>
                      <td className="px-4 py-2 text-gray-400 tabular-nums whitespace-nowrap">
                        {d.add_time ? new Date(d.add_time).toLocaleDateString('es-ES') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
