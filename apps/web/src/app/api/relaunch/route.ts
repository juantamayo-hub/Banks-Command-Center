/**
 * POST /api/relaunch — DEPRECATED
 *
 * The dashboard now uses a Server Action (app/actions/relaunch.ts) which has
 * built-in CSRF protection. This HTTP route is kept only as a documented stub.
 *
 * If n8n or an external system needs to trigger a relaunch programmatically,
 * add proper token-based authentication here first (INTERNAL_API_SECRET header).
 * Do NOT re-open this route without authentication.
 */

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'Este endpoint está desactivado. Usa la acción de servidor del dashboard.',
      code: 'USE_SERVER_ACTION',
    },
    { status: 410 }
  )
}
