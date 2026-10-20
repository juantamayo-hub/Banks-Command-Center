import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import BankLogo from '@/components/config/BankLogo'
import { CARD } from '@/components/config/ui'
import { TO_SOURCE_LABEL, type BankConfig, type BankContact, type RedFlagRule } from '@/lib/bankConfig'

export const dynamic = 'force-dynamic'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'Europe/Madrid' })
}

export default async function ConfiguracionPage() {
  const supabase = await createClient()
  const [configs, contacts, rules] = await Promise.all([
    supabase.from('bank_config').select('*').order('display_name'),
    supabase.from('bank_contacts').select('bank_slug, scope, active, updated_at'),
    supabase.from('bank_redflag_rules').select('bank_slug, updated_at'),
  ])

  if (configs.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Configuración de bancos" />
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          No se pudo leer la configuración ({configs.error.message}). ¿Están aplicadas las migraciones 028 y 029?
        </div>
      </div>
    )
  }

  const banks = (configs.data ?? []) as BankConfig[]
  const contactRows = (contacts.data ?? []) as Pick<BankContact, 'bank_slug' | 'scope' | 'active' | 'updated_at'>[]
  const ruleRows = (rules.data ?? []) as Pick<RedFlagRule, 'bank_slug' | 'updated_at'>[]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración de bancos"
        subtitle="Red flags y correos de envío de dossier por banco. Los flujos de n8n leen esta configuración en cada envío."
        actions={
          <Link href="/dashboard/configuracion/ajustes" className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            Correos bloqueados y editores
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {banks.map((b) => {
          const own = contactRows.filter((c) => c.bank_slug === b.bank_slug && c.active)
          const provinces = own.filter((c) => c.scope === 'province').length
          const hasDefault = own.some((c) => c.scope === 'default')
          const nRules = ruleRows.filter((r) => r.bank_slug === b.bank_slug).length
          const last = [b.updated_at, ...own.map((c) => c.updated_at), ...ruleRows.filter((r) => r.bank_slug === b.bank_slug).map((r) => r.updated_at)]
            .sort()
            .at(-1)!
          return (
            <Link
              key={b.bank_slug}
              href={`/dashboard/configuracion/${b.bank_slug}`}
              className={`${CARD} group block transition-shadow hover:shadow-md`}
            >
              <div className="flex items-center gap-3">
                <BankLogo slug={b.bank_slug} name={b.display_name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{b.display_name}</p>
                  <p className="truncate text-[11px] text-gray-400">{TO_SOURCE_LABEL[b.to_source]}</p>
                </div>
                {b.block_on_red_flags ? (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">Bloquea</span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Informa</span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                <span>{nRules ? `${nRules} reglas de red flags` : 'Sin reglas (valores por defecto)'}</span>
                <span>
                  {provinces ? `${provinces} provincias` : ''}
                  {provinces && hasDefault ? ' + ' : ''}
                  {hasDefault ? 'correo por defecto' : ''}
                  {!provinces && !hasDefault ? (b.to_source === 'deal_field' ? 'Correo del deal' : 'Sin correos') : ''}
                </span>
                <span className="ml-auto">Editado {fmtDate(last)}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
