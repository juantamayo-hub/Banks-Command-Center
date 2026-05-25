/**
 * Supabase server client.
 *
 * Use this file only inside:
 *   - Server Components
 *   - API Route Handlers (app/api/**)
 *   - Server Actions
 *
 * SECURITY RULES:
 *   - The ANON key is used by default for standard authenticated reads.
 *   - The SERVICE_ROLE key bypasses Row Level Security (RLS) entirely.
 *     It must NEVER be imported or used in any Client Component or browser code.
 *     It is only available here because this module runs exclusively on the server.
 *   - process.env.SUPABASE_SERVICE_ROLE_KEY is a server-only variable (no NEXT_PUBLIC_ prefix),
 *     so Next.js will never bundle it into the client JavaScript.
 *
 * In this project, Apps Script is the bridge that writes to Supabase.
 * The service_role key may be used in API routes that need to bypass RLS
 * for internal sync or relaunch operations — never in response to direct
 * browser calls that have not been validated server-side first.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Creates a Supabase client for Server Components and Route Handlers.
 * Uses the ANON key with cookie-based session forwarding.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // setAll is called from a Server Component where cookies cannot be
            // mutated. This is safe to ignore — the session will be refreshed
            // by middleware on the next request.
          }
        },
      },
    }
  )
}

/**
 * Creates a Supabase admin client using the service_role key.
 *
 * WARNING: This client bypasses ALL Row Level Security policies.
 * Only call this from server-side API routes after validating the request.
 * Never expose this client or its key to the browser under any circumstances.
 */
export async function createAdminClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Same as above — safe to ignore in Server Components.
          }
        },
      },
    }
  )
}
