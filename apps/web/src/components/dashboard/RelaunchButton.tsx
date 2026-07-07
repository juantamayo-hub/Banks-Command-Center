'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { requestRelaunch } from '@/app/actions/relaunch'

// Already dispatched — Sí allowed but only with force=true
const FORCE_REQUIRED = new Set(['sent', 'offer_received'])

// Statuses where no action makes sense
const NOT_RELAUNCHABLE = new Set(['sending', 'relaunch_requested'])

// How long (ms) to keep the "Procesando" lock after a platform dispatch
const DISPATCH_LOCK_TTL_MS = 10 * 60 * 1000 // 10 minutes

function getDispatchLockKey(rowId: string) {
  return `dispatched_${rowId}`
}

function isDispatchLocked(rowId: string): boolean {
  try {
    const raw = sessionStorage.getItem(getDispatchLockKey(rowId))
    if (!raw) return false
    const sentAt = parseInt(raw, 10)
    return Date.now() - sentAt < DISPATCH_LOCK_TTL_MS
  } catch {
    return false
  }
}

function setDispatchLock(rowId: string) {
  try {
    sessionStorage.setItem(getDispatchLockKey(rowId), String(Date.now()))
  } catch { /* ignore */ }
}

function clearDispatchLock(rowId: string) {
  try {
    sessionStorage.removeItem(getDispatchLockKey(rowId))
  } catch { /* ignore */ }
}

type Phase = 'idle' | 'confirm' | 'loading' | 'success' | 'error'
type DispatchAction = 'ENVIAR' | 'AUTORIZACION'

interface RelaunchButtonProps {
  rowId: string
  status: string | null
  clientName: string | null
  hasDispatch?: boolean | null
  bankSlug?: string | null
  sheetRowNumber?: number | null
}

export default function RelaunchButton({
  rowId,
  status,
  clientName,
  hasDispatch,
  bankSlug,
  sheetRowNumber,
}: RelaunchButtonProps) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [pendingAction, setPendingAction] = useState<DispatchAction>('ENVIAR')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  // Read lock from sessionStorage on mount (survives router.refresh())
  const [locked, setLocked] = useState<boolean>(false)

  // ── HOOKS MUST ALL BE CALLED BEFORE ANY EARLY RETURN ─────────────────────
  useEffect(() => {
    setLocked(isDispatchLocked(rowId))
  }, [rowId])

  // Countdown after success — user clicks "Actualizar" to refresh manually
  useEffect(() => {
    if (countdown === null || countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : null)), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const normalStatus = status ?? 'unknown'

  // Banks that use a separate manual process — no button shown
  if (hasDispatch === false) {
    return <span className="text-xs text-gray-400 italic">Proceso manual</span>
  }

  // ── Dispatch lock: recently sent from platform, waiting for sync ──────────
  if (locked && phase === 'idle') {
    return (
      <span className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-purple-600 font-medium">Enviando…</span>
        <button
          onClick={() => {
            clearDispatchLock(rowId)
            setLocked(false)
            router.refresh()
          }}
          className="text-xs text-gray-400 hover:text-gray-700 underline"
          title="Comprobar estado actual en Supabase"
        >
          Refrescar
        </button>
      </span>
    )
  }

  // Statuses that cannot be relaunched from the platform
  if (NOT_RELAUNCHABLE.has(normalStatus)) {
    return (
      <span className="text-xs text-gray-300">
        {normalStatus === 'relaunch_requested' ? 'Pendiente' : '—'}
      </span>
    )
  }

  const needsForce = FORCE_REQUIRED.has(normalStatus)

  function handleAction(action: DispatchAction) {
    setPendingAction(action)
    setPhase('confirm')
  }

  async function doRelaunch() {
    setPhase('loading')
    setErrorMsg(null)

    let result: Awaited<ReturnType<typeof requestRelaunch>>
    try {
      result = await requestRelaunch(
        rowId,
        needsForce,
        bankSlug ?? undefined,
        sheetRowNumber,
        pendingAction
      )
    } catch {
      setErrorMsg('Error de conexión. Inténtalo de nuevo.')
      setPhase('error')
      return
    }

    if (!result.ok) {
      if (result.code === 'REQUIRES_FORCE') {
        setPhase('confirm')
        return
      }
      setErrorMsg(result.error)
      setPhase('error')
      return
    }

    // Lock this row immediately so it can't be re-dispatched even if the sync
    // temporarily resets the status to the old Sheet value before n8n updates it.
    setDispatchLock(rowId)
    setLocked(true)
    setPhase('success')
    setCountdown(60)
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <span className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-purple-600">✓ Solicitado</span>
        <button
          onClick={() => {
            clearDispatchLock(rowId)
            setLocked(false)
            setCountdown(null)
            setPhase('idle')
            router.refresh()
          }}
          className="text-xs text-gray-400 hover:text-gray-700 underline tabular-nums"
          title="Comprobar estado actual en Supabase"
        >
          {countdown !== null && countdown > 0
            ? `Refrescar en ${countdown}s`
            : 'Refrescar'}
        </button>
      </span>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return <span className="text-xs text-gray-400">Enviando…</span>
  }

  // ── Confirm ────────────────────────────────────────────────────────────────
  if (phase === 'confirm') {
    const isAutorizacion = pendingAction === 'AUTORIZACION'
    const label = isAutorizacion ? 'Autorizar' : 'Verificar'
    const firstName = clientName ? clientName.split(' ')[0] : null

    let warning: string | null = null
    if (needsForce) {
      warning = `⚠ Ya enviado${firstName ? ` (${firstName})` : ''}. ¿${label} de todos modos?`
    } else if (isAutorizacion) {
      warning = `⚠ Enviará pese a bloqueos. ¿Confirmar?`
    }

    const btnColor = isAutorizacion || needsForce
      ? 'bg-amber-600 hover:bg-amber-700'
      : 'bg-indigo-600 hover:bg-indigo-700'

    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-600">{warning ?? `¿${label}?`}</span>
        <button
          onClick={doRelaunch}
          className={`rounded px-2 py-0.5 text-xs font-medium text-white transition-colors ${btnColor}`}
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

  // ── Idle — action buttons ─────────────────────────────────────────────────
  if (normalStatus === 'pending_ready') {
    return (
      <button
        onClick={() => handleAction('ENVIAR')}
        title="Autorizar envío del dossier al banco (primer envío)"
        className="rounded px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
      >
        Autorizar envío
      </button>
    )
  }

  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => handleAction('ENVIAR')}
        title="Reintenta el envío normal (Enviar=Yes)"
        className="rounded px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
      >
        {needsForce ? '↺ Verificar' : 'Verificar'}
      </button>
      <button
        onClick={() => handleAction('AUTORIZACION')}
        title="Autoriza el envío a pesar de red flags o docs faltantes (Autorización=Yes)"
        className="rounded px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
      >
        {needsForce ? '↺ Autorizar' : 'Autorizar'}
      </button>
    </span>
  )
}
