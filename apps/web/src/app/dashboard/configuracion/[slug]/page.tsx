import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Tabs from '@/components/ui/Tabs'
import BankLogo from '@/components/config/BankLogo'
import BankSettingsForm from '@/components/config/BankSettingsForm'
import RedFlagsPanel from '@/components/config/RedFlagsPanel'
import ContactsEditor from '@/components/config/ContactsEditor'
import RecipientPreview from '@/components/config/RecipientPreview'
import DocumentsEditor from '@/components/config/DocumentsEditor'
import { CARD } from '@/components/config/ui'
import BackLink from '@/components/config/BackLink'
import AgentsEditor, { type AgentRow } from '@/components/config/AgentsEditor'
import AgentAssignments, { type AssignmentRowView } from '@/components/config/AgentAssignments'
import { canEditBankConfig } from '@/app/actions/bankConfig'
import type {
  BankConfig,
  BankContact,
  BlockedEmail,
  GeneralRule,
  Province,
  RedFlagRule,
  RequiredDocument,
} from '@/lib/bankConfig'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'correos', label: 'Destinatarios' },
  { key: 'red-flags', label: 'Red flags' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'ajustes', label: 'Ajustes' },
  { key: 'gestores', label: 'Gestores' },
  { key: 'asignaciones', label: 'Asignaciones' },
  { key: 'historial', label: 'Historial' },
] as const

/** Bancos que asignan gestor y nos mandan el listado (migración 032) */
const AGENT_BANKS = ['santander']
const AGENT_TABS = ['gestores', 'asignaciones']
type TabKey = (typeof TABS)[number]['key']

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tab?: string }>
}

interface HistoryRow {
  id: string
  table_name: string
  record_key: string | null
  action: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  actor: string
  created_at: string
}

const TABLE_LABEL: Record<string, string> = {
  bank_config: 'Ajustes',
  bank_redflag_rules: 'Red flags',
  bank_contacts: 'Destinatarios',
  bank_required_documents: 'Documentos',
  bank_agents: 'Gestores',
  blocked_emails: 'Correo bloqueado',
}
const IGNORED_KEYS = new Set(['id', 'created_at', 'updated_at', 'updated_by', 'bank_slug'])

function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const out: string[] = []
  for (const k of keys) {
    if (IGNORED_KEYS.has(k)) continue
    const a = JSON.stringify(before?.[k] ?? null)
    const b = JSON.stringify(after?.[k] ?? null)
    if (a !== b) out.push(`${k}: ${before ? a : '—'} → ${after ? b : '—'}`)
  }
  return out
}

