/**
 * Supabase browser client.
 *
 * Use this file only inside Client Components (files with 'use client' at the top).
 * It uses the public ANON key which is safe to expose in the browser.
 * Never import the service_role key here — that key must stay on the server.
 */

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
