'use client'

import Link from 'next/link'
import { useState } from 'react'
import BankLogo from './BankLogo'
import { INPUT } from './ui'

export interface BankCardData {
  slug: string
  name: string
  channel: 'email' | 'platform' | 'none'
  channelNote: string | null
  blocks: boolean
  redflags: 'own' | 'general' | 'na'
  recipients: string   // texto corto: "Correo del deal", "11 provincias", "1 correo"…
  warning: string | null
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

  const count = (k: FilterKey) => banks.filter((b) => matches(b, k)).length
  function matches(b: BankCardData, k: FilterKey) {
    if (k === 'email') return b.channel === 'email'
    if (k === 'general') return b.redflags === 'general'
    if (k === 'blocks') return b.blocks
    if (k === 'na') return b.channel !== 'email'
    return true
  }
  const visible = banks.filter((b) => matches(b, filter) && b.name.toLowerCase().includes(q.trim().toLowerCase()))

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
              className={`group flex flex-col rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md ${
                na ? 'border-dashed border-gray-200 opacity-75 hover:opacity-100' : 'border-gray-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <BankLogo slug={b.slug} name={b.name} size={36} />
                <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900">{b.name}</p>
                <span className="text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-500">→</span>
              </div>

              {na ? (
                <p className="mt-4 text-xs leading-relaxed text-gray-500">
                  <span className="font-medium text-gray-700">No aplica.</span> {b.channelNote}
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-500">Red flags</span>
                    <span className="flex items-center gap-1.5">
                      {b.redflags === 'na' ? <Pill tone="gray">No aplican</Pill>
                        : b.redflags === 'general' ? <Pill tone="blue">Regla general</Pill>
                          : <Pill tone="green">Propias</Pill>}
                      {b.redflags !== 'na' && (b.blocks ? <Pill tone="red">Bloquean</Pill> : <Pill tone="gray">Informan</Pill>)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-500">Destinatario</span>
                    <span className="truncate text-right text-gray-800">{b.recipients}</span>
                  </div>
                  {b.warning && <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{b.warning}</p>}
                </div>
              )}

              <p className="mt-auto pt-4 text-[11px] text-gray-400">Editado {fmtDate(b.updatedAt)}</p>
            </Link>
          )
        })}
        {!visible.length && <p className="col-span-full py-10 text-center text-sm text-gray-400">Ningún banco coincide</p>}
      </div>
    </div>
  )
}