export default async function BankConfigPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { tab: tabParam } = await searchParams

  const supabase = await createClient()
  const { data: config } = await supabase.from('bank_config').select('*').eq('bank_slug', slug).maybeSingle()
  if (!config) notFound()
  if (!('channel' in config)) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Falta aplicar la migración <b>030_bank_config_general_rules.sql</b> en Supabase (SQL editor).
        </div>
      </div>
    )
  }
  const bank = config as BankConfig
  const applies = bank.channel === 'email'
  const usesAgents = AGENT_BANKS.includes(slug)
  const visibleTabs = TABS.filter((t) =>
    AGENT_TABS.includes(t.key) ? usesAgents : applies || t.key === 'historial')
  const tab: TabKey = (visibleTabs.find((t) => t.key === tabParam)?.key ??
    (applies ? 'correos' : usesAgents ? 'gestores' : 'historial')) as TabKey

  const [rules, general, contacts, docs, provinces, blocked, history, canEdit, agents, assignments] = await Promise.all([
    supabase.from('bank_redflag_rules').select('*').eq('bank_slug', slug),
    supabase.from('bank_redflag_general').select('*'),
    supabase.from('bank_contacts').select('*').eq('bank_slug', slug),
    supabase.from('bank_required_documents').select('*').eq('bank_slug', slug).order('drive_code'),
    supabase.from('provinces').select('*').order('name'),
    supabase.from('blocked_emails').select('id, email, bank_slug, reason'),
    tab === 'historial'
      ? supabase.from('bank_config_history').select('*').eq('bank_slug', slug).order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as HistoryRow[] }),
    canEditBankConfig(),
    usesAgents
      ? supabase.from('bank_agents').select('id, full_name, email, active').eq('bank_slug', slug).order('full_name')
      : Promise.resolve({ data: [] as AgentRow[] }),
    usesAgents && tab === 'asignaciones'
      ? supabase.from('bank_agent_assignments').select('*').eq('bank_slug', slug).order('created_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as AssignmentRowView[] }),
  ])

  const base = `/dashboard/configuracion/${slug}`

  return (
    <div className="flex flex-col gap-6 p-6 pb-12">
      {/* Cabecera */}
      <div>
        <div className="mb-3"><BackLink /></div>
        <div className="flex flex-wrap items-center gap-4">
          <BankLogo slug={bank.bank_slug} name={bank.display_name} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-gray-900">{bank.display_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              {!applies && <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">No aplica</span>}
              {applies && bank.redflags_apply && (
                bank.block_on_red_flags
                  ? <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">Red flags bloquean</span>
                  : <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">Red flags informan</span>
              )}
              {applies && bank.redflags_apply && bank.uses_general_rules && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">Regla general</span>
              )}
              {!canEdit && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">Solo lectura</span>}
            </div>
          </div>
        </div>
      </div>

      {!applies && !usesAgents && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">
          <p className="font-medium text-gray-800">Esta configuración no aplica a {bank.display_name}</p>
          <p className="mt-1">{bank.channel_note}</p>
        </div>
      )}

      <Tabs tabs={visibleTabs.map((t) => ({ label: t.label, href: `${base}?tab=${t.key}`, active: t.key === tab }))} />

      {applies && tab === 'correos' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className={CARD}>
            <ContactsEditor
              config={bank}
              contacts={(contacts.data ?? []) as BankContact[]}
              provinces={(provinces.data ?? []) as Province[]}
              canEdit={canEdit}
            />
          </div>
          <div className="xl:sticky xl:top-4 xl:self-start">
            <RecipientPreview
              config={bank}
              contacts={(contacts.data ?? []) as BankContact[]}
              provinces={(provinces.data ?? []) as Province[]}
              blocked={(blocked.data ?? []) as BlockedEmail[]}
            />
          </div>
        </div>
      )}

      {applies && tab === 'red-flags' && (
        <RedFlagsPanel
          config={bank}
          rules={(rules.data ?? []) as RedFlagRule[]}
          general={(general.data ?? []) as GeneralRule[]}
          canEdit={canEdit}
        />
      )}

      {applies && tab === 'documentos' && (
        <div className={CARD}>
          <DocumentsEditor slug={slug} docs={(docs.data ?? []) as RequiredDocument[]} canEdit={canEdit} />
        </div>
      )}

      {applies && tab === 'ajustes' && (
        <div className={CARD}>
          <BankSettingsForm key={bank.updated_at} config={bank} canEdit={canEdit} />
        </div>
      )}

      {usesAgents && tab === 'gestores' && (
        <div className={CARD}>
          <p className="mb-4 text-xs text-gray-500">
            Santander manda cada día un Excel con el gestor asignado a cada cliente. Con esta lista se rellena
            automáticamente “Bank Mail / Email agente bancario” en el deal bancario (pipeline 7) y se deja una nota.
          </p>
          <AgentsEditor agents={(agents.data ?? []) as AgentRow[]} canEdit={canEdit} />
        </div>
      )}

      {usesAgents && tab === 'asignaciones' && (
        <AgentAssignments rows={(assignments.data ?? []) as AssignmentRowView[]} canEdit={canEdit} />
      )}

      {tab === 'historial' && (
        <div className={CARD}>
          {!(history.data ?? []).length ? (
            <p className="py-4 text-sm text-gray-400">Sin cambios registrados todavía.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {((history.data ?? []) as HistoryRow[]).map((h) => (
                <li key={h.id} className="py-3">
                  <p className="text-xs text-gray-500">
                    {new Date(h.created_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} · {h.actor} ·{' '}
                    <span className="font-medium text-gray-700">{TABLE_LABEL[h.table_name] ?? h.table_name}</span>
                    {h.record_key ? ` (${h.record_key})` : ''} ·{' '}
                    {h.action === 'insert' ? 'alta' : h.action === 'delete' ? 'baja' : 'cambio'}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {diff(h.before, h.after).map((line) => (
                      <li key={line} className="font-mono text-[11px] text-gray-700 break-all">{line}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
