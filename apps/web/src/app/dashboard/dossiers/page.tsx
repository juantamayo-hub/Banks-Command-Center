import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import StatusBadge from '@/components/ui/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'
import RealtimeRefresh from '@/components/dashboard/RealtimeRefresh'

/**
 * Dossiers creados por el generador (tabla dossiers, desde la migración 035) y, por banco, cómo va su envío.
 * Solo aparecen los dossiers registrados en el Command Center (bancos ya pasados de la hoja al CC).
 */

export const dynamic = 'force-dynamic'

const DAYS_OPTIONS = [1, 7, 30] as const
const PD = 'https://mdsl.pipedrive.com/deal/'

const DOSSIER_STATUS: Record<string, { label: string; cls: string }> = {
  generating: { label: 'Generando', cls: 'bg-indigo-50 text-indigo-700' },
  ready: { label: 'Listo', cls: 'bg-green-50 text-green-700' },
  error: { label: 'Error', cls: 'bg-red-50 text-red-700' },
}

interface DossierRow {
  id: string
  opportunity_id: number
  dossier_key: string
  cliente: string | null
  owner: string | null
  importe: number | null
  link_dossier: string | null
  status: string
  error_type: string | null
  error_text: string | null
  test_mode: boolean
  created_at: string
}

interface LineRow {
  id: string
  dossier_id: string
  status: string
  block_reason: string | null
  last_error: string | null
  bank_deal_id: number | null
  banks: { name: string } | { name: string }[] | null
}

const fmtEur = (v: number | null) =>
  v ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v) : '—'
const fmtDate = (s: string) =>
  new Date(s).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
/** Inicio de la ventana: fuera del componente (regla react-hooks/purity) */
function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}
const bankName = (b: LineRow['banks']) => (Array.isArray(b) ? b[0]?.name : b?.name) ?? '—'

export default async function DossiersPage({ searchParams }: { searchParams: Promise<{ dias?: string; estado?: string }> }) {
  const params = await searchParams
  const days = DAYS_OPTIONS.find((d) => String(d) === params.dias) ?? 7
  const estado = ['generating', 'ready', 'error'].includes(params.estado ?? '') ? params.estado! : null
  const since = sinceIso(days)

  const supabase = await createClient()
  let q = supabase
    .from('dossiers')
    .select('id, opportunity_id, dossier_key, cliente, owner, importe, link_dossier, status, error_type, error_text, test_mode, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(300)
  if (estado) q = q.eq('status', estado)
  const { data: dossiersRaw, error } = await q
  const dossiers = (dossiersRaw ?? []) as DossierRow[]

  const ids = dossiers.map((d) => d.id)
  const { data: linesRaw } = ids.length
    ? await supabase
        .from('sheet_rows')
        .select('id, dossier_id, status, block_reason, last_error, bank_deal_id, banks(name)')
        .in('dossier_id', ids)
    : { data: [] }
  const linesByDossier = new Map<string, LineRow[]>()
  for (const l of (linesRaw ?? []) as LineRow[]) {
    const list = linesByDossier.get(l.dossier_id) ?? []
    list.push(l)
    linesByDossier.set(l.dossier_id, list)
  }

  const href = (p: { dias?: number; estado?: string | null }) => {
    const sp = new URLSearchParams()
    sp.set('dias', String(p.dias ?? days))
    const e = p.estado === undefined ? estado : p.estado
    if (e) sp.set('estado', e)
    return `/dashboard/dossiers?${sp.toString()}`
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <RealtimeRefresh />
      <PageHeader title="Dossiers" subtitle="Dossiers generados y estado de su envío a cada banco (bancos enviados desde el Command Center)." />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {DAYS_OPTIONS.map((d) => (
          <Link key={d} href={href({ dias: d })}
            className={d === days ? 'rounded-full bg-gray-900 px-3 py-1 font-medium text-white' : 'rounded-full border border-gray-300 bg-white px-3 py-1 text-gray-600 hover:bg-gray-50'}>
            {d === 1 ? 'Hoy' : `${d} días`}
          </Link>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        {[null, 'ready', 'generating', 'error'].map((e) => (
          <Link key={e ?? 'all'} href={href({ estado: e })}
            className={e === estado ? 'rounded-full bg-gray-900 px-3 py-1 font-medium text-white' : 'rounded-full border border-gray-300 bg-white px-3 py-1 text-gray-600 hover:bg-gray-50'}>
            {e ? DOSSIER_STATUS[e].label : 'Todos'}
          </Link>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No se pudieron cargar los dossiers ({error.message}). ¿Está aplicada la migración 035?
        </div>
      )}

      {!error && dossiers.length === 0 ? (
        <EmptyState title="No hay dossiers en este periodo." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Creado</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3 text-right">Importe</th>
                  <th className="px-4 py-3">Dossier</th>
                  <th className="px-4 py-3">Envío por banco</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dossiers.map((d) => {
                  const st = DOSSIER_STATUS[d.status] ?? DOSSIER_STATUS.generating
                  const lines = linesByDossier.get(d.id) ?? []
                  return (
                    <tr key={d.id} className="align-top hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {fmtDate(d.created_at)}
                        {d.test_mode && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">PRUEBA</span>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-800">{d.cliente ?? '—'}</p>
                        <p className="text-xs text-gray-400">
                          <a href={`${PD}${d.opportunity_id}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-blue-600">{d.opportunity_id}</a>
                          {d.owner ? ` · ${d.owner}` : ''}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtEur(d.importe)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                        {d.dossier_key !== 'UNICO' && <span className="ml-1 text-xs text-gray-500">Tipo {d.dossier_key}</span>}
                        {d.link_dossier && (
                          <a href={d.link_dossier} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-blue-600 hover:underline">Drive</a>
                        )}
                        {d.status === 'error' && (
                          <p className="mt-1 max-w-xs text-xs text-red-700">{[d.error_type, d.error_text].filter(Boolean).join(': ')}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {lines.length === 0 ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {lines.map((l) => (
                              <li key={l.id} className="flex flex-wrap items-center gap-2">
                                <span className="w-28 truncate text-xs font-medium text-gray-700">{bankName(l.banks)}</span>
                                <StatusBadge status={l.status} />
                                {(l.block_reason || l.last_error) && (
                                  <span className="max-w-xs truncate text-xs text-gray-500" title={l.block_reason || l.last_error || ''}>
                                    {l.block_reason || l.last_error}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
