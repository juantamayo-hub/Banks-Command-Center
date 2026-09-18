import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const ALLOWED_DOMAINS = ['huspy.io', 'bayteca.com']

function emailDomainAllowed(email: string | undefined): boolean {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  return ALLOWED_DOMAINS.includes(domain)
}

export async function middleware(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Already authenticated user visiting /login → send to dashboard
  if (pathname === '/login' && user && emailDomainAllowed(user.email)) {
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
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', 'domain_not_allowed')
    return NextResponse.redirect(loginUrl)
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
