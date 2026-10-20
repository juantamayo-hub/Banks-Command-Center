'use client'

import { useState, useTransition } from 'react'
import { saveAgent, setAgentActive } from '@/app/actions/bankAgents'
import { BTN_GHOST, BTN_PRIMARY, INPUT } from './ui'

export interface AgentRow { id: string; full_name: string; email: string; active: boolean }

function Row({ a, canEdit }: { a: AgentRow; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState(a.email)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <tr className={`group/row border-t border-gray-100 align-middle transition-colors hover:bg-gray-50/70 ${a.active ? '' : 'opacity-50'}`}>
      <td className="py-2 pr-3 text-sm font-medium text-gray-800">{a.full_name}</td>
      <td className="py-2 pr-3 text-xs text-gray-700">
        {editing ? (
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
        ) : (
          <span className="break-all">{a.email}</span>
        )}
        {msg && <p className="mt-1 text-[11px] text-red-600">{msg}</p>}
      </td>
      <td className="py-2 text-right whitespace-nowrap">
        {canEdit && editing && (
          <>
            <button type="button" disabled={pending} className={BTN_PRIMARY}
              onClick={() => start(async () => {
                const r = await saveAgent(a.full_name, email)
                if (!r.ok) setMsg(r.error)
                else { setEditing(false); setMsg(null) }
              })}>
              {pending ? '…' : 'Guardar'}
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => { setEditing(false); setEmail(a.email); setMsg(null) }}>Cancelar</button>
          </>
        )}
        {canEdit && !editing && (
          <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
            <button type="button" className={BTN_GHOST} onClick={() => setEditing(true)}>Editar</button>
            <button type="button" disabled={pending} className={BTN_GHOST}
              onClick={() => start(async () => { await setAgentActive(a.id, !a.active) })}>
              {a.active ? 'Desactivar' : 'Activar'}
            </button>
          </span>
        )}
      </td>
    </tr>
  )
}

export default function AgentsEditor({ agents, canEdit }: { agents: AgentRow[]; canEdit: boolean }) {
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const visible = agents.filter((a) => `${a.full_name} ${a.email}`.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar gestor o correo…" className={`${INPUT} max-w-xs`} />
        <span className="text-xs text-gray-400">{agents.filter((a) => a.active).length} gestores activos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-2 pr-3 font-medium">Nombre (como lo escribe Santander)</th>
              <th className="pb-2 pr-3 font-medium">Correo</th>
              <th className="pb-2 w-[160px]" />
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => <Row key={`${a.id}-${a.email}-${a.active}`} a={a} canEdit={canEdit} />)}
            {!visible.length && <tr><td colSpan={3} className="py-6 text-center text-sm text-gray-400">Ningún gestor</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="mt-4 grid gap-2 border-t border-gray-100 pt-4 sm:grid-cols-[1fr_1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="NOMBRE APELLIDOS" className={INPUT} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@gruposantander.es" className={INPUT} />
          <button type="button" disabled={pending || !name.trim() || !email.trim()} className={BTN_PRIMARY}
            onClick={() => start(async () => {
              const r = await saveAgent(name, email)
              if (!r.ok) setMsg({ ok: false, text: r.error })
              else {
                setMsg({ ok: true, text: r.resolved ? `Añadido. ${r.resolved} asignaciones pendientes completadas.` : 'Añadido.' })
                setName(''); setEmail('')
              }
            })}>
            {pending ? '…' : 'Añadir gestor'}
          </button>
          {msg && <p className={`text-xs sm:col-span-3 ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  )
}
