/**
 * Supabase client for Next.js middleware.
 *
 * Unlike the server client (which uses `cookies()`), middleware receives
 * the request/response pair directly. This helper creates a Supabase
 * client that reads cookies from the request and writes refreshed tokens
 * back to the response.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write cookies into the request (for downstream server components)
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          // Re-create the response so it carries the updated request cookies
          response = NextResponse.next({ request })
          // Write cookies into the response (for the browser)
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Refresh the session — this call reads the auth cookies and, if the
  // access token is expired, refreshes it using the refresh token.
  const { data: { user } } = await supabase.auth.getUser()

  return { supabase, response, user }
}
