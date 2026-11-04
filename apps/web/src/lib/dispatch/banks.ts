/**
 * Solo servidor. Bancos que se envían por correo (n8n "Send Dossier") y su interruptor de motor.
 *
 * bank_config.bank_slug  → clave de configuración (hipotecas_com, cr_teruel…)
 * bank_config.banks_slug → slug de la tabla banks, que es la de sheet_rows.bank_id (hipotecas_com → uci)
 * bank_config.dispatch_engine: 'sheets' = hoja + Apps Script (antiguo) · 'cc' = el Command Center envía
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type DispatchEngine = 'sheets' | 'cc'

export interface DispatchBank {
  bank_slug: string
  display_name: string
  pipedrive_names: string[]
  channel: string
  dispatch_engine: DispatchEngine
  send_webhook_path: string | null
  send_payload_prefix: string | null
  banks_slug: string | null
  bank_id: number | null
}

// Como el distribuidor de Apps Script ("Pasar datos a pestañas"): la opción "UCI" del deal va a la pestaña de Hipotecas.com
const PIPEDRIVE_ALIASES: Record<string, string> = { UCI: 'hipotecas_com' }

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9.]+/g, ' ').trim()

export async function loadDispatchBanks(db: SupabaseClient): Promise<DispatchBank[]> {
  const [cfg, banks] = await Promise.all([
    db.from('bank_config').select('bank_slug, display_name, pipedrive_names, channel, dispatch_engine, send_webhook_path, send_payload_prefix, banks_slug'),
    db.from('banks').select('id, slug'),
  ])
  if (cfg.error) throw new Error(`bank_config: ${cfg.error.message}`)
  if (banks.error) throw new Error(`banks: ${banks.error.message}`)
  const idBySlug = new Map((banks.data ?? []).map((b) => [b.slug as string, b.id as number]))
  return (cfg.data ?? []).map((c) => ({
    ...(c as Omit<DispatchBank, 'bank_id'>),
    pipedrive_names: (c.pipedrive_names as string[] | null) ?? [],
    bank_id: c.banks_slug ? idBySlug.get(c.banks_slug as string) ?? null : null,
  }))
}

/** Nombre del banco tal como viene en Pipedrive (Bank 1–5) → banco configurado. */
export function resolveDispatchBank(list: DispatchBank[], pipedriveName: string): DispatchBank | null {
  const n = norm(pipedriveName)
  if (!n) return null
  const alias = PIPEDRIVE_ALIASES[n]
  if (alias) return list.find((b) => b.bank_slug === alias) ?? null
  return (
    list.find((b) => b.bank_slug === pipedriveName.trim()) ??
    list.find((b) => norm(b.display_name) === n || b.pipedrive_names.some((p) => norm(p) === n)) ??
    null
  )
}

/**
 * Bancos que staging prueba como si estuvieran en 'cc' SIN tocar el interruptor (la base es la misma que producción).
 * Solo fuera de producción (y siempre en modo prueba: el correo va al email de prueba). DISPATCH_TEST_BANKS=a,b
 */
function stagingTestBanks(): Set<string> {
  if (process.env.VERCEL_ENV === 'production') return new Set()
  return new Set((process.env.DISPATCH_TEST_BANKS ?? 'cr_teruel').split(',').map((s) => s.trim()).filter(Boolean))
}

/** ¿El CC envía este banco? (correo + interruptor en 'cc' + webhook y fila de banks configurados) */
export function isCcBank(b: DispatchBank | null | undefined): b is DispatchBank & { send_webhook_path: string; bank_id: number } {
  if (!b || b.channel !== 'email' || !b.send_webhook_path || !b.bank_id) return false
  return b.dispatch_engine === 'cc' || stagingTestBanks().has(b.bank_slug)
}
