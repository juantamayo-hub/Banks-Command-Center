/**
 * POST /api/kutxabank/dismiss
 *
 * Soft-deletes a kutxabank_submission by setting dismissed_at = now().
 * Body: { submission_id: string }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  let body: { submission_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { submission_id } = body
  if (!submission_id || typeof submission_id !== 'string' || !UUID_RE.test(submission_id)) {
    return NextResponse.json({ error: 'submission_id inválido' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('kutxabank_submissions')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', submission_id)
    .is('dismissed_at', null)

  if (error) {
    console.error('[kutxabank/dismiss]', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
