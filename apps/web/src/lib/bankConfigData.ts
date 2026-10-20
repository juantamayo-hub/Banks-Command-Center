import { createAdminClient } from '@/lib/supabase/server'
import type {
  BankConfig,
  BankContact,
  BlockedEmail,
  Province,
  RedFlagRule,
  RequiredDocument,
} from '@/lib/bankConfig'

/**
 * Solo servidor (usa service_role). Lectura de la configuración de bancos (tablas de la migración 028) con service_role.
 * Si falla cualquier consulta lanza error: n8n debe recibir 500 y NO enviar con datos incompletos.
 */
export async function loadBankConfig(bankSlug?: string) {
  const supabase = await createAdminClient()
  let configsQ = supabase.from('bank_config').select('*').order('display_name')
  let contactsQ = supabase.from('bank_contacts').select('*')
  let rulesQ = supabase.from('bank_redflag_rules').select('*')
  let docsQ = supabase.from('bank_required_documents').select('*').order('drive_code')
  if (bankSlug) {
    configsQ = configsQ.eq('bank_slug', bankSlug)
    contactsQ = contactsQ.eq('bank_slug', bankSlug)
    rulesQ = rulesQ.eq('bank_slug', bankSlug)
    docsQ = docsQ.eq('bank_slug', bankSlug)
  }

  const [configs, contacts, rules, docs, provinces, blocked] = await Promise.all([
    configsQ,
    contactsQ,
    rulesQ,
    docsQ,
    supabase.from('provinces').select('*').order('name'),
    supabase.from('blocked_emails').select('id, email, bank_slug, reason'),
  ])
  for (const r of [configs, contacts, rules, docs, provinces, blocked]) {
    if (r.error) throw new Error(`bank_config: ${r.error.message}`)
  }
  return {
    configs: (configs.data ?? []) as BankConfig[],
    contacts: (contacts.data ?? []) as BankContact[],
    rules: (rules.data ?? []) as RedFlagRule[],
    docs: (docs.data ?? []) as RequiredDocument[],
    provinces: (provinces.data ?? []) as Province[],
    blocked: (blocked.data ?? []) as BlockedEmail[],
  }
}
