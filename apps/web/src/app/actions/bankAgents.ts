'use server'

/**
 * Server Actions: gestores de banco (Configuración → Santander → Gestores / Asignaciones).
 * Solo editores (bank_config_editors). Cada cambio queda en bank_config_history.
 * Al añadir o corregir el correo de un gestor se reprocesan sus asignaciones pendientes (lib/santanderAgents).
 */

import { revalidatePath } from 'next/cache'
import { isValidEmail } from '@/lib/bankConfig'
import { requireEditor } from '@/lib/bankConfigAuth'
import { nameKey, SANTANDER, upsertAgentAndResolve } from '@/lib/santanderAgents'

export type AgentResult = { ok: true; resolved: number } | { ok: false; error: string }

const PATH = `/dashboard/configuracion/${SANTANDER}`

/** Alta o actualización (por nombre) + reproceso de pendientes de ese gestor. */
export async function saveAgent(name: string, email: string): Promise<AgentResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  if (!nameKey(name)) return { ok: false, error: 'Falta el nombre' }
  if (!isValidEmail(email)) return { ok: false, error: 'Correo no válido' }
  try {
    const { resolved } = await upsertAgentAndResolve(auth.db, { name, email, actor: auth.email })
    revalidatePath(PATH)
    return { ok: true, resolved: resolved.filter((r) => r.status === 'assigned' || r.status === 'already_assigned').length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Activar / desactivar (un gestor inactivo no se usa para asignar). */
export async function setAgentActive(id: string, active: boolean): Promise<AgentResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  const { data: before } = await auth.db.from('bank_agents').select('*').eq('id', id).single()
  if (!before) return { ok: false, error: 'Gestor no encontrado' }
  const { data: after, error } = await auth.db
    .from('bank_agents').update({ active, updated_by: auth.email }).eq('id', id).select('*').single()
  if (error) return { ok: false, error: error.message }
  await auth.db.from('bank_config_history').insert({
    bank_slug: before.bank_slug, table_name: 'bank_agents', record_key: before.name_key, action: 'update',
    before, after, actor: auth.email,
  })
  revalidatePath(PATH)
  return { ok: true, resolved: 0 }
}
