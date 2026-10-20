import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import { BlockedEmailsEditor, EditorsEditor } from '@/components/config/GlobalSettingsEditors'
import { CARD } from '@/components/config/ui'
import { canEditBankConfig } from '@/app/actions/bankConfig'
import type { BlockedEmail } from '@/lib/bankConfig'

export const dynamic = 'force-dynamic'

export default async function ConfigAjustesPage() {
  const supabase = await createClient()
  const [blocked, editors, banks, user, canEdit] = await Promise.all([
    supabase.from('blocked_emails').select('id, email, bank_slug, reason').order('email'),
    supabase.from('bank_config_editors').select('email').order('email'),
    supabase.from('bank_config').select('bank_slug, display_name').order('display_name'),
    supabase.auth.getUser(),
    canEditBankConfig(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Correos bloqueados y editores"
        breadcrumbs={[{ label: 'Configuración', href: '/dashboard/configuracion' }]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-gray-900">Correos bloqueados</h2>
          <p className="mb-3 mt-1 text-xs text-gray-500">
            Si el destinatario de un envío está aquí, el flujo no envía y avisa.
          </p>
          <BlockedEmailsEditor
            blocked={(blocked.data ?? []) as BlockedEmail[]}
            banks={(banks.data ?? []).map((b) => ({ slug: b.bank_slug as string, name: b.display_name as string }))}
            canEdit={canEdit}
          />
        </section>
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-gray-900">Editores</h2>
          <p className="mb-3 mt-1 text-xs text-gray-500">
            Pueden cambiar red flags y correos. El resto del equipo ve la configuración en modo lectura.
          </p>
          <EditorsEditor
            editors={(editors.data ?? []).map((e) => e.email as string)}
            me={user.data.user?.email?.toLowerCase() ?? null}
            canEdit={canEdit}
          />
        </section>
      </div>
    </div>
  )
}
