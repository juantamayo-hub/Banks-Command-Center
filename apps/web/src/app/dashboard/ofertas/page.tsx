import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import StatsCard from '@/components/ui/StatsCard'
import EmptyState from '@/components/ui/EmptyState'
import { ACTIVE_BANKS } from '@/lib/banks'
import { getBankLogo } from '@/lib/bankLogos'
import {
  type BankResponse,
  type ResponseClassification,
  CLASSIFICATION_LABEL,
  CLASSIFICATION_STYLE,
  needsAttention,
  pipedriveDealUrl,
} from '@/lib/bankResponses'
import ResponseReviewActions from '@/components/ofertas/ResponseReviewActions'

export const dynamic = 'force-dynamic'

interface OfertasPageProps {
  searchParams: Promise<{ bank?: string; tipo?: string; vista?: string; dias?: string }>
}

const BANK_NAME = new Map<string, string>(ACTIVE_BANKS.map((b) => [b.slug, b.name]))
const TIPOS: ResponseClassification[] = ['offer', 'more_info', 'rejection', 'approval', 'other']
const DIAS = [7, 30, 90]

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  })
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function pct(n: number | null | undefined): string | null {
  return n === null || n === undefined ? null : `${n}%`
}

function offerHeadline(r: BankResponse): string | null {
  const o = r.offer
  if (!o) return null
  const parts: string[] = []
  if (o.fija?.tin_bonificado != null) parts.push(`Fija ${pct(o.fija.tin_bonificado)}`)
  if (o.mixta?.tin_fijo_bonificado != null) {
    const años = o.mixta.tramo_fijo_meses ? ` ${Math.round(o.mixta.tramo_fijo_meses / 12)}a` : ''
    parts.push(`Mixta ${pct(o.mixta.tin_fijo_bonificado)}${años}`)
  }
  if (o.variable?.euribor_diferencial_bonificado != null) parts.push(`Variable E+${o.variable.euribor_diferencial_bonificado}`)
  if (o.mortgage_amount) parts.push(`${o.mortgage_amount.toLocaleString('es-ES')} €`)
  if (o.term_years) parts.push(`${o.term_years} años`)
  return parts.length ? parts.join(' · ') : null
}

function buildHref(current: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...current, ...patch })) if (v) params.set(k, v)
  const qs = params.toString()
  return `/dashboard/ofertas${qs ? `?${qs}` : ''}`
}

