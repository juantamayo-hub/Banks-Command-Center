'use client'

import { useState, useTransition } from 'react'
import { dismissLenderSubmission, relaunchLenderSubmission } from '@/app/actions/lenderSubmissions'

interface Props {
  id: string
  /** 'sent' → Relanzar (reenvío con force); pendiente/error → Reintentar envío + Forzar envío + Descartar */
  status: 'pending_docs' | 'error' | 'sent'
  lenderName: string
  /** Motivos por los que no salió (documentos que faltan / bancos incompatibles), para la confirmación del forzado */
  reasons?: string[]
}

export default function LenderSubmissionActions({ id, status, lenderName, reasons = [] }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [mode, setMode] = useState<'idle' | 'dismiss' | 'confirm_relaunch' | 'confirm_force'>('idle')
  const [reason, setReason] = useState('')

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      const res = await action()
      if (!res.ok) setError(res.error ?? 'Error')
      else {
        setMode('idle')
        if (okMsg) setInfo(okMsg)
      }
    })
  }

  const sent = status === 'sent'

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      {mode === 'idle' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {sent ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode('confirm_relaunch')}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Relanzar
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => relaunchLenderSubmission(id), 'Envío lanzado: en 1–2 min se actualiza el estado')}
                title="Vuelve a revisar la documentación y, si está completa, envía"
                className="rounded-md bg-bayteca-green px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? '…' : 'Reintentar envío'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setMode('confirm_force')}
                title="Envía aunque falte documentación o haya un banco incompatible en Pipedrive"
                className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              >
                Forzar envío
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setMode('dismiss')}
                className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50"
              >
                Descartar
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'confirm_relaunch' && (
        <div className="max-w-xs rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-black/10 sm:text-right">
          <p className="text-gray-700">
            Este caso <b>ya se envió</b> a {lenderName}. ¿Volver a enviarlo? Se genera un ZIP nuevo con la documentación actual y queda registrado.
          </p>
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => relaunchLenderSubmission(id), 'Relanzado: en 1–2 min aparece en el historial')}
              className="rounded-md bg-gray-800 px-2.5 py-1 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {pending ? '…' : 'Sí, relanzar'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {mode === 'confirm_force' && (
        <div className="max-w-xs rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-amber-300 sm:text-right">
          <p className="text-gray-700">
            ¿Enviar a {lenderName} <b>aunque no cumpla las validaciones</b>? Sale con la documentación que haya en la carpeta y queda registrado a tu nombre.
          </p>
          {reasons.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-left text-amber-800">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => relaunchLenderSubmission(id, { override: true }), 'Envío forzado lanzado: en 1–2 min se actualiza el estado')}
              className="rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {pending ? '…' : 'Sí, forzar envío'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {mode === 'dismiss' && (
        <div className="w-64 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-black/10">
          <p className="font-medium text-gray-700">Motivo del descarte</p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            placeholder="Ej.: el cliente desiste, va por otro banco…"
            className="mt-1.5 w-full rounded-md border border-gray-200 px-2 py-1 text-xs"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => run(() => dismissLenderSubmission(id, reason))}
              className="rounded-md bg-gray-800 px-2.5 py-1 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {pending ? '…' : 'Descartar'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {info && <span className="text-xs text-emerald-700">{info}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
