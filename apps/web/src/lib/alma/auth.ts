/**
 * Quién habla con Alma:
 *  - Command Center: sesión de Supabase (cookie) → requireAuth().
 *  - Request Hub: llamada servidor-a-servidor con x-alma-secret = ALMA_SHARED_SECRET y x-alma-user-email
 *    (Request Hub ya validó la sesión del usuario antes de reenviar).
 * Devuelve 404 si Alma no está activada en este entorno (producción hasta su aprobación).
 */

import { timingSafeEqual } from 'crypto'
import { requireAuth } from '@/lib/auth/requireAuth'
import { almaAllowedFor, almaEnabled } from './config'

const ALLOWED_DOMAINS = ['huspy.io', 'bayteca.com']

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export async function almaAuth(req: Request): Promise<{ ok: true; email: string; app: 'command_center' | 'request_hub' } | { ok: false; response: Response }> {
  if (!almaEnabled()) return { ok: false, response: Response.json({ error: 'Not found' }, { status: 404 }) }

  const shared = process.env.ALMA_SHARED_SECRET
  const given = req.headers.get('x-alma-secret')
  if (given) {
    const email = (req.headers.get('x-alma-user-email') || '').trim().toLowerCase()
    const domainOk = ALLOWED_DOMAINS.includes(email.split('@')[1] ?? '')
    if (!shared || !safeEqual(given, shared) || !domainOk) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
    if (!almaAllowedFor(email)) return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) }
    return { ok: true, email, app: 'request_hub' }
  }

  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, response: auth.response }
  if (!almaAllowedFor(auth.user.email)) return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  return { ok: true, email: auth.user.email.toLowerCase(), app: 'command_center' }
}
