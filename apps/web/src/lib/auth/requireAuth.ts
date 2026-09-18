/**
 * Server-side auth guard for API routes.
 *
 * Usage at the top of any handler:
 *   const auth = await requireAuth()
 *   if (!auth.ok) return auth.response
 *   // auth.user is available
 */

import { createClient } from '@/lib/supabase/server'

const ALLOWED_DOMAINS = ['huspy.io', 'bayteca.com']

type AuthSuccess = { ok: true; user: { id: string; email: string } }
type AuthFailure = { ok: false; response: Response }

export async function requireAuth(): Promise<AuthSuccess | AuthFailure> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !user.email) {
      return {
        ok: false,
        response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      }
    }

    const domain = user.email.split('@')[1]?.toLowerCase()
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return {
        ok: false,
        response: Response.json({ error: 'Forbidden' }, { status: 403 }),
      }
    }

    return { ok: true, user: { id: user.id, email: user.email } }
  } catch {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
}
