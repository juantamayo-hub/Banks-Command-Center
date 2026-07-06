'use client'

import { useState } from 'react'

type Phase = 'idle' | 'loading' | 'sent' | 'error'

interface NoteBoxProps {
  dealId: number | null
  sheetRowId?: string
}

export default function NoteBox({ dealId, sheetRowId }: NoteBoxProps) {
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!dealId) return null

  async function handleSubmit() {
    const trimmed = note.trim()
    if (!trimmed || phase === 'loading') return

    setPhase('loading')
    setErrorMsg(null)

    try {
      const res = await fetch('/api/pipedrive/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id: dealId,
          ...(sheetRowId ? { sheet_row_id: sheetRowId } : {}),
          note: trimmed,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data?.error ?? 'Error desconocido')
        setPhase('error')
        return
      }

      setNote('')
      setPhase('sent')
      setTimeout(() => setPhase('idle'), 3000)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error de red')
      setPhase('error')
    }
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={phase === 'loading'}
        placeholder="Añadir nota..."
        className="w-full min-w-[180px] rounded border border-gray-200 px-2 py-1 text-xs text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:bg-gray-50 resize-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={phase === 'loading' || note.trim().length === 0}
          className="rounded px-2 py-0.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed transition-colors"
        >
          {phase === 'loading' ? 'Guardando…' : 'Guardar nota'}
        </button>
        {phase === 'sent' && (
          <span className="text-xs font-medium text-green-600">✓ Guardada en PD y plataforma</span>
        )}
        {phase === 'error' && errorMsg && (
          <span className="text-xs text-red-600">{errorMsg}</span>
        )}
      </div>
    </div>
  )
}
