'use client'

import { useState, useTransition } from 'react'
import { updateBankSettings } from '@/app/actions/bankConfig'
import { TO_SOURCE_LABEL, toSourceToToggle, toggleToToSource, type BankConfig, type ToSource } from '@/lib/bankConfig'
import { BTN_PRIMARY, INPUT } from './ui'

/** Pestaña Ajustes: origen del destinatario, nombres en el deal, copia al owner, asunto. */
export default function BankSettingsForm({ config, canEdit }: { config: BankConfig; canEdit: boolean }) {
  const [toSource, setToSource] = useState<ToSource>(config.to_source)
  const [ccOwner, setCcOwner] = useState(config.cc_owner)
  const [subject, setSubject] = useState(config.subject_template ?? '')
  const [names, setNames] = useState(config.pipedrive_names.join(', '))
  const toggle = toSourceToToggle(toSource)
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
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-600">Destinatario (Para): ¿qué correo tiene prioridad?</span>
          {toggle ? (
            <>
              <div role="radiogroup" className="inline-flex rounded-lg bg-gray-100 p-1">
                {([
                  ['deal', 'Email bancario de Pipedrive'],
                  ['contacts', 'Correos configurados (provincia / por defecto)'],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={toggle.priority === k}
                    disabled={!canEdit}
                    onClick={() => setToSource(toggleToToSource(k, toggle.fallback))}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-default ${
                      toggle.priority === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={toggle.fallback}
                  disabled={!canEdit}
                  onChange={(e) => setToSource(toggleToToSource(toggle.priority, e.target.checked))}
                  className="h-4 w-4 accent-[var(--bayteca-green)]"
                />
                {toggle.priority === 'deal'
                  ? 'Si el deal no tiene "Email bancario", usar los correos configurados'
                  : 'Si no hay correo configurado para la provincia, usar el "Email bancario" del deal'}
              </label>
              <span className="mt-1 block text-[11px] text-gray-400">{TO_SOURCE_LABEL[toSource]}</span>
            </>
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {TO_SOURCE_LABEL[toSource]}. Caso especial de este banco: se mantiene como en su flujo.
            </p>
          )}
        </div>
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
