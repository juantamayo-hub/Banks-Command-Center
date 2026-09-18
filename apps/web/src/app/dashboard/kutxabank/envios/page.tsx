'use client'

import { useState, useRef, useCallback } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import * as XLSX from 'xlsx'
import type { ParsedEnviosRow } from '@/app/api/kutxabank/process-envios/route'

// ── Column indices (0-based) ──────────────────────────────────────────────────
const COL = {
  DEAL_ID:          0, // A
  DNI_1T:           1, // B
  DNI_2T:           2, // C
  IMPORTE_COMPRA:   3, // D
  IMPORTE_HIPOTECA: 4, // E
  INGRESOS_1T:      5, // F
  TIPO_CONTRATO_1T: 6, // G
  INGRESOS_2T:      7, // H
  TIPO_CONTRATO_2T: 8, // I
  RESPUESTA:        9, // J
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProcessResponse {
  total:    number
  approved: number
  rejected: number
  skipped:  number
  errors:   number
  results: Array<{
    deal_id:      string
    dni:          string
    respuesta:    string
    status:       'approved' | 'rejected' | 'skipped' | 'error'
    detail?:      string
    bank_deal_id?: number | null
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
// Kutxabank uses "1º Filtro" (ordinal º) or "1 Filtro"
const FILTRO_SHEET_NAMES = ['1º Filtro', '1° Filtro', '1 Filtro', '1er Filtro']

function findSheet(wb: import('xlsx').WorkBook): import('xlsx').WorkSheet {
  for (const name of FILTRO_SHEET_NAMES) {
    if (wb.Sheets[name]) return wb.Sheets[name]
  }
  return wb.Sheets[wb.SheetNames[0]]
}

function parseWorkbook(wb: import('xlsx').WorkBook, rawStrings = false): ParsedEnviosRow[] {
  const ws = findSheet(wb)
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: !rawStrings })
  return raw.slice(1).flatMap((row) => {
    const dealId = cellStr(row as unknown[], COL.DEAL_ID)
    if (!dealId) return []
    return [{
      deal_id:          dealId,
      dni:              cellStr(row as unknown[], COL.DNI_1T),
      dni_2t:           cellStr(row as unknown[], COL.DNI_2T),
      importe_compra:   cellStr(row as unknown[], COL.IMPORTE_COMPRA),
      importe_hipoteca: cellStr(row as unknown[], COL.IMPORTE_HIPOTECA),
      ingresos_1t:      cellStr(row as unknown[], COL.INGRESOS_1T),
      tipo_contrato_1t: cellStr(row as unknown[], COL.TIPO_CONTRATO_1T),
      ingresos_2t:      cellStr(row as unknown[], COL.INGRESOS_2T),
      tipo_contrato_2t: cellStr(row as unknown[], COL.TIPO_CONTRATO_2T),
      respuesta:        cellStr(row as unknown[], COL.RESPUESTA),
    }]
  })
}

function StatusBadge({ status }: { status: ProcessResponse['results'][number]['status'] }) {
  const styles = {
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-700',
    skipped:  'bg-gray-100 text-gray-600',
    error:    'bg-orange-100 text-orange-700',
  }
  const labels = {
    approved: 'Aprobado',
    rejected: 'Rechazado',
    skipped:  'Omitido',
    error:    'Error',
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function KutxabankEnviosPage() {
  const [stage, setStage]         = useState<Stage>('idle')
  const [fileName, setFileName]   = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedEnviosRow[]>([])
  const [response, setResponse]   = useState<ProcessResponse | null>(null)
  const [dragOver, setDragOver]   = useState(false)
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
      const res = await fetch('/api/kutxabank/process-envios', {
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

  const toSend   = parsedRows.filter((r) => r.respuesta === 'Enviar').length
  const toReject = parsedRows.filter((r) => r.respuesta === 'No enviar').length

  return (
    <div className="p-6 md:p-8 min-h-full flex flex-col items-center max-w-3xl mx-auto w-full">
      <div className="mb-8 w-full">
        <PageHeader
          title="Procesar Envíos (1 Filtro)"
          subtitle={'Sube el Excel "1 Filtro" de Rastreator. Las filas con "Enviar" se aprueban; las de "No enviar" se marcan como perdidas en Pipedrive.'}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Kutxabank', href: '/dashboard/kutxabank/envios' },
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
            className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed px-8 py-14 transition-all duration-200 ${
              dragOver
                ? 'border-teal-400 bg-teal-50 shadow-lg shadow-teal-100/50 scale-[1.01]'
                : 'border-gray-200 bg-gradient-to-b from-white to-gray-50/80 hover:border-teal-300 hover:bg-teal-50/30 hover:shadow-md'
            }`}
          >
            {/* Subtle background pattern */}
            <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px' }} />

            {/* Bank logo area */}
            <div className={`relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border transition-all duration-200 ${
              dragOver
                ? 'border-teal-200 bg-teal-100 shadow-md shadow-teal-200/40'
                : 'border-gray-100 bg-white shadow-sm group-hover:border-teal-200 group-hover:bg-teal-50 group-hover:shadow-md'
            }`}>
              <img src="/banks/kutxabank.png" alt="Kutxabank" className="h-10 w-10 rounded-lg object-contain" />
            </div>

            {/* Upload cloud icon */}
            <div className={`mb-4 transition-colors duration-200 ${dragOver ? 'text-teal-500' : 'text-gray-300 group-hover:text-teal-400'}`}>
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 3.75 3.75 0 013.467 5.159A4.502 4.502 0 0117.25 19.5H6.75z" />
              </svg>
            </div>

            {/* Main text */}
            <p className="text-sm font-semibold text-gray-800">
              {dragOver ? 'Suelta el archivo aqui' : 'Arrastra el Excel "1 Filtro" de Kutxabank aqui'}
            </p>
            <p className="mt-1.5 text-xs text-gray-400">
              o haz clic para seleccionar un archivo
            </p>

            {/* Format badges */}
            <div className="mt-4 flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-600 ring-1 ring-inset ring-teal-200/60">.xlsx</span>
              <span className="inline-flex items-center rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-600 ring-1 ring-inset ring-teal-200/60">.xls</span>
              <span className="inline-flex items-center rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-600 ring-1 ring-inset ring-teal-200/60">.csv</span>
            </div>

            {/* Security note */}
            <div className="mt-5 flex items-center gap-1.5 text-[11px] text-gray-300">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              Los datos se procesaran de forma segura
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onFileChange}
            />
          </div>

          {/* Workflow info panel */}
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Que hace este proceso</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col items-center text-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50">
                  <svg className="h-4 w-4 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-gray-700">Subir Excel</p>
                <p className="text-[11px] text-gray-400 leading-tight">Archivo &ldquo;1 Filtro&rdquo; de Rastreator</p>
              </div>
              <div className="flex flex-col items-center text-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50">
                  <svg className="h-4 w-4 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-gray-700">Clasificar</p>
                <p className="text-[11px] text-gray-400 leading-tight">Aprobar envios y rechazar los demas</p>
              </div>
              <div className="flex flex-col items-center text-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50">
                  <svg className="h-4 w-4 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 14.652" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-gray-700">Actualizar PD</p>
                <p className="text-[11px] text-gray-400 leading-tight">Deals aprobados listos para envio</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      {stage === 'previewing' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Vista previa</h2>
          <div className="mb-5 grid grid-cols-4 gap-4 text-center">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-2xl font-bold text-gray-900">{parsedRows.length}</p>
              <p className="mt-1 text-xs text-gray-500">Filas totales</p>
            </div>
            <div className="rounded-lg bg-green-50 p-4">
              <p className="text-2xl font-bold text-green-700">{toSend}</p>
              <p className="mt-1 text-xs text-gray-500">Para enviar</p>
            </div>
            <div className="rounded-lg bg-red-50 p-4">
              <p className="text-2xl font-bold text-red-700">{toReject}</p>
              <p className="mt-1 text-xs text-gray-500">Para rechazar</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-700 truncate">{fileName}</p>
              <p className="mt-1 text-xs text-gray-500">Archivo</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleProcess}
              className="rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
            >
              Procesar {parsedRows.length} fila{parsedRows.length !== 1 ? 's' : ''}
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
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600" />
          <p className="text-sm font-medium text-gray-700">Procesando filas…</p>
        </div>
      )}

      {/* Done */}
      {stage === 'done' && response && (
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Resultado</h2>
            <div className="grid grid-cols-5 gap-3 text-center">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xl font-bold text-gray-900">{response.total}</p>
                <p className="mt-1 text-xs text-gray-500">Total</p>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <p className="text-xl font-bold text-green-700">{response.approved}</p>
                <p className="mt-1 text-xs text-gray-500">Aprobados</p>
              </div>
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-xl font-bold text-red-700">{response.rejected}</p>
                <p className="mt-1 text-xs text-gray-500">Rechazados</p>
              </div>
              <div className="rounded-lg bg-gray-100 p-3">
                <p className="text-xl font-bold text-gray-500">{response.skipped}</p>
                <p className="mt-1 text-xs text-gray-500">Omitidos</p>
              </div>
              <div className="rounded-lg bg-orange-50 p-3">
                <p className="text-xl font-bold text-orange-700">{response.errors}</p>
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
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Deal ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      DNI
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Respuesta
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
                    <tr key={i} className={r.status === 'error' ? 'bg-orange-50' : ''}>
                      <td className="px-4 py-3 font-mono text-gray-700">{r.deal_id}</td>
                      <td className="px-4 py-3 text-gray-600">{r.dni || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{r.respuesta || '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r.detail}
                        {r.bank_deal_id && (
                          <a
                            href={`https://mdsl.pipedrive.com/deal/${r.bank_deal_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-blue-600 hover:underline"
                          >
                            Bank #{r.bank_deal_id}
                          </a>
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
