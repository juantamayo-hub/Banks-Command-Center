/**
 * GET  /api/kutxabank/submissions
 *   Returns all non-sent kutxabank_submissions ordered by created_at DESC.
 *
 * POST /api/kutxabank/submissions
 *   Called by n8n Workflow 1 (ZIP Creator) after uploading the ZIP to Drive.
 *   Creates or updates (upsert on deal_id) the Supabase record.
 *   Requires header: x-kutxabank-secret matching KUTXABANK_API_SECRET env var.
 *
 * PATCH /api/kutxabank/submissions
 *   Called by n8n Workflow 2 (Rastreator Sync) to update rastreator_status.
 *   Requires same secret header.
 *   Body: { deal_id, rastreator_status, rastreator_row? }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function validateSecret(req: Request): boolean {
  const secret = process.env.KUTXABANK_API_SECRET
  if (!secret) return false
  return req.headers.get('x-kutxabank-secret') === secret
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET() {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from('kutxabank_submissions')
    .select('*')
    .eq('rastreator_status', 'approved')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[kutxabank/submissions GET]', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
  return NextResponse.json({ submissions: data ?? [] })
}

// ── POST — create/upsert submission after ZIP creation ────────────────────────
export async function POST(req: Request) {
  if (!validateSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    deal_id, bank_deal_id, nombre_cliente, dni, plan,
    drive_folder_id, zip_file_id, zip_drive_link, missing_docs, rastreator_row,
  } = body as {
    deal_id: number
    bank_deal_id?: number | null
    nombre_cliente?: string
    dni?: string
    plan?: string
    drive_folder_id?: string
    zip_file_id?: string
    zip_drive_link?: string
    missing_docs?: string[]
    rastreator_row?: number
  }

  if (!deal_id || typeof deal_id !== 'number') {
    return NextResponse.json({ error: 'deal_id requerido' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from('kutxabank_submissions')
    .upsert(
      {
        deal_id,
        bank_deal_id: bank_deal_id ?? null,
        nombre_cliente: nombre_cliente ?? null,
        dni: dni ?? null,
        plan: plan ?? null,
        drive_folder_id: drive_folder_id ?? null,
        zip_file_id: zip_file_id ?? null,
        zip_drive_link: zip_drive_link ?? null,
        missing_docs: missing_docs ?? [],
        rastreator_row: rastreator_row ?? null,
        rastreator_status: 'pending',
      },
      { onConflict: 'deal_id' }
    )
    .select()
    .single()

  if (error) {
    console.error('[kutxabank/submissions POST]', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
  return NextResponse.json({ submission: data }, { status: 201 })
}

// ── PATCH — update rastreator_status (from Rastreator Sync) ──────────────────
export async function PATCH(req: Request) {
  if (!validateSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { deal_id, rastreator_status, rastreator_row } = body as {
    deal_id: number
    rastreator_status: 'pending' | 'approved' | 'rejected' | 'sent'
    rastreator_row?: number
  }

  if (!deal_id || typeof deal_id !== 'number') {
    return NextResponse.json({ error: 'deal_id requerido' }, { status: 400 })
  }
  if (!['pending', 'approved', 'rejected', 'sent'].includes(rastreator_status)) {
    return NextResponse.json({ error: 'rastreator_status inválido' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const update: Record<string, unknown> = { rastreator_status }
  if (rastreator_row != null) update.rastreator_row = rastreator_row

  const { error } = await supabase
    .from('kutxabank_submissions')
    .update(update)
    .eq('deal_id', deal_id)

  if (error) {
    console.error('[kutxabank/submissions PATCH]', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
