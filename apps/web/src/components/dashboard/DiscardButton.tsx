'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { discardRow } from '@/app/actions/discard'

type Phase = 'idle' | 'confirm' | 'loading'

export default function DiscardButton({ rowId }: { rowId: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const router = useRouter()

  async function doDiscard() {
    setPhase('loading')
    await discardRow(rowId)
    router.refresh()
  }

  if (phase === 'confirm') {
    return (
      <span className="flex items-center gap-1.5">
        <button
          onClick={doDiscard}
          className="text-xs font-medium text-red-600 hover:text-red-800 transition-colors"
        >
          Descartar
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

  if (phase === 'loading') {
    return <span className="text-xs text-gray-300">…</span>
  }

  return (
    <button
      onClick={() => setPhase('confirm')}
      title="Descartar de pendientes"
      className="text-gray-300 hover:text-red-400 transition-colors text-xs leading-none focus:outline-none focus:ring-1 focus:ring-red-300 rounded"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
    </button>
  )
}
