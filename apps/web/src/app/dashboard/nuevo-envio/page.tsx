'use client'

import { useState, useRef } from 'react'
import PageHeader from '@/components/ui/PageHeader'

type Phase =
  | 'idle'
  | 'verifying'
  | 'match'
  | 'bank_not_found'
  | 'creating'
  | 'success'
  | 'error'

interface VerifyResult {
  bank_slug: string
  bank_name: string
  importe: number | null
  nombre_cliente: string
  deal_title: string
  general_deal_id: number
}

export default function NuevoEnvioPage() {
  const [bankDealId, setBankDealId] = useState('')
  const [phase, setPhase]           = useState<Phase>('idle')
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [bankNotFoundName, setBankNotFoundName] = useState('')
  const [errorMsg, setErrorMsg]     = useState('')
  const bankDealIdRef = useRef<HTMLInputElement>(null)

  async function handleVerify() {
    const bid = parseInt(bankDealId.trim(), 10)
    if (!Number.isInteger(bid) || bid <= 0) {
      setErrorMsg('Ingresa un Deal ID bancario válido.')
      setPhase('error')
      return
    }

    setPhase('verifying')
    setErrorMsg('')

    try {
      const res  = await fetch(`/api/nuevo-envio/verify?bank_deal_id=${bid}`)
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data?.error ?? `Error ${res.status}`)
        setPhase('error')
        return
      }

      if (data.ok === false && data.code === 'BANK_NOT_FOUND') {
        setBankNotFoundName(data.bank_name_detected ?? '(desconocido)')
        setVerifyResult({
          bank_slug: '',
          bank_name: '',
          importe: data.importe ?? null,
          nombre_cliente: data.nombre_cliente ?? '',
          deal_title: '',
          general_deal_id: data.general_deal_id ?? 0,
        })
        setPhase('bank_not_found')
        return
      }

      setVerifyResult({
        bank_slug:      data.bank_slug,
        bank_name:      data.bank_name,
        importe:        data.importe ?? null,
        nombre_cliente: data.nombre_cliente ?? '',
        deal_title:     data.deal_title ?? '',
        general_deal_id: data.general_deal_id,
      })
      setPhase('match')
    } catch {
      setErrorMsg('Error de red al verificar.')
      setPhase('error')
    }
  }

  async function handleCreate() {
    if (!verifyResult) return

    setPhase('creating')
    setErrorMsg('')

    try {
      const res = await fetch('/api/nuevo-envio/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id:        verifyResult.general_deal_id,
          nombre_cliente: verifyResult.nombre_cliente,
          importe:        verifyResult.importe ?? 0,
          bank_slug:      verifyResult.bank_slug,
          bank_deal_id:   parseInt(bankDealId.trim(), 10),
        }),
      })
      const data = await res.json()

      if (!res.ok || data?.ok === false) {
        setErrorMsg(data?.error ?? `Error ${res.status}`)
        setPhase('match')
        return
      }

      setPhase('success')
    } catch {
      setErrorMsg('Error de red al generar.')
      setPhase('match')
    }
  }

  function reset() {
    setBankDealId('')
    setPhase('idle')
    setVerifyResult(null)
    setBankNotFoundName('')
    setErrorMsg('')
    setTimeout(() => bankDealIdRef.current?.focus(), 50)
  }

  const isLoading = phase === 'verifying' || phase === 'creating'

  const stepActive = phase === 'idle' || phase === 'verifying' || phase === 'error' ? 1 : 2

  return (
    <div className="p-6 md:p-8 max-w-xl mx-auto">
      <div className="mb-8">
        <PageHeader
          title="Nuevo envío"
          subtitle="Genera una fila en la hoja del banco. Solo necesitas el ID del deal bancario (pipeline 7)."
          breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }]}
        />
      </div>

      {/* ── Step indicator ── */}
      <div className="flex items-center gap-3 mb-6">
        {/* Step 1 */}
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
            stepActive === 1
              ? 'bg-blue-600 text-white shadow-sm'
              : stepActive === 2
                ? 'bg-blue-100 text-blue-600'
                : 'bg-gray-100 text-gray-400'
          }`}>1</span>
          <span className={`text-sm font-medium transition-colors ${
            stepActive === 1 ? 'text-gray-900' : 'text-gray-400'
          }`}>Verificar</span>
        </div>
        {/* Connector */}
        <div className="flex-1 h-px bg-gray-200" />
        {/* Step 2 */}
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
            stepActive === 2
              ? 'bg-green-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-400'
          }`}>2</span>
          <span className={`text-sm font-medium transition-colors ${
            stepActive === 2 ? 'text-gray-900' : 'text-gray-400'
          }`}>Confirmar</span>
        </div>
      </div>

      {/* ── Step 1: Bank Deal ID ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Colored header strip */}
        <div className="h-1.5 bg-gradient-to-r from-blue-500 to-blue-600" />

        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Deal bancario</p>
              <p className="text-xs text-gray-500">Busca el deal en Pipedrive para verificar el banco</p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Deal ID del banco (Pipedrive, pipeline 7)
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5" />
                  </svg>
                </div>
                <input
                  ref={bankDealIdRef}
                  type="number"
                  value={bankDealId}
                  onChange={(e) => { setBankDealId(e.target.value); if (phase !== 'idle') setPhase('idle') }}
                  placeholder="ej. 415230"
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 pl-9 pr-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              onClick={handleVerify}
              disabled={isLoading || !bankDealId}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {phase === 'verifying' ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Buscando en Pipedrive...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Verificar deal
                </>
              )}
            </button>
          </div>

          {/* Generic error */}
          {phase === 'error' && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2.5">
              <svg className="h-4 w-4 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-700">{errorMsg}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Bank not found ── */}
      {phase === 'bank_not_found' && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 shrink-0">
              <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800">
                Banco no reconocido: &quot;{bankNotFoundName}&quot;
              </p>
              <p className="text-xs text-amber-600 mt-1 leading-relaxed">
                Este banco no esta en la lista de bancos activos de la plataforma. Verifica que el deal bancario es correcto o avisa al equipo tecnico para anadirlo.
              </p>
              {verifyResult?.nombre_cliente && (
                <p className="text-xs text-amber-700 mt-2">
                  Cliente detectado: <strong>{verifyResult.nombre_cliente}</strong>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Confirmation (only when match) ── */}
      {(phase === 'match' || phase === 'creating') && verifyResult && (
        <div className="mt-4 rounded-xl border border-green-200 bg-white shadow-sm overflow-hidden">
          {/* Colored header strip */}
          <div className="h-1.5 bg-gradient-to-r from-green-500 to-emerald-500" />

          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-50 text-green-600">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Confirmar y autorizar</p>
                <p className="text-xs text-gray-500">Revisa los datos antes de generar la fila</p>
              </div>
            </div>

            <div className="mb-5 rounded-lg bg-green-50/70 border border-green-100 divide-y divide-green-100">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-green-600 font-medium uppercase tracking-wide">Banco</span>
                <span className="text-sm font-semibold text-green-900">{verifyResult.bank_name}</span>
              </div>
              {verifyResult.importe !== null && (
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-green-600 font-medium uppercase tracking-wide">Importe</span>
                  <span className="text-sm font-medium text-green-800">
                    {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(verifyResult.importe)}
                  </span>
                </div>
              )}
              {verifyResult.nombre_cliente && (
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-green-600 font-medium uppercase tracking-wide">Cliente</span>
                  <span className="text-sm font-medium text-green-800">{verifyResult.nombre_cliente}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-green-600 font-medium uppercase tracking-wide">Deal general</span>
                <span className="text-sm font-medium text-green-800">#{verifyResult.general_deal_id}</span>
              </div>
            </div>

            {errorMsg && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2.5">
                <svg className="h-4 w-4 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-red-600">{errorMsg}</p>
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={phase === 'creating'}
              className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {phase === 'creating' ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generando...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Generar fila en Sheet
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Success ── */}
      {phase === 'success' && verifyResult && (
        <div className="mt-4 rounded-xl border border-green-200 bg-gradient-to-b from-green-50 to-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          </div>
          <p className="text-base font-semibold text-green-800">
            Fila generada en {verifyResult.bank_name}
          </p>
          <p className="text-sm text-green-600 mt-1">
            Deal bancario #{bankDealId}
            {verifyResult.importe !== null
              ? ` · ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(verifyResult.importe)}`
              : ''}
          </p>
          <button
            onClick={reset}
            className="mt-5 rounded-lg border border-green-200 bg-white px-5 py-2 text-sm font-medium text-green-700 hover:bg-green-50 transition-colors shadow-sm"
          >
            Nuevo envio
          </button>
        </div>
      )}

      {/* ── How it works hint ── */}
      {(phase === 'idle' || phase === 'error') && (
        <div className="mt-8 rounded-xl border border-gray-100 bg-gray-50/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Como funciona</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-700">Verificar</p>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">Busca el deal en Pipedrive</p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-700">Confirmar</p>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">Revisa banco y datos</p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-700">Generar</p>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">Crea la fila en Google Sheet</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
