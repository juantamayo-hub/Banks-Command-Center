import { createClient } from '@/lib/supabase/server'
import { almaAllowedFor, almaEnv } from '@/lib/alma/config'
import AlmaChat from './AlmaChat'

/** Pinta la burbuja de Alma solo si está activada en este entorno y el usuario está permitido. */
export async function almaVisibleForCurrentUser(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return almaAllowedFor(user?.email)
  } catch {
    return false
  }
}

export default function AlmaMount() {
  return <AlmaChat apiBase="/api/alma" envLabel={almaEnv() === 'production' ? undefined : 'staging'} />
}
