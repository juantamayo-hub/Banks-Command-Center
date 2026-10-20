'use client'

import Link from 'next/link'
import { useState } from 'react'
import BankLogo from './BankLogo'
import { INPUT } from './ui'

export interface BankCardData {
  slug: string
  name: string
  channel: 'email' | 'platform' | 'none' | 'unused'
  channelNote: string | null
  blocks: boolean
  redflags: 'own' | 'general' | 'na'
  recipients: string   // texto corto: "Correo del deal", "11 provincias", "1 correo"…
  coverage: string | null  // dato neutro: "El resto de provincias no se envía"
  warning: string | null   // solo problemas reales (sin destinatario)
  updatedAt: string
}

const FILTERS = [
  { key: 'email', label: 'Envío por correo' },
  { key: 'general', label: 'Regla general' },
  { key: 'blocks', label: 'Bloquean' },
  { key: 'na', label: 'No aplica' },
  { key: 'all', label: 'Todos' },
] as const
type FilterKey = (typeof FILTERS)[number]['key']

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' })
}

function Pill({ tone, children }: { tone: 'gray' | 'red' | 'green' | 'amber' | 'blue'; children: React.ReactNode }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-600',
    red: 'bg-red-50 text-red-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-sky-50 text-sky-700',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>
}

export default function BankGrid({ banks }: { banks: BankCardData[] }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<FilterKey>('email')

  const active = banks.filter((b) => b.channel !== 'unused')
  const unused = banks.filter((b) => b.channel === 'unused')
  const count = (k: FilterKey) => active.filter((b) => matches(b, k)).length
  function matches(b: BankCardData, k: FilterKey) {
    if (k === 'email') return b.channel === 'email'
    if (k === 'general') return b.redflags === 'general'
    if (k === 'blocks') return b.blocks
    if (k === 'na') return b.channel !== 'email'
    return true
  }
  const search = (b: BankCardData) => b.name.toLowerCase().includes(q.trim().toLowerCase())
  const visible = active.filter((b) => matches(b, filter) && search(b))
  const unusedVisible = unused.filter(search)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar banco…"
          className={`${INPUT} max-w-[240px]`}
        />
        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {f.label} <span className="tabular-nums text-gray-400">{count(f.key)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((b) => {
          const na = b.channel !== 'email'
          return (
            <Link
              key={b.slug}
              href={`/dashboard/configuracion/${b.slug}`}
              className={`group flex flex-col rounded-2xl border bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_8px_24px_-8px_rgba(16,24,40,0.12)] ${
                na ? 'border-dashed border-gray-200 opacity-75 hover:opacity-100' : 'border-gray-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <BankLogo slug={b.slug} name={b.name} size={40} />
                <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900">{b.name}</p>
                <span className="text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-500">→</span>
              </div>

              {na ? (
                <p className="mt-4 text-xs leading-relaxed text-gray-500">
                  <span className="font-medium text-gray-700">No aplica.</span> {b.channelNote}
                </p>
              ) : (
                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-gray-400">Red flags</dt>
                    <dd className="flex items-center gap-1.5 text-gray-700">
                      {b.redflags === 'na' ? <span className="text-gray-400">No aplican</span>
                        : b.redflags === 'general' ? <Pill tone="blue">Regla general</Pill>
                          : <span>Propias</span>}
                      {b.redflags !== 'na' && b.blocks && <Pill tone="red">Bloquean</Pill>}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-gray-400">Destinatario</dt>
                    <dd className="min-w-0 text-right">
                      <span className="block truncate text-gray-800">{b.recipients}</span>
                      {b.coverage && <span className="block text-[11px] text-gray-400">{b.coverage}</span>}
                    </dd>
                  </div>
                  {b.warning && <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{b.warning}</p>}
                </dl>
              )}

              <p className="mt-auto pt-4 text-[11px] text-gray-300 transition-colors group-hover:text-gray-400">Editado {fmtDate(b.updatedAt)}</p>
            </Link>
          )
        })}
        {!visible.length && <p className="col-span-full py-10 text-center text-sm text-gray-400">Ningún banco coincide</p>}
      </div>

      {unusedVisible.length > 0 && (
        <details className="group/unused mt-4 rounded-xl border border-gray-100 bg-white px-5 py-4" open={!!q.trim()}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span>
              <span className="text-sm font-semibold text-gray-800">En Pipedrive, sin actividad ({unusedVisible.length})</span>
              <span className="block text-xs text-gray-500">
                Bancos del desplegable de Pipedrive con los que hoy no trabajamos: no están en la hoja, ni en n8n, ni en plataformas.
              </span>
            </span>
            <span className="text-xs text-gray-400 group-open/unused:hidden">Mostrar</span>
            <span className="hidden text-xs text-gray-400 group-open/unused:inline">Ocultar</span>
          </summary>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unusedVisible.map((b) => (
              <li key={b.slug} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <BankLogo slug={b.slug} name={b.name} size={28} />
                <span className="text-sm text-gray-700">{b.name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
