'use client'

import { useState, useRef, useCallback } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import * as XLSX from 'xlsx'
import type { ParsedCaixaRow } from '@/app/api/caixa/process/route'

// ── Column indices (0-based) ──────────────────────────────────────────────────
const COL = {
  NUMERO_PETICION: 1,  // B
  NOMBRE_OP: 2,        // C
  ESTADO_LEAD: 3,      // D
  MOTIVO_PENDIENTE: 4, // E
  RESOLUCION: 5,       // F
  FECHA_FIRMA: 6,      // G
  FECHA_CREACION: 8,   // I
  LLAMADAS: 13,        // N
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProcessResponse {
  total: number
  processed: number
  skipped: number
  errors: number
  results: Array<{
    numero_peticion: string
    deal_id: string
    status: 'processed' | 'skipped' | 'error'
    detail?: string
    pipedrive_note_id?: string
    lost_reason_id?: number
    lost_reason_label?: string
    marked_lost?: boolean
    stage_id?: number
    stage_name?: string
    stage_updated?: boolean
    marked_won?: boolean
    hub_comment_added?: boolean
    hub_ticket_id?: string
    reopened?: boolean
  }>
}

type Stage = 'idle' | 'previewing' | 'processing' | 'done'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses a date string that may be in "d/m/yyyy" format (Caixa's Fecha de creación)
 * where the month has no leading zero (e.g. "21/6/2026").
 */
function parseFechaCreacion(raw: string): Date | null {
  if (!raw) return null
  // Check d/m/yyyy FIRST — JS parses "02/06/2026" as Feb 6 (m/d/yyyy American), not Jun 2
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10))
  const d = new Date(raw)
  if (!isNaN(d.getTime())) return d
  return null
}

function cellStr(row: unknown[], idx: number): string {
  const val = (row as unknown[])[idx]
  if (val == null) return ''
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  return String(val).trim()
}

function parseWorkbook(wb: import('xlsx').WorkBook, rawStrings = false): ParsedCaixaRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]]
  // raw:false when rawStrings=true (CSV) → sheet_to_json returns cell text instead of raw values,
  // needed because XLSX.read with raw:true preserves string types but sheet_to_json still needs
  // raw:false to return the string value rather than the underlying number
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: !rawStrings })

  // Skip header row
  return raw.slice(1).flatMap((row) => {
    const numeroPeticion = cellStr(row as unknown[], COL.NUMERO_PETICION)
    if (!numeroPeticion) return []
    return [{
      numero_peticion: numeroPeticion,
      col_C: cellStr(row as unknown[], COL.NOMBRE_OP),
      col_D: cellStr(row as unknown[], COL.ESTADO_LEAD),
      col_E: cellStr(row as unknown[], COL.MOTIVO_PENDIENTE),
      col_F: cellStr(row as unknown[], COL.RESOLUCION),
      col_G: cellStr(row as unknown[], COL.FECHA_FIRMA),
      col_I: cellStr(row as unknown[], COL.FECHA_CREACION),
      col_N: cellStr(row as unknown[], COL.LLAMADAS),
    }]
  })
}

