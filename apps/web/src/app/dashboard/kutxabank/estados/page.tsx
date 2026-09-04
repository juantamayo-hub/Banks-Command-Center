'use client'

import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import type { ParsedEstadosRow } from '@/app/api/kutxabank/process-estados/route'

// ── Column indices (0-based) ──────────────────────────────────────────────────
const COL = {
  DEAL_ID:           0, // A
  DNI:               1, // B
  ESTADO_RASTREATOR: 2, // C
  OTROS_COMENTARIOS: 3, // D
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProcessResponse {
  total:     number
  processed: number
  skipped:   number
  errors:    number
  no_change: number
  results: Array<{
    deal_id:          string
    dni:              string
    estado:           string
    status:           'processed' | 'skipped' | 'error' | 'no_change'
    detail?:          string
    bank_deal_id?:    number | null
    stage_updated_to?: number
    stage_name?:      string
    marked_won?:      boolean
    note_added?:      boolean
  }>
}

type Stage = 'idle' | 'previewing' | 'processing' | 'done'

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellStr(row: unknown[], idx: number): string {
  const val = row[idx]
  if (val == null) return ''
  return String(val).trim()
}

// Sheet names to look for (in order of preference)
const OPS_SHEET_NAMES = ['Ops. Enviadas', 'Ops.Enviadas', 'Ops Enviadas']

function findSheet(wb: import('xlsx').WorkBook): import('xlsx').WorkSheet {
  for (const name of OPS_SHEET_NAMES) {
    if (wb.Sheets[name]) return wb.Sheets[name]
  }
  // fallback: first sheet
  return wb.Sheets[wb.SheetNames[0]]
}

function parseWorkbook(wb: import('xlsx').WorkBook, rawStrings = false): ParsedEstadosRow[] {
  const ws = findSheet(wb)
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: !rawStrings })
  return raw.slice(1).flatMap((row) => {
    const dealId = cellStr(row as unknown[], COL.DEAL_ID)
    if (!dealId) return []
    return [{
      deal_id:           dealId,
      dni:               cellStr(row as unknown[], COL.DNI),
      estado_rastreator: cellStr(row as unknown[], COL.ESTADO_RASTREATOR),
      otros_comentarios: cellStr(row as unknown[], COL.OTROS_COMENTARIOS),
    }]
  })
}

