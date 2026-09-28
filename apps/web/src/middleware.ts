import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const ALLOWED_DOMAINS = ['huspy.io', 'bayteca.com']

// La sesión caduca 24 h después del último inicio de sesión con Google
// (los refresh tokens de Supabase la mantendrían viva indefinidamente).
const MAX_SESSION_MS = 24 * 60 * 60 * 1000

function sessionExpired(lastSignInAt: string | undefined): boolean {
  const t = Date.parse(lastSignInAt ?? '')
  return Number.isFinite(t) && Date.now() - t > MAX_SESSION_MS
}

/** Redirige a /login borrando las cookies de sesión de Supabase (evita bucles /login ↔ /dashboard). */
function redirectToLogin(request: NextRequest, error?: string): NextResponse {
  const url = new URL('/login', request.url)
  if (error) url.searchParams.set('error', error)
  const res = NextResponse.redirect(url)
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith('sb-') && c.name.includes('auth-token')) res.cookies.delete(c.name)
  }
  return res
}

function emailDomainAllowed(email: string | undefined): boolean {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  return ALLOWED_DOMAINS.includes(domain)
}

export async function middleware(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Already authenticated user visiting /login → send to dashboard
  if (pathname === '/login' && user && emailDomainAllowed(user.email) && !sessionExpired(user.last_sign_in_at)) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Public route — let it through
  if (pathname === '/login') {
    return response
  }

  // No user → redirect to login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Domain check — sign out users from non-allowed domains
  if (!emailDomainAllowed(user.email)) {
    await supabase.auth.signOut()
    return redirectToLogin(request, 'domain_not_allowed')
  }

  // Sesión de más de 24 h → volver a iniciar sesión con Google
  if (sessionExpired(user.last_sign_in_at)) {
    await supabase.auth.signOut()
    return redirectToLogin(request, 'session_expired')
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Protect all routes EXCEPT:
     * - /api/* (cron, webhooks, n8n, etc.)
     * - /_next/* (Next.js internals)
     * - /banks/* (bank logo assets)
     * - Static files (favicon, images, SVGs, etc.)
     */
    '/((?!api|auth|_next/static|_next/image|banks|favicon\\.ico|icon\\.png|bayteca-logo\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
