'use client'

/**
 * NotesCell — Client Component
 *
 * Combines NoteHistory + NoteBox in a single component that manages local state.
 * When a note is saved, it's added immediately to the local list without needing
 * a server refresh (router.refresh() is unreliable for updating Server Component
 * props mid-render in this context).
 */

import { useState } from 'react'
import NoteHistory from '@/components/dashboard/NoteHistory'
import NoteBox from '@/components/dashboard/NoteBox'

interface Note {
  content: string
  created_at: string
}

interface NotesCellProps {
  initialNotes: Note[]
  sheetNote?: string | null
  dealId: number | null
  sheetRowId: string
}

export default function NotesCell({
  initialNotes,
  sheetNote,
  dealId,
  sheetRowId,
}: NotesCellProps) {
  const [localNotes, setLocalNotes] = useState<Note[]>([])

  function handleNoteSaved(content: string) {
    setLocalNotes((prev) => [
      { content, created_at: new Date().toISOString() },
      ...prev,
    ])
  }

  const allNotes = [...localNotes, ...initialNotes]

  return (
    <div className="flex flex-col gap-1">
      <NoteHistory notes={allNotes} sheetNote={sheetNote} />
      <NoteBox dealId={dealId} sheetRowId={sheetRowId} onSaved={handleNoteSaved} />
    </div>
  )
}
