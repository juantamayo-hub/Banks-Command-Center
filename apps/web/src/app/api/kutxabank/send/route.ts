/**
 * POST /api/kutxabank/send
 *
 * Called by the Command Center "Enviar" button.
 * 1. Validates that rastreator_status = 'approved'
 * 2. Calls n8n Workflow 3 (Email Sender) webhook
 * 3. Optimistically marks the submission as 'sent' in Supabase
 *
 * Body: { submission_id: string }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  let body: { submission_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { submission_id } = body
  if (!submission_id || typeof submission_id !== 'string') {
    return NextResponse.json({ error: 'submission_id requerido' }, { status: 400 })
  }

  // UUID validation
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submission_id)) {
    return NextResponse.json({ error: 'submission_id inválido' }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Fetch submission
  const { data: sub, error: fetchErr } = await supabase
    .from('kutxabank_submissions')
    .select('*')
    .eq('id', submission_id)
    .single()

  if (fetchErr || !sub) {
    return NextResponse.json({ error: 'Submission no encontrada' }, { status: 404 })
  }

  if (sub.rastreator_status !== 'approved') {
    return NextResponse.json(
      { error: `No se puede enviar: estado actual = ${sub.rastreator_status}` },
      { status: 409 }
    )
  }

  // Call n8n Email Sender webhook
  const n8nWebhookUrl = process.env.KUTXABANK_N8N_EMAIL_WEBHOOK_URL
  if (!n8nWebhookUrl) {
    return NextResponse.json({ error: 'KUTXABANK_N8N_EMAIL_WEBHOOK_URL no configurado' }, { status: 500 })
  }

  try {
    const n8nRes = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submission_id: sub.id,
        deal_id: sub.deal_id,
        bank_deal_id: sub.bank_deal_id,
        nombre_cliente: sub.nombre_cliente,
        dni: sub.dni,
        plan: sub.plan,
        zip_file_id: sub.zip_file_id,
        zip_drive_link: sub.zip_drive_link,
      }),
    })

    if (!n8nRes.ok) {
      const text = await n8nRes.text().catch(() => '')
      console.error('[kutxabank/send] n8n error:', n8nRes.status, text)
      return NextResponse.json(
        { error: `n8n devolvió ${n8nRes.status}` },
        { status: 502 }
      )
    }
  } catch (err) {
    console.error('[kutxabank/send] n8n network error:', err)
    return NextResponse.json({ error: 'Error de red con n8n' }, { status: 502 })
  }

  // Optimistically mark as sent
  const { error: updateErr } = await supabase
    .from('kutxabank_submissions')
    .update({ rastreator_status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', submission_id)

  if (updateErr) {
    console.error('[kutxabank/send] Supabase update error:', updateErr)
    // Non-fatal: n8n already sent the email
  }

  return NextResponse.json({ ok: true })
}
