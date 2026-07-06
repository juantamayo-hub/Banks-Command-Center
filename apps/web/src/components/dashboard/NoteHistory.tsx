'use client'

import { useState } from 'react'

interface Note {
  content: string
  created_at: string
}

interface NoteHistoryProps {
  notes: Note[]
  sheetNote?: string | null
}

function formatNoteDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function NoteHistory({ notes, sheetNote }: NoteHistoryProps) {
  const [expanded, setExpanded] = useState(false)

  const hasNotes = notes.length > 0
  const hasSheet = !!sheetNote?.trim()

  if (!hasNotes && !hasSheet) {
    return <span className="text-xs text-gray-300">—</span>
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Platform notes */}
      {hasNotes && (
        <div className="flex flex-col gap-1">
          {/* Always show the most recent note */}
          <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
            {notes[0].content}
          </div>
          <div className="text-[10px] text-gray-400">{formatNoteDate(notes[0].created_at)}</div>

          {/* Expand/collapse older notes */}
          {notes.length > 1 && (
            <>
              {expanded && (
                <div className="flex flex-col gap-1.5 mt-1 border-l-2 border-gray-100 pl-2">
                  {notes.slice(1).map((n, i) => (
                    <div key={i}>
                      <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                        {n.content}
                      </div>
                      <div className="text-[10px] text-gray-400">{formatNoteDate(n.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setExpanded((p) => !p)}
                className="self-start text-[10px] text-indigo-500 hover:text-indigo-700 font-medium"
              >
                {expanded ? 'Ver menos' : `Ver ${notes.length - 1} más`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Sheet note (from Google Sheets NOTAS column) — shown only if no platform notes */}
      {!hasNotes && hasSheet && (
        <span className="text-xs text-gray-500 italic leading-relaxed whitespace-pre-wrap">
          {sheetNote}
        </span>
      )}
    </div>
  )
}
