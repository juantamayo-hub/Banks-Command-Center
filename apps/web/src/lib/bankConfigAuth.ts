import { createAdminClient, createClient } from '@/lib/supabase/server'

/**
 * Solo servidor. Quién puede editar la configuración de bancos: sesión @huspy.io / @bayteca.com
 * y además estar en bank_config_editors. Lo usan las server actions de Configuración.
 */

const ALLOWED_DOMAINS = ['huspy.io', 'bayteca.com']

export type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

export async function sessionEmail(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const email = data.user?.email?.toLowerCase() ?? null
  if (!email || !ALLOWED_DOMAINS.includes(email.split('@')[1] ?? '')) return null
  return email
}

/** Devuelve el correo del editor o un error si no puede editar. */
export async function requireEditor(): Promise<{ email: string; db: AdminClient } | { error: string }> {
  const email = await sessionEmail()
  if (!email) return { error: 'Sesión no válida' }
  const db = await createAdminClient()
  const { data, error } = await db.from('bank_config_editors').select('email').eq('email', email).maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'No tienes permiso para editar la configuración de bancos' }
  return { email, db }
}

export function isAllowedDomain(email: string): boolean {
  return ALLOWED_DOMAINS.includes(email.split('@')[1] ?? '')
}
