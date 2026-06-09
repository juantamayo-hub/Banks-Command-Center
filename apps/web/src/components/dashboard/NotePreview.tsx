'use client'

import { useState } from 'react'

const PREVIEW_LIMIT = 100

interface NotePreviewProps {
  text: string
}

export default function NotePreview({ text }: NotePreviewProps) {
  const [expanded, setExpanded] = useState(false)

  const trimmed = text.trim()
  const isLong = trimmed.length > PREVIEW_LIMIT

  if (!isLong) {
    return (
      <span className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
        {trimmed}
      </span>
    )
  }

  return (
    <span className="text-xs text-gray-600 leading-relaxed">
      {expanded ? (
        <>
          <span className="whitespace-pre-wrap">{trimmed}</span>
          <button
            onClick={() => setExpanded(false)}
            className="ml-1.5 text-indigo-500 hover:text-indigo-700 font-medium whitespace-nowrap"
          >
            Ver menos
          </button>
        </>
      ) : (
        <>
          <span title={trimmed} className="whitespace-pre-wrap">
            {trimmed.slice(0, PREVIEW_LIMIT)}
            <span className="text-gray-400">…</span>
          </span>
          <button
            onClick={() => setExpanded(true)}
            className="ml-1.5 text-indigo-500 hover:text-indigo-700 font-medium whitespace-nowrap"
          >
            Ver más
          </button>
        </>
      )}
    </span>
  )
}
