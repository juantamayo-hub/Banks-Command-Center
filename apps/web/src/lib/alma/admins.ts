/**
 * Alma solo para administradores: la fuente es el rol de Request Hub (profiles.role = 'admin').
 * Se cachea 5 minutos por instancia. Si Request Hub no responde, se deniega (más vale cerrado que abierto).
 */

import { createClient } from '@supabase/supabase-js'

let cache: { at: number; admins: Set<string> } | null = null

export async function isAlmaAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  if (!cache || Date.now() - cache.at > 5 * 60_000) {
    const url = process.env.REQUEST_HUB_SUPABASE_URL
    const key = process.env.REQUEST_HUB_SUPABASE_SERVICE_KEY
    if (!url || !key) return false
    try {
      const rh = createClient(url, key, { auth: { persistSession: false } })
      const { data, error } = await rh.from('profiles').select('email').eq('role', 'admin')
      if (error) throw error
      cache = { at: Date.now(), admins: new Set((data ?? []).map((p) => String(p.email).toLowerCase())) }
    } catch {
      return cache ? cache.admins.has(email.toLowerCase()) : false
    }
  }
  return cache.admins.has(email.toLowerCase())
}
