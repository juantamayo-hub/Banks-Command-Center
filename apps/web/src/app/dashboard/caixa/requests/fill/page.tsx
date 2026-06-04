'use client'

import { useState } from 'react'

export default function CaixaRequestsFillPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/caixa/requests/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_from: dateFrom, date_to: dateTo }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as { error?: string }).error ?? `Error ${res.status}`)
      }

      // Trigger file download
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Caixa_Requests_${dateFrom}_${dateTo}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-1">
        <a href="/dashboard/caixa/requests" className="text-sm text-gray-400 hover:text-gray-600">
          Requests
        </a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-700">Rellenar formulario</span>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Rellenar formulario CaixaBank</h1>
        <p className="mt-1 text-sm text-gray-500">
          Genera el Excel de consultas para enviar a CaixaBank con los tickets
          abiertos del día seleccionado. Se rellena automáticamente el External ID
          de Pipedrive y las notas del ticket.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {/* Date range */}
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700" htmlFor="fill-date-from">
              Desde:
            </label>
            <input
              id="fill-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              disabled={loading}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700" htmlFor="fill-date-to">
              Hasta:
            </label>
            <input
              id="fill-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              disabled={loading}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        <p className="mb-5 text-xs text-gray-400">
          Se incluyen tickets de CaixaBank con status ≠ closed creados en el rango seleccionado.
          Por cada ticket se consulta el External ID del deal en Pipedrive.
        </p>

        <button
          onClick={handleGenerate}
          disabled={loading || !dateFrom || !dateTo}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Generando…
            </span>
          ) : (
            'Generar y descargar Excel'
          )}
        </button>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
