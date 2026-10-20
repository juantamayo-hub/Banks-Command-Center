import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import BankGrid, { type BankCardData } from '@/components/config/BankGrid'
import { CARD } from '@/components/config/ui'
import {
  OPERATION_LABEL,
  resolveRecipients,
  type BankConfig,
  type BankContact,
  type GeneralRule,
  type Province,
  type RedFlagRule,
} from '@/lib/bankConfig'

export const dynamic = 'force-dynamic'

const fmt = (n: number | null | undefined, suffix = '') =>
  n === null || n === undefined ? '—' : `${Number(n).toLocaleString('es-ES')}${suffix}`

function recipientsSummary(b: BankConfig, contacts: BankContact[], provinces: Province[]): { text: string; warning: string | null } {
  const own = contacts.filter((c) => c.bank_slug === b.bank_slug && c.active)
  const prov = own.filter((c) => c.scope === 'province').length
  const def = own.find((c) => c.scope === 'default')
  if (b.to_source === 'deal_field') return { text: '"Email bancario" del deal', warning: null }

  const names = Array.from(new Set(provinces.map((p) => p.name))).filter((n) => n !== 'TBC')
  const uncovered = names.filter((n) =>
    resolveRecipients(b, contacts, provinces, [], { province: n }).route !== 'ok').length

  let text: string
  if (b.to_source === 'contacts_cc_deal_field') text = `${def?.to_emails[0] ?? '—'} · oficina por provincia`
  else if (prov && def) text = `${prov} provincias + resto`
  else if (prov) text = `${prov} provincias`
  else if (def) text = def.to_emails.length === 1 ? def.to_emails[0] : `${def.to_emails.length} correos`
  else text = 'Sin correos'
  if (b.to_source === 'deal_field_then_contacts') text = `Email del deal o ${text}`

  const warning = !own.length ? 'Sin destinatario configurado'
    : uncovered && b.to_source !== 'contacts_cc_deal_field' ? `${uncovered} provincias sin correo: no se envía` : null
  return { text, warning }
}

export default async function ConfiguracionPage() {
  const supabase = await createClient()
  const [configs, contacts, rules, general, provinces] = await Promise.all([
    supabase.from('bank_config').select('*').order('display_name'),
    supabase.from('bank_contacts').select('*'),
    supabase.from('bank_redflag_rules').select('bank_slug, updated_at'),
    supabase.from('bank_redflag_general').select('*'),
    supabase.from('provinces').select('*'),
  ])

  if (configs.error) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Configuración de bancos" />
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          No se pudo leer la configuración ({configs.error.message}). ¿Están aplicadas las migraciones 028–030?
        </div>
      </div>
    )
  }

  // La migración 030 añade channel / regla general: sin ella todo se vería como "No aplica"
  const missing030 = (configs.data ?? []).length > 0 && !('channel' in (configs.data ?? [])[0]) || !!general.error
  if (missing030) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Configuración de bancos" />
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Falta aplicar la migración <b>030_bank_config_general_rules.sql</b> en Supabase (SQL editor). Sin ella no se
          puede mostrar el canal de envío ni la regla general de cada banco.
        </div>
      </div>
    )
  }

  const banks = (configs.data ?? []) as BankConfig[]
  const contactRows = (contacts.data ?? []) as BankContact[]
  const ruleRows = (rules.data ?? []) as Pick<RedFlagRule, 'bank_slug' | 'updated_at'>[]
  const gen = (general.data ?? []) as GeneralRule[]
  const provs = (provinces.data ?? []) as Province[]
  const usingGeneral = banks.filter((b) => b.channel === 'email' && b.redflags_apply && b.uses_general_rules)
  const primera = gen.find((g) => g.operation_type === 'primera_residencia')

  const cards: BankCardData[] = banks.map((b) => {
    const r = recipientsSummary(b, contactRows, provs)
    const dates = [
      b.updated_at,
      ...contactRows.filter((c) => c.bank_slug === b.bank_slug).map((c) => c.updated_at),
      ...ruleRows.filter((x) => x.bank_slug === b.bank_slug).map((x) => x.updated_at),
    ].sort()
    return {
      slug: b.bank_slug,
      name: b.display_name,
      channel: b.channel,
      channelNote: b.channel_note,
      blocks: b.block_on_red_flags,
      redflags: !b.redflags_apply ? 'na' : b.uses_general_rules ? 'general' : 'own',
      recipients: r.text,
      warning: b.channel === 'email' ? r.warning : null,
      updatedAt: dates[dates.length - 1],
    }
  })
  // Primero los que aplican; dentro, alfabético
  cards.sort((a, b) => Number(a.channel !== 'email') - Number(b.channel !== 'email') || a.name.localeCompare(b.name, 'es'))

  return (
    <div className="flex flex-col gap-6 p-6 pb-12">
      <PageHeader
        title="Configuración de bancos"
        subtitle="Red flags y destinatarios del envío de dossier. Los flujos de n8n leen esta configuración en cada envío."
        actions={
          <Link href="/dashboard/configuracion/ajustes" className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            Correos bloqueados y editores
          </Link>
        }
      />

      <Link href="/dashboard/configuracion/regla-general" className={`${CARD} group block transition-shadow hover:shadow-md`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Regla general de red flags</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Se aplica a los bancos sin reglas propias. {usingGeneral.length} {usingGeneral.length === 1 ? 'banco la usa' : 'bancos la usan'}:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {usingGeneral.length
                ? usingGeneral.map((b) => (
                  <span key={b.bank_slug} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">{b.display_name}</span>
                ))
                : <span className="text-[11px] text-gray-400">Ninguno</span>}
            </div>
          </div>
          {primera && (
            <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-right text-xs sm:grid-cols-5">
              {[
                ['Importe mín.', fmt(primera.min_importe, ' €')],
                ['Plazo máx.', fmt(primera.max_plazo_anos, ' años')],
                ['Financiación', fmt(primera.max_financiacion_pct, ' %')],
                ['Edad + plazo', fmt(primera.max_edad_plazo)],
                ['Ingresos 1T', fmt(primera.min_ingresos_1t, ' €')],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] uppercase tracking-wide text-gray-400">{k}</dt>
                  <dd className="font-medium tabular-nums text-gray-800">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <p className="mt-3 text-[11px] text-gray-400 group-hover:text-gray-600">
          Valores de {OPERATION_LABEL.primera_residencia.toLowerCase()} · Editar regla y bancos →
        </p>
      </Link>

      <BankGrid banks={cards} />
    </div>
  )
}
