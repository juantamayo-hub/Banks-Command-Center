'use client'

import { useState, useTransition } from 'react'
import { addBlockedEmail, addEditor, deleteBlockedEmail, removeEditor } from '@/app/actions/bankConfig'
import type { BlockedEmail } from '@/lib/bankConfig'
import { BTN_GHOST, BTN_PRIMARY, INPUT } from './ui'

export function BlockedEmailsEditor({
  blocked, banks, canEdit,
}: {
  blocked: BlockedEmail[]
  banks: { slug: string; name: string }[]
  canEdit: boolean
}) {
  const [email, setEmail] = useState('')
  const [bank, setBank] = useState('')
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const bankName = new Map(banks.map((b) => [b.slug, b.name]))

  return (
    <div>
      <ul className="divide-y divide-gray-100">
        {blocked.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <p className="text-sm text-gray-800 break-all">{b.email}</p>
              <p className="text-[11px] text-gray-400">
                {b.bank_slug ? bankName.get(b.bank_slug) ?? b.bank_slug : 'Todos los bancos'}
                {b.reason ? ` · ${b.reason}` : ''}
              </p>
            </div>
            {canEdit && (
              <button
                type="button"
                disabled={pending}
                className={BTN_GHOST}
                onClick={() => start(async () => {
                  const r = await deleteBlockedEmail(b.id)
                  if (!r.ok) setError(r.error)
                })}
              >
                Quitar
              </button>
            )}
          </li>
        ))}
        {!blocked.length && <li className="py-4 text-sm text-gray-400">Ningún correo bloqueado</li>}
      </ul>
      {canEdit && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_1fr_auto]">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@dominio.com" className={INPUT} />
          <select value={bank} onChange={(e) => setBank(e.target.value)} className={INPUT}>
            <option value="">Todos los bancos</option>
            {banks.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" className={INPUT} />
          <button
            type="button"
            disabled={pending || !email.trim()}
            className={BTN_PRIMARY}
            onClick={() => {
              setError(null)
              start(async () => {
                const r = await addBlockedEmail(email, bank || null, reason)
                if (!r.ok) setError(r.error)
                else { setEmail(''); setReason('') }
              })
            }}
          >
            Bloquear
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function EditorsEditor({ editors, me, canEdit }: { editors: string[]; me: string | null; canEdit: boolean }) {
  const [email, setEmail] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <ul className="divide-y divide-gray-100">
        {editors.map((e) => (
          <li key={e} className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-800 break-all">{e}{e === me && <span className="ml-1 text-[11px] text-gray-400">(tú)</span>}</span>
            {canEdit && e !== me && (
              <button
                type="button"
                disabled={pending}
                className={BTN_GHOST}
                onClick={() => start(async () => {
                  const r = await removeEditor(e)
                  if (!r.ok) setError(r.error)
                })}
              >
                Quitar
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@huspy.io" className={INPUT} />
          <button
            type="button"
            disabled={pending || !email.trim()}
            className={BTN_PRIMARY}
            onClick={() => {
              setError(null)
              start(async () => {
                const r = await addEditor(email)
                if (!r.ok) setError(r.error)
                else setEmail('')
              })
            }}
          >
            Añadir
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
