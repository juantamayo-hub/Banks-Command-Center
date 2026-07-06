'use client'

import { useState, useRef } from 'react'

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

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--bayteca-green)' }}>
        Nuevo envío
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Genera una fila en la hoja del banco. Solo necesitas el ID del deal bancario (pipeline 7).
      </p>

      {/* ── Step 1: Bank Deal ID ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
          Paso 1 — Deal bancario
        </p>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Deal ID del banco (Pipedrive, pipeline 7)
            </label>
            <input
              ref={bankDealIdRef}
              type="number"
              value={bankDealId}
              onChange={(e) => { setBankDealId(e.target.value); if (phase !== 'idle') setPhase('idle') }}
              placeholder="ej. 415230"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              disabled={isLoading}
            />
          </div>

          <button
            onClick={handleVerify}
            disabled={isLoading || !bankDealId}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {phase === 'verifying' ? 'Buscando en Pipedrive…' : 'Verificar'}
          </button>
        </div>

        {/* Generic error */}
        {phase === 'error' && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* ── Bank not found ── */}
      {phase === 'bank_not_found' && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <p className="text-sm font-medium text-amber-800">
            Banco no reconocido: &quot;{bankNotFoundName}&quot;
          </p>
          <p className="text-xs text-amber-600 mt-1">
            Este banco no está en la lista de bancos activos de la plataforma. Verifica que el deal bancario es correcto o avisa al equipo técnico para añadirlo.
          </p>
          {verifyResult?.nombre_cliente && (
            <p className="text-xs text-amber-700 mt-2">
              Cliente detectado: <strong>{verifyResult.nombre_cliente}</strong>
            </p>
          )}
        </div>
      )}

      {/* ── Step 2: Confirmation (only when match) ── */}
      {(phase === 'match' || phase === 'creating') && verifyResult && (
        <div className="mt-4 rounded-xl border border-green-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
            Paso 2 — Confirmar y autorizar
          </p>

          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-600 font-medium uppercase">Banco</span>
              <span className="text-sm font-semibold text-green-900">{verifyResult.bank_name}</span>
            </div>
            {verifyResult.importe !== null && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-medium uppercase">Importe</span>
                <span className="text-sm text-green-800">
                  {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(verifyResult.importe)}
                </span>
              </div>
            )}
            {verifyResult.nombre_cliente && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-medium uppercase">Cliente</span>
                <span className="text-sm text-green-800">{verifyResult.nombre_cliente}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-600 font-medium uppercase">Deal general</span>
              <span className="text-sm text-green-800">#{verifyResult.general_deal_id}</span>
            </div>
          </div>

          {errorMsg && (
            <p className="text-sm text-red-600 mb-3">{errorMsg}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={phase === 'creating'}
            className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {phase === 'creating' ? 'Autorizando…' : 'Autorizar envío'}
          </button>
        </div>
      )}

      {/* ── Success ── */}
      {phase === 'success' && verifyResult && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 p-6 text-center shadow-sm">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm font-semibold text-green-800">
            Fila generada en {verifyResult.bank_name}
          </p>
          <p className="text-xs text-green-600 mt-1">
            Deal bancario #{bankDealId}
            {verifyResult.importe !== null
              ? ` · ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(verifyResult.importe)}`
              : ''}
          </p>
          <button
            onClick={reset}
            className="mt-4 rounded-lg border border-green-300 bg-white px-4 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
          >
            Nuevo envío
          </button>
        </div>
      )}
    </div>
  )
}
