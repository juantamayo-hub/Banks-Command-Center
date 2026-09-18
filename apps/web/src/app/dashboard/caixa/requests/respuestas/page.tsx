'use client'

import { useState, useRef, useCallback } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import * as XLSX from 'xlsx'
import type { ParsedRequestRow } from '@/app/api/caixa/requests/process/route'

// ── CSV/Excel column indices (0-based, after skipping 2 metadata rows) ────────
// Row 0: PLATAFORMA,BAYTECA,v2.0,...
// Row 1: empty
// Row 2: HEADERS → Oportunidad CaixaBank | Tipo incidencia | Notas | Respuesta | .. | .. | ID Bayteca
// Row 3+: data
const COL_OPORTUNIDAD   = 0
const COL_TIPO          = 1
const COL_NOTAS         = 2
const COL_RESPUESTA     = 3
const COL_ID_BAYTECA    = 6
const HEADER_ROW_INDEX  = 2  // 0-based row index of the header row
const DATA_START_INDEX  = 3  // data rows start here

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProcessResponse {
  total: number
  processed: number
  skipped: number
  errors: number
  results: Array<{
    oportunidad_caixa: string
    id_bayteca: string
    status: 'processed' | 'skipped' | 'error'
    detail?: string
    pipedrive_note_id?: string
    hub_comment_added?: boolean
    hub_ticket_id?: string
  }>
}

type Stage = 'idle' | 'previewing' | 'processing' | 'done'

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellStr(row: unknown[], idx: number): string {
  const val = row[idx]
  if (val == null) return ''
  return String(val).trim()
}

function parseWorkbook(wb: import('xlsx').WorkBook): ParsedRequestRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })

  // Skip metadata rows (0, 1) and header row (2), data starts at index 3
  return raw.slice(DATA_START_INDEX).flatMap((row) => {
    const idBayteca = cellStr(row as unknown[], COL_ID_BAYTECA).replace(/\D/g, '')
    if (!idBayteca) return [] // skip rows without deal ID
    return [{
      oportunidad_caixa: cellStr(row as unknown[], COL_OPORTUNIDAD),
      tipo_incidencia:   cellStr(row as unknown[], COL_TIPO),
      notas_plataforma:  cellStr(row as unknown[], COL_NOTAS),
      respuesta_caixa:   cellStr(row as unknown[], COL_RESPUESTA),
      id_bayteca:        idBayteca,
    }]
  })
}

