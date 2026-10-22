import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import StatsCard from '@/components/ui/StatsCard'
import EmptyState from '@/components/ui/EmptyState'
import LenderSubmissionActions from '@/components/prestamos/LenderSubmissionActions'
import {
  type LenderStatus,
  type LenderSubmission,
  type LenderSubmissionEvent,
  LENDER_NAME,
  PRODUCT_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  isBankBlock,
  statusLabel,
  STATUS_STYLE,
  needsAction,
} from '@/lib/lenderSubmissions'
import { pipedriveDealUrl } from '@/lib/bankResponses'

export const dynamic = 'force-dynamic'

interface PrestamosPageProps {
  searchParams: Promise<{ vista?: string; lender?: string }>
}

const VISTAS: Record<string, { label: string; statuses: LenderStatus[] }> = {
  pendientes: { label: 'Pendientes', statuses: ['pending_docs', 'error'] },
  enviados: { label: 'Enviados', statuses: ['sent'] },
  descartados: { label: 'Descartados', statuses: ['dismissed'] },
  todos: { label: 'Todos', statuses: ['pending_docs', 'error', 'sent', 'dismissed'] },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  })
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function buildHref(current: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...current, ...patch })) if (v) params.set(k, v)
  const qs = params.toString()
  return `/dashboard/prestamos${qs ? `?${qs}` : ''}`
}