function StatusBadge({ status }: { status: ProcessResponse['results'][number]['status'] }) {
  const styles = {
    processed: 'bg-green-100 text-green-800',
    skipped:   'bg-gray-100 text-gray-600',
    error:     'bg-red-100 text-red-700',
    no_change: 'bg-blue-100 text-blue-700',
  }
  const labels = {
    processed: 'Procesado',
    skipped:   'Omitido',
    error:     'Error',
    no_change: 'Sin cambio',
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function KutxabankEstadosPage() {
  const [stage, setStage]           = useState<Stage>('idle')
  const [fileName, setFileName]     = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedEstadosRow[]>([])
  const [response, setResponse]     = useState<ProcessResponse | null>(null)
  const [dragOver, setDragOver]     = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    setFileName(file.name)
    const isCSV = file.name.toLowerCase().endsWith('.csv')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = isCSV
          ? XLSX.read(e.target!.result as string, { type: 'string', raw: true })
          : XLSX.read(e.target!.result as ArrayBuffer, { type: 'array', cellDates: true })
        const rows = parseWorkbook(wb, isCSV)
        setParsedRows(rows)
        setStage('previewing')
      } catch (err) {
        alert(`Error al leer el archivo: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (isCSV) reader.readAsText(file, 'utf-8')
    else reader.readAsArrayBuffer(file)
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
      const res = await fetch('/api/kutxabank/process-estados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows }),
      })
      const data: ProcessResponse = await res.json()
      setResponse(data)
      setStage('done')
    } catch (err) {
      alert(`Error al procesar: ${err instanceof Error ? err.message : String(err)}`)
      setStage('previewing')
    }
  }, [parsedRows])

  const reset = useCallback(() => {
    setStage('idle')
    setFileName(null)
    setParsedRows([])
    setResponse(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const withEstado = parsedRows.filter((r) => r.estado_rastreator).length

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Kutxabank — Procesar Estados (Ops. Enviadas)</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sube el Excel "Ops. Enviadas" de Rastreator. Se actualizan los stages en Pipedrive según el estado de cada fila.
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
            dragOver ? 'border-teal-400 bg-teal-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
          }`}
        >
          <span className="mb-3 text-4xl">📊</span>
          <p className="text-sm font-medium text-gray-700">
            Arrastra aquí el Excel "Ops. Enviadas" o haz clic para seleccionarlo
          </p>
          <p className="mt-1 text-xs text-gray-400">Formatos: .xlsx, .xls, .csv</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onFileChange}
          />
        </div>
      )}

      {/* Preview */}
      {stage === 'previewing' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Vista previa</h2>
          <div className="mb-5 grid grid-cols-3 gap-4 text-center">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-2xl font-bold text-gray-900">{parsedRows.length}</p>
              <p className="mt-1 text-xs text-gray-500">Filas totales</p>
            </div>
            <div className="rounded-lg bg-teal-50 p-4">
              <p className="text-2xl font-bold text-teal-700">{withEstado}</p>
              <p className="mt-1 text-xs text-gray-500">Con estado a procesar</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-700 truncate">{fileName}</p>
              <p className="mt-1 text-xs text-gray-500">Archivo</p>
            </div>
          </div>
          <p className="mb-5 text-xs text-gray-400">
            Las filas ya procesadas con el mismo estado se omitirán automáticamente.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleProcess}
              className="rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
            >
              Procesar {withEstado} fila{withEstado !== 1 ? 's' : ''}
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
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-12 shadow-sm">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600" />
          <p className="text-sm font-medium text-gray-700">Procesando estados y actualizando Pipedrive…</p>
        </div>
      )}

      {/* Done */}
      {stage === 'done' && response && (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Resultado</h2>
            <div className="grid grid-cols-5 gap-3 text-center">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xl font-bold text-gray-900">{response.total}</p>
                <p className="mt-1 text-xs text-gray-500">Total</p>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <p className="text-xl font-bold text-green-700">{response.processed}</p>
                <p className="mt-1 text-xs text-gray-500">Procesados</p>
              </div>
              <div className="rounded-lg bg-blue-50 p-3">
                <p className="text-xl font-bold text-blue-700">{response.no_change}</p>
                <p className="mt-1 text-xs text-gray-500">Sin cambio</p>
              </div>
              <div className="rounded-lg bg-gray-100 p-3">
                <p className="text-xl font-bold text-gray-500">{response.skipped}</p>
                <p className="mt-1 text-xs text-gray-500">Omitidos</p>
              </div>
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-xl font-bold text-red-700">{response.errors}</p>
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

          {response.results.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Deal ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Resultado
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Detalle
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {response.results.map((r, i) => (
                    <tr key={i} className={r.status === 'error' ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3 font-mono text-gray-700">
                        {r.deal_id}
                        {r.bank_deal_id && (
                          <a
                            href={`https://mdsl.pipedrive.com/deal/${r.bank_deal_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-xs text-indigo-600 hover:underline"
                          >
                            Bank #{r.bank_deal_id}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{r.estado}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r.status === 'processed' && (() => {
                          const parts: string[] = []
                          if (r.stage_name) parts.push(`Stage → ${r.stage_name}`)
                          if (r.marked_won) parts.push('Marcado como ganado')
                          if (r.note_added) parts.push('Nota añadida')
                          return parts.join(' · ') || 'Sin stage change'
                        })()}
                        {r.status !== 'processed' && (r.detail || '—')}
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
