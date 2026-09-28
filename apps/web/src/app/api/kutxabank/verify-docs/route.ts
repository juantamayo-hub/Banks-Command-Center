/**
 * POST /api/kutxabank/verify-docs
 *
 * Botón "Verificar documentos" de la tarjeta Kutxabank (Envíos por plataforma).
 * Relanza el ZIP Creator de n8n en modo verificación para ese deal:
 *   - vuelve a buscar los documentos en Drive y recalcula missing_docs
 *   - si aparece algún documento que antes faltaba → regenera el ZIP
 *   - actualiza kutxabank_submissions (sin tocar rastreator_status)
 * El resultado llega de forma asíncrona (n8n llama a /api/kutxabank/submissions).
 *
 * Body: { submission_id: uuid }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_WEBHOOK = 'https://huspy.app.n8n.cloud/webhook/kutxabank-verificar-docs'

export async function POST(req: Request) {
  let body: { submission_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.submission_id || !UUID_RE.test(body.submission_id)) {
    return NextResponse.json({ error: 'submission_id inválido' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data: sub, error } = await supabase
    .from('kutxabank_submissions')
    .select('id, deal_id, missing_docs, rastreator_status')
    .eq('id', body.submission_id)
    .maybeSingle()

  if (error || !sub) return NextResponse.json({ error: 'Envío no encontrado' }, { status: 404 })
  if (sub.rastreator_status === 'sent') {
    return NextResponse.json({ error: 'Ya enviado a Kutxabank: no se regenera el ZIP' }, { status: 409 })
  }

  const secret = process.env.KUTXABANK_API_SECRET
  if (!secret) return NextResponse.json({ error: 'KUTXABANK_API_SECRET no configurado' }, { status: 500 })

  try {
    const res = await fetch(process.env.KUTXABANK_N8N_VERIFY_WEBHOOK_URL || DEFAULT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kutxabank-secret': secret },
      body: JSON.stringify({ dealId: sub.deal_id, previousMissing: sub.missing_docs ?? [] }),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `n8n respondió ${res.status}` }, { status: 502 })
    }
  } catch {
    return NextResponse.json({ error: 'No se pudo contactar con n8n' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
