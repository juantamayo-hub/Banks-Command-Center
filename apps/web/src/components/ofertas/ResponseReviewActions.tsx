'use client'

import { useState, useTransition } from 'react'
import { assignBankResponseDeal, resolveBankResponse } from '@/app/actions/bankResponses'

/** Otra respuesta pendiente del mismo banco e hilo de Gmail. */
export interface ThreadSibling {
  id: string
  received_at: string
  client_name: string | null
  subject: string | null
}

interface Props {
  id: string
  unmatched: boolean
  threadSiblings?: ThreadSibling[]
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  })
}

export default function ResponseReviewActions({ id, unmatched, threadSiblings = [] }: Props) {
  const [pending, startTransition] = useTransition()
  const [dealInput, setDealInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [withThread, setWithThread] = useState(false)
  const n = threadSiblings.length

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await action()
      if (!res.ok) setError(res.error ?? 'Error')
    })
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex items-center gap-1.5">
        {unmatched && (
          <>
            <input
              value={dealInput}
              onChange={(e) => setDealInput(e.target.value.replace(/\D/g, ''))}
              placeholder="Deal banco"
              inputMode="numeric"
              className="w-24 rounded-md border border-gray-200 px-2 py-1 text-xs"
            />
            <button
              disabled={pending || !dealInput}
              onClick={() => run(() => assignBankResponseDeal(id, Number(dealInput), withThread))}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Vincular{withThread ? ` (${n + 1})` : ''}
            </button>
          </>
        )}
        <button
          disabled={pending}
          onClick={() => run(() => resolveBankResponse(id, withThread))}
          className="rounded-md bg-gray-800 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? '…' : `Marcar gestionado${withThread ? ` (${n + 1})` : ''}`}
        </button>
      </div>
      {n > 0 && (
        <div className="max-w-xs text-xs text-gray-600 sm:text-right">
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={withThread}
              onChange={(e) => setWithThread(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            Aplicar también a {n === 1 ? 'otro pendiente' : `${n} pendientes más`} del mismo hilo
          </label>
          {/* Gmail agrupa por asunto: comprobar que son del mismo cliente antes de marcar */}
          <ul className="mt-1 flex flex-col gap-0.5 text-gray-500">
            {threadSiblings.map((s) => (
              <li key={s.id} className="truncate">
                {fmtDate(s.received_at)}{s.client_name ? ` · ${s.client_name}` : ''}{s.subject ? ` · ${s.subject}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
