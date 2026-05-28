'use client'

import { useState, useRef, useCallback } from 'react'
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
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <a href="/dashboard/caixa/requests" className="text-sm text-gray-400 hover:text-gray-600">
            Requests
          </a>
          <span className="text-gray-300">/</span>
          <span className="text-sm text-gray-700">Procesar respuestas</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Respuestas CaixaBank</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sube el archivo de consultas con las respuestas de CaixaBank. Se añadirá
          una nota en cada deal de Pipedrive con la oportunidad, tipo de incidencia
          y respuesta recibida.
        </p>
      </div>

      {/* Drop zone */}
      {stage === 'idle' && (
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
          }`}
        >
          <span className="mb-3 text-4xl">📄</span>
          <p className="text-sm font-medium text-gray-700">
            Arrastra aquí el archivo o haz clic para seleccionarlo
          </p>
          <p className="mt-1 text-xs text-gray-400">Formatos: .xlsx, .xls, .csv</p>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
        </div>
      )}

      {/* Preview */}
      {stage === 'previewing' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-12 shadow-sm">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="text-sm font-medium text-gray-700">Procesando {parsedRows.length} filas…</p>
          <p className="mt-1 text-xs text-gray-400">Añadiendo notas en Pipedrive.</p>
        </div>
      )}

      {/* Done */}
      {stage === 'done' && response && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
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
