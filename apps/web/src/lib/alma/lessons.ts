/**
 * Lecciones aprendidas de Alma (tabla alma_lessons, curadas a partir del feedback 👎).
 * Se cachean 5 minutos por instancia. Nunca lanza: si falla, Alma sigue sin lecciones.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

let cache: { at: number; text: string } | null = null

export async function almaLessons(supabase: SupabaseClient): Promise<string> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.text
  try {
    const { data, error } = await supabase
      .from('alma_lessons')
      .select('texto')
      .eq('activo', true)
      .order('created_at', { ascending: true })
      .limit(60)
    if (error) throw error
    const rows = (data ?? []).map((r) => `- ${String(r.texto).trim()}`).filter((l) => l.length > 2)
    const text = rows.length ? `Lecciones aprendidas del feedback del equipo (síguelas):\n${rows.join('\n')}` : ''
    cache = { at: Date.now(), text }
    return text
  } catch {
    return cache?.text ?? ''
  }
}
