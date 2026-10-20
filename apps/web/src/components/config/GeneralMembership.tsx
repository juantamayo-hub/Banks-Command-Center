'use client'

import { useState, useTransition } from 'react'
import { setUsesGeneralRules } from '@/app/actions/bankConfig'
import BankLogo from './BankLogo'

interface Bank { slug: string; name: string; usesGeneral: boolean }

/** Bancos que usan la regla general: añadir / sacar con un clic. */
export default function GeneralMembership({ banks, canEdit }: { banks: Bank[]; canEdit: boolean }) {
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggle(b: Bank) {
    setError(null)
    setBusy(b.slug)
    start(async () => {
      const r = await setUsesGeneralRules(b.slug, !b.usesGeneral)
      if (!r.ok) setError(`${b.name}: ${r.error}`)
      setBusy(null)
    })
  }

  const inGeneral = banks.filter((b) => b.usesGeneral)
  const own = banks.filter((b) => !b.usesGeneral)

  const Row = ({ b }: { b: Bank }) => (
    <li className="flex items-center gap-3 py-2">
      <BankLogo slug={b.slug} name={b.name} size={24} />
      <span className="flex-1 truncate text-sm text-gray-800">{b.name}</span>
      {canEdit && (
        <button
          type="button"
          disabled={pending}
          onClick={() => toggle(b)}
          className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          {busy === b.slug ? '…' : b.usesGeneral ? 'Sacar' : 'Añadir'}
        </button>
      )}
    </li>
  )

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Usan la regla general ({inGeneral.length})</p>
        <ul className="mt-1 divide-y divide-gray-100">
          {inGeneral.map((b) => <Row key={b.slug} b={b} />)}
          {!inGeneral.length && <li className="py-3 text-sm text-gray-400">Ninguno</li>}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Con reglas propias ({own.length})</p>
        <ul className="mt-1 divide-y divide-gray-100">
          {own.map((b) => <Row key={b.slug} b={b} />)}
        </ul>
        {canEdit && (
          <p className="mt-2 text-[11px] text-gray-400">
            Al sacar un banco de la regla general, se le crean reglas propias con estos mismos valores para que nada cambie
            hasta que las edites.
          </p>
        )}
      </div>
      {error && <p className="text-xs text-red-600 md:col-span-2">{error}</p>}
    </div>
  )
}
