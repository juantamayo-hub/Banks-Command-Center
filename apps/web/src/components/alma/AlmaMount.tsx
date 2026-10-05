import { createClient } from '@/lib/supabase/server'
import { almaAllowedFor, almaEnv } from '@/lib/alma/config'
import { isAlmaAdmin } from '@/lib/alma/admins'
import AlmaBoundary from './AlmaBoundary'
import AlmaChat from './AlmaChat'

/** Pinta la burbuja de Alma solo si está activada en este entorno y el usuario está permitido. */
export async function almaVisibleForCurrentUser(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return almaAllowedFor(user?.email) && (await isAlmaAdmin(user?.email))
  } catch {
    return false
  }
}

export default function AlmaMount() {
  return (
    <AlmaBoundary>
      <AlmaChat apiBase="/api/alma" envLabel={almaEnv() === 'production' ? undefined : 'staging'} />
    </AlmaBoundary>
  )
}
