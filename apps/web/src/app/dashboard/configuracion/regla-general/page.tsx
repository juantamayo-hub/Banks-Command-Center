import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import RulesMatrix from '@/components/config/RulesMatrix'
import GeneralMembership from '@/components/config/GeneralMembership'
import { CARD } from '@/components/config/ui'
import BackLink from '@/components/config/BackLink'
import { canEditBankConfig } from '@/app/actions/bankConfig'
import { OPERATION_TYPES, type BankConfig, type GeneralRule, type OperationType, type RuleValues } from '@/lib/bankConfig'

export const dynamic = 'force-dynamic'

export default async function ReglaGeneralPage() {
  const supabase = await createClient()
  const [general, configs, canEdit] = await Promise.all([
    supabase.from('bank_redflag_general').select('*'),
    supabase.from('bank_config').select('*').order('display_name'),
    canEditBankConfig(),
  ])
  const gen = (general.data ?? []) as GeneralRule[]
  const rules = Object.fromEntries(
    OPERATION_TYPES.map((op) => [op, gen.find((g) => g.operation_type === op) ?? null]),
  ) as Record<OperationType, RuleValues | null>
  const banks = ((configs.data ?? []) as BankConfig[])
    .filter((b) => b.channel === 'email' && b.redflags_apply)
    .map((b) => ({ slug: b.bank_slug, name: b.display_name, usesGeneral: b.uses_general_rules }))

  return (
    <div className="flex flex-col gap-6 p-6 pb-12">
      <BackLink />
      <PageHeader
        title="Regla general de red flags"
        subtitle="Criterios para los bancos que no tienen reglas propias. Un cambio aquí afecta a todos los bancos de la lista."
      />
      <section className={CARD}>
        <RulesMatrix key={gen.map((g) => g.updated_at).join()} bankSlug={null} rules={rules} canEdit={canEdit} />
      </section>
      <section className={CARD}>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Bancos</h2>
        <GeneralMembership banks={banks} canEdit={canEdit} />
      </section>
    </div>
  )
}