export default async function OfertasPage({ searchParams }: OfertasPageProps) {
  const params = await searchParams
  const dias = DIAS.includes(Number(params.dias)) ? Number(params.dias) : 30
  const bank = params.bank && BANK_NAME.has(params.bank) ? params.bank : undefined
  const tipo = TIPOS.includes(params.tipo as ResponseClassification) ? (params.tipo as ResponseClassification) : undefined
  const vista = params.vista === 'atencion' ? 'atencion' : undefined
  const current = { bank, tipo, vista, dias: dias === 30 ? undefined : String(dias) }

  const since = sinceIso(dias)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('bank_responses')
    .select('*')
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(2000)

  const all = (data ?? []) as BankResponse[]
  const attention = all.filter(needsAttention)

  // KPIs sobre el periodo completo (sin filtros de banco/tipo)
  const offers = all.filter((r) => r.classification === 'offer').length
  const rejections = all.filter((r) => r.classification === 'rejection').length
  const moreInfo = all.filter((r) => r.classification === 'more_info').length

  // Resumen por banco
  const byBank = new Map<string, { total: number; offer: number; rejection: number; more_info: number; attention: number; last: string }>()
  for (const r of all) {
    const b = byBank.get(r.bank_slug) ?? { total: 0, offer: 0, rejection: 0, more_info: 0, attention: 0, last: r.received_at }
    b.total++
    if (r.classification === 'offer') b.offer++
    if (r.classification === 'rejection') b.rejection++
    if (r.classification === 'more_info') b.more_info++
    if (needsAttention(r)) b.attention++
    if (r.received_at > b.last) b.last = r.received_at
    byBank.set(r.bank_slug, b)
  }
  const bankRows = [...byBank.entries()].sort((a, b) => b[1].total - a[1].total)

  const list = (vista ? attention : all).filter(
    (r) => (!bank || r.bank_slug === bank) && (!tipo || r.classification === tipo)
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Ofertas recibidas"
        subtitle="Respuestas de los bancos procesadas por n8n: ofertas, peticiones de información y rechazos."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }]}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
            {DIAS.map((d) => (
              <Link
                key={d}
                href={buildHref(current, { dias: d === 30 ? undefined : String(d) })}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  d === dias ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {d} días
              </Link>
            ))}
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error al cargar respuestas: {error.message}
        </div>
      )}

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatsCard label={`Respuestas (${dias} días)`} value={all.length} href={buildHref(current, { vista: undefined, tipo: undefined })} />
        <StatsCard label="Ofertas" value={offers} color="text-emerald-600" href={buildHref(current, { vista: undefined, tipo: 'offer' })} />
        <StatsCard label="Más información" value={moreInfo} color="text-amber-600" href={buildHref(current, { vista: undefined, tipo: 'more_info' })} />
        <StatsCard label="Rechazos" value={rejections} color="text-red-600" href={buildHref(current, { vista: undefined, tipo: 'rejection' })} />
        <StatsCard label="Requieren atención" value={attention.length} color={attention.length ? 'text-orange-600' : 'text-gray-900'} href={buildHref(current, { vista: 'atencion', tipo: undefined })} />
      </div>

      {/* ── Por banco ─────────────────────────────────────────────────────── */}
      {bankRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Banco</th>
                <th className="px-4 py-2.5 text-right font-medium">Respuestas</th>
                <th className="px-4 py-2.5 text-right font-medium">Ofertas</th>
                <th className="px-4 py-2.5 text-right font-medium">Más info</th>
                <th className="px-4 py-2.5 text-right font-medium">Rechazos</th>
                <th className="px-4 py-2.5 text-right font-medium">Atención</th>
                <th className="px-4 py-2.5 text-right font-medium">Última</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {bankRows.map(([slug, b]) => {
                const logo = getBankLogo(slug)
                return (
                  <tr key={slug} className={slug === bank ? 'bg-gray-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-2">
                      <Link href={buildHref(current, { bank: slug === bank ? undefined : slug })} className="inline-flex items-center gap-2 font-medium text-gray-800 hover:underline">
                        {logo && <img src={logo} alt="" width={16} height={16} className="rounded-sm" />}
                        {BANK_NAME.get(slug) ?? slug}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.total}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{b.offer || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-700">{b.more_info || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-700">{b.rejection || '—'}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${b.attention ? 'font-semibold text-orange-600' : 'text-gray-400'}`}>{b.attention || '—'}</td>
                    <td className="px-4 py-2 text-right text-xs text-gray-500">{fmtDate(b.last)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Filtros activos ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={buildHref(current, { vista: undefined })}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${!vista ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'}`}
        >
          Todas
        </Link>
        <Link
          href={buildHref(current, { vista: 'atencion' })}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${vista ? 'border-orange-600 bg-orange-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'}`}
        >
          Requieren atención ({attention.length})
        </Link>
        <span className="mx-1 h-4 w-px bg-gray-200" />
        {TIPOS.map((t) => (
          <Link
            key={t}
            href={buildHref(current, { tipo: tipo === t ? undefined : t })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${tipo === t ? CLASSIFICATION_STYLE[t] + ' border-current' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'}`}
          >
            {CLASSIFICATION_LABEL[t]}
          </Link>
        ))}
        {bank && (
          <Link href={buildHref(current, { bank: undefined })} className="rounded-full border border-gray-300 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {BANK_NAME.get(bank)} ✕
          </Link>
        )}
      </div>

      {/* ── Listado ───────────────────────────────────────────────────────── */}
      {list.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'Todavía no hay respuestas registradas' : 'Sin resultados para estos filtros'}
          description={all.length === 0 ? 'Aparecerán aquí cuando los workflows de n8n empiecen a registrar en /api/bank-responses.' : undefined}
        />
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {list.slice(0, 300).map((r) => {
            const headline = offerHeadline(r)
            const bankUrl = pipedriveDealUrl(r.bank_deal_id)
            const generalUrl = pipedriveDealUrl(r.general_deal_id)
            const attn = needsAttention(r)
            return (
              <div key={r.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${attn ? 'bg-orange-50/40' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CLASSIFICATION_STYLE[r.classification]}`}>
                      {CLASSIFICATION_LABEL[r.classification]}
                    </span>
                    <span className="text-sm font-semibold text-gray-800">{BANK_NAME.get(r.bank_slug) ?? r.bank_slug}</span>
                    {r.client_name && <span className="text-sm text-gray-600">· {r.client_name}</span>}
                    {r.match_status !== 'matched' && (
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                        {r.match_status === 'ambiguous' ? 'Deal ambiguo' : 'Sin deal'}
                      </span>
                    )}
                    {r.status === 'error' && (
                      <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Error</span>
                    )}
                    {r.status === 'resolved' && (
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">
                        Gestionado{r.reviewed_by ? ` por ${r.reviewed_by.split('@')[0]}` : ''}
                      </span>
                    )}
                  </div>
                  {headline && <p className="mt-1 text-sm font-medium text-emerald-800">{headline}</p>}
                  {r.summary && <p className="mt-1 line-clamp-2 text-sm text-gray-600">{r.summary}</p>}
                  {r.required_action && <p className="mt-1 text-xs text-amber-700">Acción: {r.required_action}</p>}
                  {r.lost_reason && r.classification === 'rejection' && <p className="mt-1 text-xs text-red-700">Motivo: {r.lost_reason}</p>}
                  {r.error_message && (
                    <p className="mt-1 text-xs text-red-700">
                      {r.error_step ? `${r.error_step}: ` : ''}{r.error_message}
                    </p>
                  )}
                  {r.subject && <p className="mt-1 truncate text-xs text-gray-400">{r.subject}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                  <span className="text-xs text-gray-500">{fmtDate(r.received_at)}</span>
                  <div className="flex gap-2 text-xs">
                    {bankUrl && <a href={bankUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Deal banco ↗</a>}
                    {generalUrl && <a href={generalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Deal general ↗</a>}
                  </div>
                  {attn && <ResponseReviewActions id={r.id} unmatched={r.match_status !== 'matched'} />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
