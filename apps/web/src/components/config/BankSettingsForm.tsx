'use client'

import { useState, useTransition } from 'react'
import { updateBankSettings } from '@/app/actions/bankConfig'
import { TO_SOURCE_LABEL, type BankConfig, type ToSource } from '@/lib/bankConfig'
import { BTN_PRIMARY, INPUT } from './ui'

/** Pestaña Ajustes: origen del destinatario, nombres en el deal, copia al owner, asunto. */
export default function BankSettingsForm({ config, canEdit }: { config: BankConfig; canEdit: boolean }) {
  const [toSource, setToSource] = useState<ToSource>(config.to_source)
  const [ccOwner, setCcOwner] = useState(config.cc_owner)
  const [subject, setSubject] = useState(config.subject_template ?? '')
  const [names, setNames] = useState(config.pipedrive_names.join(', '))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const dirty =
    toSource !== config.to_source ||
    ccOwner !== config.cc_owner ||
    subject !== (config.subject_template ?? '') ||
    names !== config.pipedrive_names.join(', ')

  function save() {
    setMsg(null)
    start(async () => {
      const r = await updateBankSettings(config.bank_slug, {
        to_source: toSource,
        cc_owner: ccOwner,
        subject_template: subject,
        pipedrive_names: names.split(','),
      })
      setMsg(r.ok ? { ok: true, text: 'Guardado' } : { ok: false, text: r.error })
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">¿De dónde sale el destinatario (Para)?</span>
          <select
            value={toSource}
            disabled={!canEdit}
            onChange={(e) => setToSource(e.target.value as ToSource)}
            className={INPUT}
          >
            {(Object.keys(TO_SOURCE_LABEL) as ToSource[]).map((k) => (
              <option key={k} value={k}>{TO_SOURCE_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Nombre(s) del banco en el deal bancario</span>
          <input value={names} disabled={!canEdit} onChange={(e) => setNames(e.target.value)} className={INPUT} />
          <span className="mt-0.5 block text-[11px] text-gray-400">Separados por coma. Sirve para encontrar las reglas de red flags.</span>
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={ccOwner}
          disabled={!canEdit}
          onChange={(e) => setCcOwner(e.target.checked)}
          className="h-4 w-4 accent-[var(--bayteca-green)]"
        />
        <span className="text-sm text-gray-700">Poner en copia al gestor (owner) del deal</span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600">Formato del asunto (referencia)</span>
        <input value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} className={INPUT} />
        <span className="mt-0.5 block text-[11px] text-gray-400">
          Informativo: el asunto lo sigue construyendo cada flujo de n8n.
        </span>
      </label>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || pending} className={BTN_PRIMARY}>
            {pending ? 'Guardando…' : 'Guardar ajustes'}
          </button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  )
}
