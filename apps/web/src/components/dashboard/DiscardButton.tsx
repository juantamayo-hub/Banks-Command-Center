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
      className="text-gray-300 hover:text-red-400 transition-colors text-xs leading-none"
    >
      🗑
    </button>
  )
}
