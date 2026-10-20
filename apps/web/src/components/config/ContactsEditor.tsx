'use client'

import { useMemo, useState, useTransition } from 'react'
import { deleteContact, saveContact, type ContactInput } from '@/app/actions/bankConfig'
import type { BankConfig, BankContact, ContactScope, Province } from '@/lib/bankConfig'
import EmailChips from './EmailChips'
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT } from './ui'

interface Props {
  config: BankConfig
  contacts: BankContact[]
  provinces: Province[]
  canEdit: boolean
}

const SCOPE_TITLE: Record<ContactScope, string> = {
  default: 'Por defecto',
  province: 'Por provincia',
  when_to: 'Copia condicional',
}

function emptyDraft(slug: string, scope: ContactScope): ContactInput {
  return { bank_slug: slug, scope, scope_value: null, to_emails: [], cc_emails: [], cc_owner: null, active: true, notes: '' }
}

function ContactRow({
  contact, provinces, canEdit, usedProvinces, onDone,
}: {
  contact: ContactInput
  provinces: Province[]
  canEdit: boolean
  usedProvinces: Set<string>
  onDone?: () => void
}) {
  const isNew = !contact.id
  const [editing, setEditing] = useState(isNew)
  const [d, setD] = useState<ContactInput>(contact)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const provinceNames = useMemo(
    () => Array.from(new Set(provinces.map((p) => p.name))).sort((a, b) => a.localeCompare(b, 'es')),
    [provinces],
  )

  function save() {
    setError(null)
    start(async () => {
      const r = await saveContact(d)
      if (!r.ok) setError(r.error)
      else {
        setEditing(false)
        onDone?.()
      }
    })
  }

  function remove() {
    if (!contact.id) return
    start(async () => {
      const r = await deleteContact(contact.id!)
      if (!r.ok) setError(r.error)
    })
  }

  const scopeLabel =
    d.scope === 'default' ? 'Resto / todas' : d.scope === 'province' ? (d.scope_value ?? '') : `Si Para = ${d.scope_value}`

  if (!editing) {
    return (
      <tr className={`border-t border-gray-100 align-top ${d.active ? '' : 'opacity-50'}`}>
        <td className="py-2 pr-3 text-sm font-medium text-gray-800">{scopeLabel}</td>
        <td className="py-2 pr-3 text-xs text-gray-700 break-all">{d.to_emails.join(', ') || <span className="text-gray-400">—</span>}</td>
        <td className="py-2 pr-3 text-xs text-gray-700 break-all">
          {d.cc_emails.join(', ')}
          {d.cc_owner === true && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500">+ owner</span>}
          {d.cc_owner === false && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500">sin owner</span>}
          {!d.cc_emails.length && d.cc_owner === null && <span className="text-gray-400">—</span>}
        </td>
        <td className="py-2 text-right whitespace-nowrap">
          {canEdit && !confirmDelete && (
            <>
              <button type="button" className={BTN_GHOST} onClick={() => setEditing(true)}>Editar</button>
              <button type="button" className={BTN_GHOST} onClick={() => setConfirmDelete(true)}>Borrar</button>
            </>
          )}
          {confirmDelete && (
            <span className="inline-flex items-center gap-1 text-xs">
              ¿Borrar?
              <button type="button" disabled={pending} className="rounded px-1.5 py-0.5 text-red-700 hover:bg-red-50" onClick={remove}>Sí</button>
              <button type="button" className={BTN_GHOST} onClick={() => setConfirmDelete(false)}>No</button>
            </span>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t border-gray-100 bg-gray-50/60 align-top">
      <td className="py-2 pr-3">
        {d.scope === 'province' ? (
          <select
            value={d.scope_value ?? ''}
            onChange={(e) => setD({ ...d, scope_value: e.target.value })}
            className={INPUT}
          >
            <option value="">Provincia…</option>
            {provinceNames.map((p) => (
              <option key={p} value={p} disabled={usedProvinces.has(p.toLowerCase()) && p !== contact.scope_value}>
                {p}
              </option>
            ))}
          </select>
        ) : d.scope === 'when_to' ? (
          <input
            value={d.scope_value ?? ''}
            placeholder="correo Para que activa la copia"
            onChange={(e) => setD({ ...d, scope_value: e.target.value })}
            className={INPUT}
          />
        ) : (
          <span className="text-sm font-medium text-gray-800">Resto / todas</span>
        )}
        <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
          Activo
        </label>
      </td>
      <td className="py-2 pr-3">
        {d.scope !== 'when_to' ? (
          <EmailChips value={d.to_emails} onChange={(v) => setD({ ...d, to_emails: v })} />
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <EmailChips value={d.cc_emails} onChange={(v) => setD({ ...d, cc_emails: v })} placeholder="copia (opcional)" />
        {d.scope !== 'when_to' && (
          <select
            value={d.cc_owner === null ? '' : d.cc_owner ? 'yes' : 'no'}
            onChange={(e) => setD({ ...d, cc_owner: e.target.value === '' ? null : e.target.value === 'yes' })}
            className={`${INPUT} mt-1.5 text-xs`}
          >
            <option value="">Owner en copia: lo que diga el banco</option>
            <option value="yes">Owner en copia: sí</option>
            <option value="no">Owner en copia: no</option>
          </select>
        )}
      </td>
      <td className="py-2 text-right whitespace-nowrap">
        <div className="flex flex-col items-end gap-1">
          <button type="button" disabled={pending} onClick={save} className={BTN_PRIMARY}>
            {pending ? '…' : 'Guardar'}
          </button>
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => {
              setD(contact)
              setEditing(false)
              setError(null)
              onDone?.()
            }}
          >
            Cancelar
          </button>
          {error && <p className="max-w-[180px] text-right text-xs text-red-600 whitespace-normal">{error}</p>}
        </div>
      </td>
    </tr>
  )
}

export default function ContactsEditor({ config, contacts, provinces, canEdit }: Props) {
  const [adding, setAdding] = useState<ContactScope | null>(null)
  const [filter, setFilter] = useState('')

  const sorted = [...contacts].sort((a, b) => {
    const order = { default: 0, province: 1, when_to: 2 } as const
    return order[a.scope] - order[b.scope] || (a.scope_value ?? '').localeCompare(b.scope_value ?? '', 'es')
  })
  const used = new Set(contacts.filter((c) => c.scope === 'province').map((c) => (c.scope_value ?? '').toLowerCase()))
  const hasDefault = contacts.some((c) => c.scope === 'default')
  const visible = sorted.filter((c) => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return (c.scope_value ?? 'resto').toLowerCase().includes(f) ||
      [...c.to_emails, ...c.cc_emails].some((e) => e.includes(f))
  })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {contacts.length > 8 ? (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar provincia o correo…"
            className={`${INPUT} max-w-xs`}
          />
        ) : <span />}
        {canEdit && !adding && (
          <div className="flex flex-wrap gap-2">
            {!hasDefault && (
              <button type="button" className={BTN_SECONDARY} onClick={() => setAdding('default')}>+ Por defecto</button>
            )}
            <button type="button" className={BTN_SECONDARY} onClick={() => setAdding('province')}>+ Provincia</button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setAdding('when_to')}>+ Copia condicional</button>
          </div>
        )}
      </div>

      {config.to_source === 'deal_field' && (
        <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          El destinatario de {config.display_name} sale del campo <b>“Email bancario”</b> del deal bancario. Aquí solo se configuran copias.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-2 pr-3 font-medium w-[22%]">Ámbito</th>
              <th className="pb-2 pr-3 font-medium">Para</th>
              <th className="pb-2 pr-3 font-medium">Copia (CC)</th>
              <th className="pb-2 w-[110px]" />
            </tr>
          </thead>
          <tbody>
            {adding && (
              <ContactRow
                key={`new-${adding}`}
                contact={emptyDraft(config.bank_slug, adding)}
                provinces={provinces}
                canEdit={canEdit}
                usedProvinces={used}
                onDone={() => setAdding(null)}
              />
            )}
            {visible.map((c) => (
              <ContactRow
                key={`${c.id}-${c.updated_at}`}
                contact={{
                  id: c.id, bank_slug: c.bank_slug, scope: c.scope, scope_value: c.scope_value,
                  to_emails: c.to_emails, cc_emails: c.cc_emails, cc_owner: c.cc_owner, active: c.active, notes: c.notes,
                }}
                provinces={provinces}
                canEdit={canEdit}
                usedProvinces={used}
              />
            ))}
            {!visible.length && !adding && (
              <tr><td colSpan={4} className="py-6 text-center text-sm text-gray-400">Sin correos configurados</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        {SCOPE_TITLE.province}: gana sobre {SCOPE_TITLE.default.toLowerCase()}. Si una provincia no tiene fila y no hay
        fila por defecto, el flujo no envía y avisa (“sin configuración”).
      </p>
    </div>
  )
}
