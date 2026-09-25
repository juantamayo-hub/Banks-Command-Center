'use client'

import { useState, useTransition } from 'react'
import { assignBankResponseDeal, resolveBankResponse } from '@/app/actions/bankResponses'

interface Props {
  id: string
  unmatched: boolean
}

export default function ResponseReviewActions({ id, unmatched }: Props) {
  const [pending, startTransition] = useTransition()
  const [dealInput, setDealInput] = useState('')
  const [error, setError] = useState<string | null>(null)

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
              onClick={() => run(() => assignBankResponseDeal(id, Number(dealInput)))}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Vincular
            </button>
          </>
        )}
        <button
          disabled={pending}
          onClick={() => run(() => resolveBankResponse(id))}
          className="rounded-md bg-gray-800 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? '…' : 'Marcar gestionado'}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
