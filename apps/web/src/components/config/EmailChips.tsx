'use client'

import { useState } from 'react'
import { isValidEmail } from '@/lib/bankConfig'

interface Props {
  value: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
  placeholder?: string
}

/** Lista de correos como "chips": Enter, coma o pegar varios separados por coma. */
export default function EmailChips({ value, onChange, disabled, placeholder }: Props) {
  const [draft, setDraft] = useState('')

  function add(raw: string) {
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    if (!parts.length) return
    onChange(Array.from(new Set([...value, ...parts])))
    setDraft('')
  }

  return (
    <div
      className={`flex min-h-[34px] flex-wrap items-center gap-1 rounded-md border border-gray-200 px-1.5 py-1 ${disabled ? 'bg-gray-50' : 'bg-white'}`}
    >
      {value.map((e) => (
        <span
          key={e}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
            isValidEmail(e) ? 'bg-gray-100 text-gray-700' : 'bg-red-50 text-red-700 ring-1 ring-red-200'
          }`}
          title={isValidEmail(e) ? e : 'Correo no válido'}
        >
          <span className="break-all">{e}</span>
          {!disabled && (
            <button
              type="button"
              aria-label={`Quitar ${e}`}
              onClick={() => onChange(value.filter((x) => x !== e))}
              className="text-gray-400 hover:text-gray-700"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ',') {
              ev.preventDefault()
              add(draft)
            } else if (ev.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => add(draft)}
          onPaste={(ev) => {
            const text = ev.clipboardData.getData('text')
            if (/[,;\s]/.test(text)) {
              ev.preventDefault()
              add(text)
            }
          }}
          placeholder={value.length ? '' : (placeholder ?? 'correo@banco.es')}
          className="min-w-[140px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
      )}
    </div>
  )
}
