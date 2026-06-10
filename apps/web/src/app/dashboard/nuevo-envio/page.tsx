'use client'

import { useState, useRef } from 'react'
import { ACTIVE_BANKS } from '@/lib/banks'

type Phase =
  | 'idle'
  | 'verifying'
  | 'no_match'
  | 'match'
  | 'creating'
  | 'success'
  | 'error'

interface VerifyResult {
  nombre_cliente: string
  deal_title: string
}

export default function NuevoEnvioPage() {
  const [dealId, setDealId]         = useState('')
  const [importe, setImporte]       = useState('')
  const [bankSlug, setBankSlug]     = useState('')
  const [bankDealId, setBankDealId] = useState('')
  const [phase, setPhase]           = useState<Phase>('idle')
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [importesFound, setImportesFound] = useState<(number | null)[]>([])
  const [errorMsg, setErrorMsg]     = useState('')
  const dealIdRef = useRef<HTMLInputElement>(null)

  async function handleVerify() {
    const did = parseInt(dealId.trim(), 10)
    const imp = parseFloat(importe.trim().replace(',', '.'))

    if (!Number.isInteger(did) || did <= 0) {
      setErrorMsg('Ingresa un Deal ID válido.')
      setPhase('error')
      return
    }
    if (!isFinite(imp) || imp <= 0) {
      setErrorMsg('Ingresa un importe válido.')
      setPhase('error')
      return
    }

    setPhase('verifying')
    setErrorMsg('')

    try {
      const res  = await fetch(`/api/nuevo-envio/verify?deal_id=${did}&importe=${imp}`)
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data?.error ?? `Error ${res.status}`)
        setPhase('error')
        return
      }

      if (data.match) {
        setVerifyResult({ nombre_cliente: data.nombre_cliente, deal_title: data.deal_title })
        setBankSlug('')
        setBankDealId('')
        setPhase('match')
      } else {
        setImportesFound(data.importes_found ?? [])
        setPhase('no_match')
      }
    } catch {
      setErrorMsg('Error de red al verificar.')
      setPhase('error')
    }
  }

  async function handleCreate() {
    if (!bankSlug) {
      setErrorMsg('Selecciona un banco.')
      return
    }
    if (!bankDealId.trim()) {
      setErrorMsg('Ingresa el Deal ID del banco.')
      return
    }

    setPhase('creating')
    setErrorMsg('')

    try {
      const res = await fetch('/api/nuevo-envio/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id:        parseInt(dealId.trim(), 10),
          nombre_cliente: verifyResult?.nombre_cliente ?? '',
          importe:        parseFloat(importe.trim().replace(',', '.')),
          bank_slug:      bankSlug,
          bank_deal_id:   bankDealId.trim(),
        }),
      })
      const data = await res.json()

      if (!res.ok || data?.ok === false) {
        setErrorMsg(data?.error ?? `Error ${res.status}`)
        setPhase('match')  // revert to form so user can retry
        return
      }

      setPhase('success')
    } catch {
      setErrorMsg('Error de red al generar.')
      setPhase('match')
    }
  }

  function reset() {
    setDealId('')
    setImporte('')
    setBankSlug('')
    setBankDealId('')
    setPhase('idle')
    setVerifyResult(null)
    setImportesFound([])
    setErrorMsg('')
    setTimeout(() => dealIdRef.current?.focus(), 50)
  }

  const bankName = ACTIVE_BANKS.find((b) => b.slug === bankSlug)?.name ?? ''

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--bayteca-green)' }}>
        Nuevo envío
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Genera una fila en la hoja del banco para casos que no están registrados en el Sheet.
      </p>

      {/* ── Step 1: Deal ID + Importe ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
          Paso 1 — Verificar deal
        </p>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Deal ID (general Pipedrive)
            </label>
            <input
              ref={dealIdRef}
              type="number"
              value={dealId}
              onChange={(e) => { setDealId(e.target.value); if (phase !== 'idle') setPhase('idle') }}
              placeholder="ej. 311181"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              disabled={phase === 'verifying' || phase === 'creating'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Importe del dossier
            </label>
            <input
              type="text"
              value={importe}
              onChange={(e) => { setImporte(e.target.value); if (phase !== 'idle') setPhase('idle') }}
              placeholder="ej. 150000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              disabled={phase === 'verifying' || phase === 'creating'}
            />
          </div>

          <button
            onClick={handleVerify}
            disabled={phase === 'verifying' || phase === 'creating' || !dealId || !importe}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {phase === 'verifying' ? 'Verificando…' : 'Verificar'}
          </button>
        </div>

        {/* No match state */}
        {phase === 'no_match' && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">
              El importe no coincide con ninguno de los dossieres ya creados.
            </p>
            {importesFound.some((v) => v !== null) && (
              <p className="mt-1 text-xs text-red-500">
                Importes en Pipedrive:{' '}
                {importesFound
                  .map((v, i) => (v !== null ? `Banco ${i + 1}: ${v.toLocaleString('es-ES')} €` : null))
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* Generic error */}
        {phase === 'error' && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* ── Step 2: Bank form (only when match) ── */}
      {(phase === 'match' || phase === 'creating') && verifyResult && (
        <div className="mt-4 rounded-xl border border-green-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
            Paso 2 — Configurar envío
          </p>

          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <p className="text-sm font-medium text-green-800">
              ✓ Importe verificado
            </p>
            <p className="text-xs text-green-700 mt-0.5">
              {verifyResult.deal_title || `Deal #${dealId}`}
              {verifyResult.nombre_cliente ? ` · ${verifyResult.nombre_cliente}` : ''}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Banco
              </label>
              <select
                value={bankSlug}
                onChange={(e) => setBankSlug(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                disabled={phase === 'creating'}
              >
                <option value="">Selecciona un banco…</option>
                {ACTIVE_BANKS.map((b) => (
                  <option key={b.slug} value={b.slug}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Deal ID del banco
              </label>
              <input
                type="text"
                value={bankDealId}
                onChange={(e) => { setBankDealId(e.target.value); setErrorMsg('') }}
                placeholder="ej. EVO-2024-00123"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                disabled={phase === 'creating'}
              />
            </div>

            {errorMsg && (
              <p className="text-sm text-red-600">{errorMsg}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={phase === 'creating' || !bankSlug || !bankDealId.trim()}
              className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {phase === 'creating' ? 'Generando…' : 'Generar fila en Sheet'}
            </button>
          </div>
        </div>
      )}

      {/* ── Success ── */}
      {phase === 'success' && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 p-6 text-center shadow-sm">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm font-semibold text-green-800">
            Fila generada en {bankName}
          </p>
          <p className="text-xs text-green-600 mt-1">
            Deal #{dealId} · {importe} € · Bank Deal ID: {bankDealId}
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
