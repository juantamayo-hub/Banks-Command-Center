'use client'

import { useState } from 'react'
import { requestRelaunch } from '@/app/actions/relaunch'

// Statuses where the row was already dispatched — require force confirmation
const FORCE_REQUIRED = new Set(['sent', 'offer_received'])

// Statuses where relaunch is meaningless / blocked
const NOT_RELAUNCHABLE = new Set(['sending', 'relaunch_requested', 'unknown', 'pending_ready'])

type Phase = 'idle' | 'confirm' | 'force_confirm' | 'loading' | 'success' | 'error'

interface RelaunchButtonProps {
  rowId: string
  status: string | null
  clientName: string | null
  hasDispatch?: boolean | null
  bankSlug?: string | null
  sheetRowNumber?: number | null
}

export default function RelaunchButton({ rowId, status, clientName, hasDispatch, bankSlug, sheetRowNumber }: RelaunchButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const normalStatus = status ?? 'unknown'

  // Banks without platform dispatch use a separate manual process
  if (hasDispatch === false) {
    return <span className="text-xs text-gray-400 italic">Proceso manual</span>
  }

  if (NOT_RELAUNCHABLE.has(normalStatus)) {
    return (
      <span className="text-xs text-gray-300">
        {normalStatus === 'relaunch_requested' ? 'Pendiente' : '—'}
      </span>
    )
  }

  const needsForce = FORCE_REQUIRED.has(normalStatus)

  async function doRelaunch(force: boolean) {
    setPhase('loading')
    setErrorMsg(null)

    const result = await requestRelaunch(rowId, force, bankSlug ?? undefined, sheetRowNumber)

    if (!result.ok) {
      if (result.code === 'REQUIRES_FORCE') {
        setPhase('force_confirm')
        return
      }
      setErrorMsg(result.error)
      setPhase('error')
      return
    }

    setPhase('success')
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return <span className="text-xs font-medium text-purple-600">✓ Solicitado</span>
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-xs text-red-600">{errorMsg}</span>
        <button
          onClick={() => setPhase('idle')}
          className="text-xs text-gray-400 underline hover:text-gray-600"
        >
          Cerrar
        </button>
      </span>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return <span className="text-xs text-gray-400">Enviando…</span>
  }

  // ── Force confirmation (row was already sent) ─────────────────────────────
  if (phase === 'force_confirm') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-amber-700">
          ⚠ Ya enviado{clientName ? ` (${clientName.split(' ')[0]})` : ''}. ¿Forzar?
        </span>
        <button
          onClick={() => doRelaunch(true)}
          className="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-700"
        >
          Sí, forzar
        </button>
        <button
          onClick={() => setPhase('idle')}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Cancelar
        </button>
      </span>
    )
  }

  // ── Standard confirmation ─────────────────────────────────────────────────
  if (phase === 'confirm') {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-xs text-gray-600">¿Confirmar?</span>
        <button
          onClick={() => doRelaunch(needsForce)}
          className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Sí
        </button>
        <button
          onClick={() => setPhase('idle')}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          No
        </button>
      </span>
    )
  }

  // ── Idle ─────────────────────────────────────────────────────────────────
  return (
    <button
      onClick={() => setPhase(needsForce ? 'force_confirm' : 'confirm')}
      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
        needsForce
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      Relanzar
    </button>
  )
}