function StatusBadge({ status }: { status: 'processed' | 'skipped' | 'error' }) {
  const styles = { processed: 'bg-green-100 text-green-800', skipped: 'bg-gray-100 text-gray-600', error: 'bg-red-100 text-red-700' }
  const labels = { processed: 'Añadida', skipped: 'Omitida', error: 'Error' }
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>{labels[status]}</span>
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CaixaRequestsRespuestasPage() {
  const [stage, setStage] = useState<Stage>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRequestRow[]>([])
  const [response, setResponse] = useState<ProcessResponse | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    setFileName(file.name)
    const isCSV = file.name.toLowerCase().endsWith('.csv')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = isCSV
          ? XLSX.read(e.target!.result as string, { type: 'string', cellDates: true })
          : XLSX.read(e.target!.result as ArrayBuffer, { type: 'array', cellDates: true })
        const rows = parseWorkbook(wb)
        setParsedRows(rows)
        setStage('previewing')
      } catch (err) {
        alert(`Error al leer el archivo: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (isCSV) {
      reader.readAsText(file, 'utf-8')
    } else {
      reader.readAsArrayBuffer(file)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleProcess = useCallback(async () => {
    setStage('processing')
    try {
      const res = await fetch('/api/caixa/requests/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows }),
      })
      const data: ProcessResponse = await res.json()
      setResponse(data)
      setStage('done')
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`)
      setStage('previewing')
    }
  }, [parsedRows])

  const reset = useCallback(() => {
    setStage('idle'); setFileName(null); setParsedRows([]); setResponse(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  return (
    <div className="p-6 md:p-8 min-h-full flex flex-col items-center max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="mb-8 w-full">
        <PageHeader
          title="Respuestas CaixaBank"
          subtitle="Sube el archivo de consultas con las respuestas de CaixaBank. Se añadirá una nota en cada deal de Pipedrive con la oportunidad, tipo de incidencia y respuesta recibida."
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'CaixaBank', href: '/dashboard/caixa/respuestas' },
            { label: 'Requests', href: '/dashboard/caixa/requests' },
          ]}
        />
      </div>

      {/* Drop zone */}
      {stage === 'idle' && (
        <div className="w-full space-y-5">
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-14 transition-all duration-200 overflow-hidden ${
              dragOver
                ? 'border-sky-400 bg-sky-50/50 shadow-lg shadow-sky-100/50 scale-[1.01]'
                : 'border-sky-200 bg-gradient-to-b from-white to-sky-50/30 hover:border-sky-300 hover:bg-sky-50/30 hover:shadow-md'
            }`}
          >
            {/* Dot pattern background */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #0284c7 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

            {/* Bank logo */}
            <div className={`relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm border transition-all duration-200 ${
              dragOver ? 'border-sky-300 shadow-sky-100' : 'border-sky-100 group-hover:border-sky-200 group-hover:shadow-md'
            }`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/banks/caixabank.png" alt="CaixaBank" className="h-10 w-10 object-contain" />
            </div>

            {/* Upload icon */}
            <svg className={`mb-3 h-8 w-8 transition-colors ${dragOver ? 'text-sky-500' : 'text-sky-300 group-hover:text-sky-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 3.75 3.75 0 013.267 5.477M6.75 19.5a4.5 4.5 0 003.375-1.5h3.75a4.5 4.5 0 003.375 1.5" />
            </svg>

            <p className="text-sm font-semibold text-gray-700">
              {dragOver ? 'Suelta el archivo aquí' : 'Arrastra el archivo de respuestas'}
            </p>
            <p className="mt-1 text-xs text-gray-400">o haz clic para seleccionarlo</p>

            {/* Format badges */}
            <div className="mt-4 flex items-center gap-2">
              {['.xlsx', '.xls', '.csv'].map((fmt) => (
                <span key={fmt} className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-600 ring-1 ring-inset ring-sky-200">{fmt}</span>
              ))}
            </div>

            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
          </div>

          {/* Workflow info panel */}
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Qué hace este proceso</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col items-center text-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50">
                  <svg className="h-4.5 w-4.5 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                </div>
                <p className="text-xs font-medium text-gray-700">Subir archivo</p>
                <p className="text-[11px] text-gray-400 leading-tight">Excel con respuestas de CaixaBank</p>
              </div>
              <div className="flex flex-col items-center text-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50">
                  <svg className="h-4.5 w-4.5 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                </div>
                <p className="text-xs font-medium text-gray-700">Buscar deals</p>
                <p className="text-[11px] text-gray-400 leading-tight">Cada fila se vincula al deal en Pipedrive</p>
              </div>
              <div className="flex flex-col items-center text-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50">
                  <svg className="h-4.5 w-4.5 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>
                </div>
                <p className="text-xs font-medium text-gray-700">Añadir notas</p>
                <p className="text-[11px] text-gray-400 leading-tight">Respuesta y tipo se registran como nota</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      {stage === 'previewing' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Vista previa</h2>
          <div className="mb-5 grid grid-cols-2 gap-4 text-center">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-2xl font-bold text-gray-900">{parsedRows.length}</p>
              <p className="mt-1 text-xs text-gray-500">Filas con deal ID</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-700 truncate">{fileName}</p>
              <p className="mt-1 text-xs text-gray-500">Archivo seleccionado</p>
            </div>
          </div>

          {/* Preview table — first 5 rows */}
          {parsedRows.length > 0 && (
            <div className="mb-5 overflow-x-auto rounded-lg border border-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">Oportunidad Caixa</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">Tipo</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">Respuesta</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">ID Bayteca</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {parsedRows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-700 font-mono">{r.oportunidad_caixa}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[160px] truncate">{r.tipo_incidencia}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate">{r.respuesta_caixa || <span className="italic text-gray-300">Sin respuesta</span>}</td>
                      <td className="px-3 py-2 text-gray-700 font-mono">{r.id_bayteca}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 5 && (
                <p className="px-3 py-2 text-xs text-gray-400">…y {parsedRows.length - 5} filas más</p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleProcess}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Añadir notas en Pipedrive ({parsedRows.length})
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Processing */}
      {stage === 'processing' && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-12 shadow-sm">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="text-sm font-medium text-gray-700">Procesando {parsedRows.length} filas…</p>
          <p className="mt-1 text-xs text-gray-400">Añadiendo notas en Pipedrive.</p>
        </div>
      )}

      {/* Done */}
      {stage === 'done' && response && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Resultado</h2>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-2xl font-bold text-gray-900">{response.total}</p>
                <p className="mt-1 text-xs text-gray-500">Total</p>
              </div>
              <div className="rounded-lg bg-green-50 p-4">
                <p className="text-2xl font-bold text-green-700">{response.processed}</p>
                <p className="mt-1 text-xs text-gray-500">Notas añadidas</p>
              </div>
              <div className="rounded-lg bg-gray-100 p-4">
                <p className="text-2xl font-bold text-gray-500">{response.skipped}</p>
                <p className="mt-1 text-xs text-gray-500">Omitidas</p>
              </div>
              <div className="rounded-lg bg-red-50 p-4">
                <p className="text-2xl font-bold text-red-700">{response.errors}</p>
                <p className="mt-1 text-xs text-gray-500">Errores</p>
              </div>
            </div>
            <button onClick={reset} className="mt-5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Subir otro archivo
            </button>
          </div>

          {/* Results table */}
          {response.results.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Oportunidad Caixa</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">ID Bayteca</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {response.results.map((r, i) => (
                    <tr key={i} className={r.status === 'error' ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3 font-mono text-gray-700">{r.oportunidad_caixa}</td>
                      <td className="px-4 py-3 text-gray-600">{r.id_bayteca}</td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r.status === 'processed' && (
                          <span className="flex flex-wrap gap-1.5 items-center">
                            <span>Nota añadida en Pipedrive</span>
                            {r.hub_comment_added && (
                              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Hub ✓</span>
                            )}
                            {r.detail && (
                              <span className="text-amber-600">{r.detail}</span>
                            )}
                          </span>
                        )}
                        {r.status === 'error' && <span className="text-red-600">{r.detail}</span>}
                        {r.status === 'skipped' && r.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
