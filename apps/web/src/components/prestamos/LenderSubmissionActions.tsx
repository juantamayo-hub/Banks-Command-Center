'use client'

import { useState, useTransition } from 'react'
import { dismissLenderSubmission, markLenderSubmissionSent } from '@/app/actions/lenderSubmissions'

interface Props {
  id: string
  lenderName: string
}

export default function LenderSubmissionActions({ id, lenderName }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'idle' | 'confirm_sent' | 'dismiss'>('idle')
  const [reason, setReason] = useState('')

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await action()
      if (!res.ok) setError(res.error ?? 'Error')
      else setMode('idle')
    })
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      {mode === 'idle' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled
            title="Se activará cuando el flujo de envío de n8n esté conectado"
            className="rounded-md bg-bayteca-green px-2.5 py-1 text-xs font-medium text-white opacity-40"
          >
            Reintentar envío
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode('confirm_sent')}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Marcar enviado
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode('dismiss')}
            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50"
          >
            Descartar
          </button>
        </div>
      )}

      {mode === 'confirm_sent' && (
        <div className="max-w-xs rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-black/10 sm:text-right">
          <p className="text-gray-700">¿Confirmas que ya se envió a {lenderName} por otra vía? No se envía nada desde aquí.</p>
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => markLenderSubmissionSent(id))}
              className="rounded-md bg-gray-800 px-2.5 py-1 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {pending ? '…' : 'Sí, marcar enviado'}
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

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
