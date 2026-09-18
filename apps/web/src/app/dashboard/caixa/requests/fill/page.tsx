'use client'

import { useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'

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
    <div className="p-6 md:p-8 min-h-full flex flex-col items-center max-w-3xl mx-auto w-full">
      <div className="mb-8 w-full">
        <PageHeader
          title="Rellenar formulario CaixaBank"
          subtitle="Genera el Excel de consultas para enviar a CaixaBank con los tickets abiertos del día seleccionado."
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'CaixaBank', href: '/dashboard/caixa/respuestas' },
            { label: 'Requests', href: '/dashboard/caixa/requests' },
          ]}
        />
      </div>

      <div className="w-full space-y-5">
        {/* Main card */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {/* Sky accent strip */}
          <div className="h-1.5 bg-gradient-to-r from-sky-400 to-sky-500" />

          <div className="p-6">
            {/* Bank logo + title */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 border border-sky-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/banks/caixabank.png" alt="CaixaBank" className="h-7 w-7 object-contain" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Generar Excel de consultas</p>
                <p className="text-xs text-gray-400">Tickets abiertos con External ID de Pipedrive</p>
              </div>
            </div>

            {/* Date range */}
            <div className="mb-5 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700" htmlFor="fill-date-from">
                  Desde
                </label>
                <input
                  id="fill-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  disabled={loading}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm shadow-sm focus:border-sky-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-300 disabled:opacity-50 transition-colors"
                />
              </div>
              <span className="text-gray-300">—</span>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700" htmlFor="fill-date-to">
                  Hasta
                </label>
                <input
                  id="fill-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  disabled={loading}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm shadow-sm focus:border-sky-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-300 disabled:opacity-50 transition-colors"
                />
              </div>
            </div>

            <p className="mb-5 text-xs text-gray-400">
              Se incluyen tickets de CaixaBank con status &ne; closed creados en el rango seleccionado.
              Por cada ticket se consulta el External ID del deal en Pipedrive.
            </p>

            <button
              onClick={handleGenerate}
              disabled={loading || !dateFrom || !dateTo}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Generando…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Generar y descargar Excel
                </>
              )}
            </button>

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-2">
                <svg className="h-4 w-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Workflow info */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Cómo funciona</p>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50">
                <svg className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
              </div>
              <p className="text-xs font-medium text-gray-700">Seleccionar fechas</p>
              <p className="text-[11px] text-gray-400 leading-tight">Rango de tickets a incluir</p>
            </div>
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50">
                <svg className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
              </div>
              <p className="text-xs font-medium text-gray-700">Consultar Pipedrive</p>
              <p className="text-[11px] text-gray-400 leading-tight">External ID por cada ticket</p>
            </div>
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50">
                <svg className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              </div>
              <p className="text-xs font-medium text-gray-700">Descargar Excel</p>
              <p className="text-[11px] text-gray-400 leading-tight">Listo para enviar a CaixaBank</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
