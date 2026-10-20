import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import BankLogo from '@/components/config/BankLogo'
import BankSettingsForm from '@/components/config/BankSettingsForm'
import RedFlagRulesEditor from '@/components/config/RedFlagRulesEditor'
import ContactsEditor from '@/components/config/ContactsEditor'
import RecipientPreview from '@/components/config/RecipientPreview'
import DocumentsEditor from '@/components/config/DocumentsEditor'
import { CARD } from '@/components/config/ui'
import { canEditBankConfig } from '@/app/actions/bankConfig'
import type {
  BankConfig,
  BankContact,
  BlockedEmail,
  Province,
  RedFlagRule,
  RequiredDocument,
} from '@/lib/bankConfig'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'red-flags', label: 'Red flags' },
  { key: 'correos', label: 'Correos' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'historial', label: 'Historial' },
] as const
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
  bank_contacts: 'Correos',
  bank_required_documents: 'Documentos',
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
  const tab: TabKey = (TABS.find((t) => t.key === tabParam)?.key ?? 'red-flags') as TabKey

  const supabase = await createClient()
  const { data: config } = await supabase.from('bank_config').select('*').eq('bank_slug', slug).maybeSingle()
  if (!config) notFound()

  const [rules, contacts, docs, provinces, blocked, history, canEdit] = await Promise.all([
    supabase.from('bank_redflag_rules').select('*').eq('bank_slug', slug),
    supabase.from('bank_contacts').select('*').eq('bank_slug', slug),
    supabase.from('bank_required_documents').select('*').eq('bank_slug', slug).order('drive_code'),
    supabase.from('provinces').select('*').order('name'),
    supabase.from('blocked_emails').select('id, email, bank_slug, reason'),
    tab === 'historial'
      ? supabase.from('bank_config_history').select('*').eq('bank_slug', slug).order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as HistoryRow[] }),
    canEditBankConfig(),
  ])

  const bank = config as BankConfig
  const base = `/dashboard/configuracion/${slug}`

  return (
    <div className="space-y-6">
      <PageHeader
        title={bank.display_name}
        breadcrumbs={[{ label: 'Configuración', href: '/dashboard/configuracion' }]}
        actions={
          <span className="flex items-center gap-2">
            <BankLogo slug={bank.bank_slug} name={bank.display_name} size={32} />
            {!canEdit && <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">Solo lectura</span>}
          </span>
        }
      />

      <div className={CARD}>
        <BankSettingsForm key={bank.updated_at} config={bank} canEdit={canEdit} />
      </div>

      <Tabs tabs={TABS.map((t) => ({ label: t.label, href: `${base}?tab=${t.key}`, active: t.key === tab }))} />

      {tab === 'red-flags' && (
        <RedFlagRulesEditor
          key={(rules.data ?? []).map((r) => r.updated_at).join()}
          slug={slug}
          rules={(rules.data ?? []) as RedFlagRule[]}
          canEdit={canEdit}
        />
      )}

      {tab === 'correos' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className={CARD}>
            <ContactsEditor
              config={bank}
              contacts={(contacts.data ?? []) as BankContact[]}
              provinces={(provinces.data ?? []) as Province[]}
              canEdit={canEdit}
            />
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            <RecipientPreview
              config={bank}
              contacts={(contacts.data ?? []) as BankContact[]}
              provinces={(provinces.data ?? []) as Province[]}
              blocked={(blocked.data ?? []) as BlockedEmail[]}
            />
          </div>
        </div>
      )}

      {tab === 'documentos' && (
        <div className={CARD}>
          <DocumentsEditor slug={slug} docs={(docs.data ?? []) as RequiredDocument[]} canEdit={canEdit} />
        </div>
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
