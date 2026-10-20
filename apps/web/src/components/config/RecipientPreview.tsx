'use client'

import { useMemo, useState } from 'react'
import {
  resolveRecipients,
  type BankConfig,
  type BankContact,
  type BlockedEmail,
  type Province,
} from '@/lib/bankConfig'
import { INPUT } from './ui'

/** "¿A quién se enviaría?": misma función que usa la API de n8n, con los datos guardados. */
export default function RecipientPreview({
  config, contacts, provinces, blocked,
}: {
  config: BankConfig
  contacts: BankContact[]
  provinces: Province[]
  blocked: BlockedEmail[]
}) {
  const [province, setProvince] = useState('')
  const [dealEmail, setDealEmail] = useState('')
  const names = useMemo(
    () => Array.from(new Set(provinces.map((p) => p.name))).sort((a, b) => a.localeCompare(b, 'es')),
    [provinces],
  )
  const usesDealEmail = config.to_source !== 'contacts'
  const r = resolveRecipients(config, contacts, provinces, blocked, {
    province: province || null,
    dealEmail: dealEmail || null,
    ownerEmail: 'owner@bayteca.com',
  })

  return (
    <div className="rounded-lg bg-gray-50 p-4">
      <p className="mb-2 text-xs font-semibold text-gray-700">Probar: ¿a quién se enviaría?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={province} onChange={(e) => setProvince(e.target.value)} className={INPUT}>
          <option value="">Provincia del deal…</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {usesDealEmail && (
          <input
            value={dealEmail}
            onChange={(e) => setDealEmail(e.target.value)}
            placeholder='"Email bancario" del deal (opcional)'
            className={INPUT}
          />
        )}
      </div>
      <dl className="mt-3 grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-gray-500">Para</dt>
        <dd className="break-all text-gray-900">{r.toEmail ?? <span className="text-red-600">— {r.reason}</span>}</dd>
        <dt className="text-gray-500">CC</dt>
        <dd className="break-all text-gray-700">
          {r.ccEmail.replace('owner@bayteca.com', 'owner del deal') || '—'}
        </dd>
      </dl>
      {r.route === 'bloqueado' && <p className="mt-2 text-xs text-red-600">{r.reason}</p>}
    </div>
  )
}