function StatusBadge({ status }: { status: 'processed' | 'skipped' | 'error' }) {
  const styles = {
    processed: 'bg-green-100 text-green-800',
    skipped:   'bg-gray-100 text-gray-600',
    error:     'bg-red-100 text-red-700',
  }
  const labels = { processed: 'Procesado', skipped: 'Omitido', error: 'Error' }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CaixaRespuestasPage() {
  const [stage, setStage] = useState<Stage>('idle')
  const [dateFrom, setDateFrom] = useState('2026-04-01')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedCaixaRow[]>([])
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
          ? XLSX.read(e.target!.result as string, { type: 'string', raw: true })  // raw:true preserves "03/06/2026" as string; without it xlsx converts to serial using m/d/yyyy (American) losing Spanish d/m/yyyy
          : XLSX.read(e.target!.result as ArrayBuffer, { type: 'array', cellDates: true })
        const rows = parseWorkbook(wb, isCSV)
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
    e.preventDefault()
    setDragOver(false)
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
      const res = await fetch('/api/caixa/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows, date_from: dateFrom }),
      })
      const data: ProcessResponse = await res.json()
      setResponse(data)
      setStage('done')
    } catch (err) {
      alert(`Error al procesar: ${err instanceof Error ? err.message : String(err)}`)
      setStage('previewing')
    }
  }, [parsedRows, dateFrom])

  const reset = useCallback(() => {
    setStage('idle')
    setFileName(null)
    setParsedRows([])
    setResponse(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // Filter rows by date (from) for preview count
  const filteredCount = parsedRows.filter((r) => {
    if (!r.col_I) return true
    const d = parseFechaCreacion(r.col_I)
    if (!d) return true
    if (d < new Date(dateFrom)) return false
    return true
  }).length

  return (
    <div className="p-6 md:p-8 min-h-full flex flex-col items-center max-w-3xl mx-auto w-full">
      <div className="mb-8 w-full">
        <PageHeader
          title="Respuestas de Caixa"
          subtitle="Sube el Excel diario. Se añadirán notas en Pipedrive y se marcarán los deals cerrados como perdidos con el motivo correcto."
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'CaixaBank', href: '/dashboard/caixa/respuestas' },
          ]}
        />
      </div>

      {/* Date filter */}
      <div className="mb-6 flex items-center gap-2 w-full">
        <label className="text-sm font-medium text-gray-700" htmlFor="date-from">
          Desde:
        </label>
        <input
          id="date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          disabled={stage === 'processing'}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
      </div>

      {/* Drop zone — only when idle */}
      {stage === 'idle' && (
        <div className="w-full space-y-5">
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed px-8 py-14 transition-all duration-200 ${
            dragOver
              ? 'border-sky-400 bg-sky-50 shadow-lg shadow-sky-100/50 scale-[1.01]'
              : 'border-sky-200 bg-gradient-to-b from-white to-sky-50/30 hover:border-sky-300 hover:bg-sky-50/30 hover:shadow-md'
          }`}
        >
          <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px' }} />
          <div className={`relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border transition-all duration-200 ${
            dragOver ? 'border-sky-200 bg-sky-100 shadow-md' : 'border-sky-100 bg-white shadow-sm group-hover:border-sky-200 group-hover:shadow-md'
          }`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/banks/caixabank.png" alt="CaixaBank" className="h-10 w-10 rounded-lg object-contain" />
          </div>
          <svg className={`mb-3 h-8 w-8 transition-colors ${dragOver ? 'text-sky-500' : 'text-sky-300 group-hover:text-sky-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 3.75 3.75 0 013.467 5.159A4.502 4.502 0 0117.25 19.5H6.75z" /></svg>
          <p className="text-sm font-semibold text-gray-800">{dragOver ? 'Suelta el archivo aquí' : 'Arrastra el Excel diario de CaixaBank'}</p>
          <p className="mt-1 text-xs text-gray-400">o haz clic para seleccionar un archivo</p>
          <div className="mt-4 flex items-center gap-2">
            {['.xlsx', '.xls', '.csv'].map((f) => <span key={f} className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-600 ring-1 ring-inset ring-sky-200">{f}</span>)}
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
        </div>

        {/* Workflow info */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Qué hace este proceso</p>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50"><svg className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg></div>
              <p className="text-xs font-medium text-gray-700">Subir Excel</p>
              <p className="text-[11px] text-gray-400 leading-tight">Dossier diario de respuestas</p>
            </div>
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50"><svg className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg></div>
              <p className="text-xs font-medium text-gray-700">Analizar filas</p>
              <p className="text-[11px] text-gray-400 leading-tight">Notas en PD + marcar perdidos</p>
            </div>
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50"><svg className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
              <p className="text-xs font-medium text-gray-700">Resultado</p>
              <p className="text-[11px] text-gray-400 leading-tight">Resumen detallado por fila</p>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Preview */}
      {stage === 'previewing' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Vista previa</h2>
          <div className="mb-5 grid grid-cols-3 gap-4 text-center">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-2xl font-bold text-gray-900">{parsedRows.length}</p>
              <p className="mt-1 text-xs text-gray-500">Filas en el archivo</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-2xl font-bold text-blue-700">{filteredCount}</p>
              <p className="mt-1 text-xs text-gray-500">Filtradas por fecha</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-700 truncate">{fileName}</p>
              <p className="mt-1 text-xs text-gray-500">Archivo seleccionado</p>
            </div>
          </div>
          <p className="mb-5 text-xs text-gray-400">
            La deduplicación se realiza al procesar — las filas ya procesadas se omitirán automáticamente.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleProcess}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Procesar {filteredCount} fila{filteredCount !== 1 ? 's' : ''}
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

      {/* Processing spinner */}
      {stage === 'processing' && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-12 shadow-sm">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="text-sm font-medium text-gray-700">
            Procesando {filteredCount} filas...
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Esto puede tardar unos segundos por fila (Pipedrive + Claude).
          </p>
        </div>
      )}

      {/* Done: summary + results table */}
      {stage === 'done' && response && (
        <div className="space-y-6">
          {/* Summary banner */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Resultado</h2>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-2xl font-bold text-gray-900">{response.total}</p>
                <p className="mt-1 text-xs text-gray-500">Total recibidas</p>
              </div>
              <div className="rounded-lg bg-green-50 p-4">
                <p className="text-2xl font-bold text-green-700">{response.processed}</p>
                <p className="mt-1 text-xs text-gray-500">Procesadas</p>
              </div>
              <div className="rounded-lg bg-gray-100 p-4">
                <p className="text-2xl font-bold text-gray-500">{response.skipped}</p>
                <p className="mt-1 text-xs text-gray-500">Omitidas (ya procesadas)</p>
              </div>
              <div className="rounded-lg bg-red-50 p-4">
                <p className="text-2xl font-bold text-red-700">{response.errors}</p>
                <p className="mt-1 text-xs text-gray-500">Errores</p>
              </div>
            </div>
            <div className="mt-5">
              <button
                onClick={reset}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Subir otro archivo
              </button>
            </div>
          </div>

          {/* Results table */}
          {response.results.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Número petición
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Deal ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Detalle
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {response.results.map((r, i) => (
                    <tr key={i} className={r.status === 'error' ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3 font-mono text-gray-700">{r.numero_peticion}</td>
                      <td className="px-4 py-3 text-gray-600">{r.deal_id}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r.status === 'processed' && (() => {
                          const parts: string[] = ['Nota añadida']
                          if (r.reopened) parts.push('Reabierto ↩')
                          if (r.marked_lost) parts.push(`Perdido: ${r.lost_reason_label ?? r.lost_reason_id}`)
                          if (r.stage_updated) parts.push(`Stage → ${r.stage_name}${r.marked_won ? ' · Ganado' : ''}`)
                          if (r.hub_comment_added) parts.push(`Hub ✓`)
                          return (
                            <span className={r.detail ? 'text-amber-600' : ''}>
                              {parts.join(' · ')}
                              {r.detail && <span> · ⚠️ {r.detail}</span>}
                            </span>
                          )
                        })()}
                        {r.status === 'error' && (
                          <span className="text-red-600">{r.detail}</span>
                        )}
                        {r.status === 'skipped' && (
                          <span>{r.detail}</span>
                        )}
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