export default async function PrestamosPage({ searchParams }: PrestamosPageProps) {
  const params = await searchParams
  const vista = params.vista && params.vista in VISTAS ? params.vista : 'pendientes'
  const lender = params.lender && params.lender in LENDER_NAME ? params.lender : undefined
  const current = { vista: vista === 'pendientes' ? undefined : vista, lender }

  const supabase = await createClient()

  // Contadores por estado (sobre todos los casos de la entidad filtrada)
  const countFor = async (statuses: LenderStatus[], sinceDays?: number) => {
    let q = supabase.from('lender_submissions').select('id', { count: 'exact', head: true }).in('status', statuses)
    if (lender) q = q.eq('lender', lender)
    if (sinceDays) q = q.gte('sent_at', sinceIso(sinceDays))
    const { count, error } = await q
    return { count: count ?? 0, error }
  }
  const [docs, errs, sent30, dismissed] = await Promise.all([
    countFor(['pending_docs']),
    countFor(['error']),
    countFor(['sent'], 30),
    countFor(['dismissed']),
  ])

  let listQuery = supabase
    .from('lender_submissions')
    .select('*')
    .in('status', VISTAS[vista].statuses)
    .order('updated_at', { ascending: false })
    .limit(300)
  if (lender) listQuery = listQuery.eq('lender', lender)
  const { data, error: listError } = await listQuery
  const list = (data ?? []) as LenderSubmission[]

  // Historial de los casos mostrados
  const eventsBySubmission = new Map<string, LenderSubmissionEvent[]>()
  if (list.length) {
    const { data: events } = await supabase
      .from('lender_submission_events')
      .select('id, submission_id, status, missing_docs, detail, created_at')
      .in('submission_id', list.map((s) => s.id))
      .order('created_at', { ascending: false })
      .limit(1000)
    for (const e of (events ?? []) as LenderSubmissionEvent[]) {
      if (!e.submission_id) continue
      eventsBySubmission.set(e.submission_id, [...(eventsBySubmission.get(e.submission_id) ?? []), e])
    }
  }

  const error = listError ?? docs.error ?? errs.error
  const tableMissing = !!error && /lender_submissions|schema cache|does not exist/i.test(error.message)

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Préstamos"
        subtitle="Envíos a Cofidis (préstamo personal y reunificación de deudas): pendientes, enviados, historial y relanzamientos."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }]}
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {tableMissing
            ? 'Las tablas de préstamos todavía no existen en Supabase (migración 027_lender_submissions).'
            : `Error al cargar los datos: ${error.message}`}
        </div>
      )}

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatsCard label="Falta documentación" value={docs.count} color="text-amber-600" href={buildHref(current, { vista: undefined })} keepScroll />
        <StatsCard label="Error de envío" value={errs.count} color="text-red-600" href={buildHref(current, { vista: undefined })} keepScroll />
        <StatsCard label="Enviados (30 días)" value={sent30.count} color="text-emerald-600" href={buildHref(current, { vista: 'enviados' })} keepScroll />
        <StatsCard label="Descartados" value={dismissed.count} color="text-gray-500" href={buildHref(current, { vista: 'descartados' })} keepScroll />
      </div>

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(VISTAS).map(([key, v]) => (
          <Link
            key={key}
            scroll={false}
            data-keep-scroll
            href={buildHref(current, { vista: key === 'pendientes' ? undefined : key })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              key === vista ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {v.label}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-gray-200" />
        {Object.entries(LENDER_NAME).map(([slug, name]) => (
          <Link
            key={slug}
            scroll={false}
            data-keep-scroll
            href={buildHref(current, { lender: lender === slug ? undefined : slug })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              lender === slug ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {name}
          </Link>
        ))}
      </div>

      {/* ── Listado ──────────────────────────────────────────────────────── */}
      {list.length === 0 ? (
        <EmptyState
          title={vista === 'pendientes' ? 'No hay casos pendientes de envío' : 'Sin casos para estos filtros'}
          description={vista === 'pendientes' ? 'Aquí aparecerán los casos que n8n no haya podido enviar por falta de documentación o por un error.' : undefined}
        />
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {list.map((s) => {
            const lenderName = LENDER_NAME[s.lender] ?? s.lender
            const dealUrl = pipedriveDealUrl(s.deal_id)
            const bankUrl = pipedriveDealUrl(s.bank_deal_id)
            const events = eventsBySubmission.get(s.id) ?? []
            const action = needsAction(s)
            return (
              <div key={s.id} className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${action ? 'bg-amber-50/30' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}>
                      {statusLabel(s)}
                    </span>
                    <span className="text-sm font-semibold text-gray-800">{lenderName}</span>
                    <span className="text-sm text-gray-600">· {s.client_name ?? `Deal ${s.deal_id}`}</span>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
                      {PRODUCT_LABEL[s.product]}
                    </span>
                    {s.holders && <span className="text-xs text-gray-500">{s.holders === 2 ? '2 titulares' : '1 titular'}</span>}
                  </div>

                  {s.status === 'pending_docs' && s.missing_docs.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-gray-500">{s.missing_docs.some(isBankBlock) ? 'Motivos:' : 'Falta:'}</span>
                      {s.missing_docs.map((d) => (
                        <span
                          key={d}
                          className={`rounded-md border px-1.5 py-0.5 text-xs ${isBankBlock(d) ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                  {s.status === 'error' && s.error_message && <p className="mt-1.5 text-xs text-red-700">{s.error_message}</p>}
                  {s.status === 'sent' && (
                    <p className="mt-1.5 text-xs text-emerald-800">Enviado {fmtDate(s.sent_at)}{s.sent_to ? ` a ${s.sent_to}` : ''}</p>
                  )}

                  <p className="mt-1.5 text-xs text-gray-500">
                    {SOURCE_LABEL[s.source]}
                    {s.dni ? ` · DNI ${s.dni}` : ''}
                    {s.owner_email ? ` · Consultor: ${s.owner_email.split('@')[0]}` : ''}
                    {` · ${s.attempts} ${s.attempts === 1 ? 'intento' : 'intentos'}`}
                  </p>

                  {events.length > 0 && (
                    <details className="mt-1.5 text-xs text-gray-600">
                      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Historial ({events.length})</summary>
                      <ul className="mt-1 flex flex-col gap-0.5 border-l border-gray-200 pl-3">
                        {events.map((e) => (
                          <li key={e.id}>
                            <span className="text-gray-400">{fmtDate(e.created_at)}</span> · {STATUS_LABEL[e.status]}
                            {e.missing_docs.length > 0 ? ` (${e.missing_docs.some(isBankBlock) ? 'motivos' : 'falta'}: ${e.missing_docs.join(', ')})` : ''}
                            {e.detail ? ` — ${e.detail}` : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                  <span className="text-xs text-gray-500">Último intento {fmtDate(s.updated_at)}</span>
                  <div className="flex gap-2 text-xs">
                    {dealUrl && <a href={dealUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Deal ↗</a>}
                    {bankUrl && <a href={bankUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Deal bancario ↗</a>}
                  </div>
                  {(action || s.status === 'sent') && (
                    <LenderSubmissionActions
                      id={s.id}
                      status={s.status as 'pending_docs' | 'error' | 'sent'}
                      lenderName={lenderName}
                      reasons={s.status === 'pending_docs' ? s.missing_docs : []}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
