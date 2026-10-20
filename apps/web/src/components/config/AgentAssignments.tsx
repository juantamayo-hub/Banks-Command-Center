'use client'

import { useState, useTransition } from 'react'
import { saveAgent } from '@/app/actions/bankAgents'
import { BTN_PRIMARY, INPUT } from './ui'

export interface AssignmentRowView {
  id: string
  created_at: string
  updated_at: string
  client_name: string | null
  dni: string
  agent_name_raw: string
  agent_email: string | null
  bank_deal_id: number | null
  status: 'assigned' | 'already_assigned' | 'pending_agent' | 'deal_not_found' | 'error'
  detail: string | null
}

const STATUS: Record<AssignmentRowView['status'], { label: string; cls: string }> = {
  assigned: { label: 'Asignado', cls: 'bg-emerald-50 text-emerald-700' },
  already_assigned: { label: 'Ya estaba', cls: 'bg-gray-100 text-gray-600' },
  pending_agent: { label: 'Falta correo', cls: 'bg-amber-50 text-amber-800' },
  deal_not_found: { label: 'Sin deal', cls: 'bg-red-50 text-red-700' },
  error: { label: 'Error', cls: 'bg-red-50 text-red-700' },
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
}

/** Gestor desconocido: añadir su correo completa todas sus asignaciones pendientes. */
function PendingAgent({ name, count, canEdit }: { name: string; count: number; canEdit: boolean }) {
  const [email, setEmail] = useState('')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium text-gray-900">{name}</p>
        <p className="text-[11px] text-gray-500">{count} {count === 1 ? 'cliente espera' : 'clientes esperan'} su correo</p>
      </div>
      {canEdit ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@gruposantander.es" className={`${INPUT} min-w-[220px] flex-1`} />
          <button type="button" disabled={pending || !email.trim()} className={BTN_PRIMARY}
            onClick={() => start(async () => {
              const r = await saveAgent(name, email)
              setMsg(r.ok ? { ok: true, text: `Añadido · ${r.resolved} asignadas` } : { ok: false, text: r.error })
            })}>
            {pending ? 'Asignando…' : 'Añadir y asignar'}
          </button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      ) : (
        <span className="text-xs text-gray-400">Un editor debe añadir su correo</span>
      )}
    </li>
  )
}

export default function AgentAssignments({ rows, canEdit }: { rows: AssignmentRowView[]; canEdit: boolean }) {
  const pendingByName = new Map<string, number>()
  for (const r of rows) if (r.status === 'pending_agent') pendingByName.set(r.agent_name_raw, (pendingByName.get(r.agent_name_raw) ?? 0) + 1)

  return (
    <div className="space-y-4">
      {pendingByName.size > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-3">
          <p className="text-sm font-semibold text-amber-900">Gestores sin correo</p>
          <p className="text-xs text-amber-800">Santander los ha asignado pero no están en la lista. Al añadir el correo se completa la asignación en Pipedrive.</p>
          <ul className="divide-y divide-amber-100">
            {Array.from(pendingByName.entries()).map(([name, count]) => (
              <PendingAgent key={name} name={name} count={count} canEdit={canEdit} />
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-2 pr-3 font-medium">Recibido</th>
              <th className="pb-2 pr-3 font-medium">Cliente</th>
              <th className="pb-2 pr-3 font-medium">Gestor (Santander)</th>
              <th className="pb-2 pr-3 font-medium">Deal bancario</th>
              <th className="pb-2 pr-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top">
                <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">{fmt(r.created_at)}</td>
                <td className="py-2 pr-3">
                  <span className="block text-gray-800">{r.client_name ?? '—'}</span>
                  <span className="block font-mono text-[11px] text-gray-400">{r.dni}</span>
                </td>
                <td className="py-2 pr-3">
                  <span className="block text-gray-800">{r.agent_name_raw}</span>
                  {r.agent_email && <span className="block text-[11px] text-gray-500">{r.agent_email}</span>}
                </td>
                <td className="py-2 pr-3">
                  {r.bank_deal_id ? (
                    <a href={`https://mdsl.pipedrive.com/deal/${r.bank_deal_id}`} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline">
                      {r.bank_deal_id} ↗
                    </a>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
                <td className="py-2 pr-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  {r.detail && r.status !== 'assigned' && <span className="mt-0.5 block max-w-[280px] text-[11px] text-gray-500">{r.detail}</span>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">Todavía no ha llegado ningún Excel de Santander</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
