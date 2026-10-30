/**
 * POST /api/alma/dossier — regenerar el dossier completo de un cliente (lo pulsa la persona en el botón que
 * propone Alma con la herramienta regenerar_dossier).
 *
 * Body: { conversation_id?, deal_id, motivo? }
 * Llama a n8n (ALMA_N8N_DOSSIER_REGEN_URL, cabecera x-alma-secret = ALMA_N8N_SECRET) con
 * { deal_id, requested_by: <email de la sesión>, origin: 'bcc' }. Respuesta: { accepted, reason }.
 * Límite: 10 regeneraciones por persona y día. Queda registrado en alma_reports (evidence.tipo = 'dossier_regen').
 */

import { createAdminClient } from '@/lib/supabase/server'
import { almaAuth } from '@/lib/alma/auth'
import { almaEnv } from '@/lib/alma/config'
import { requestDossierRegen } from '@/lib/alma/dossier'
import { madridDayStart } from '@/lib/dossierSends'

export const dynamic = 'force-dynamic'

const DAILY_LIMIT = 10

export async function POST(req: Request) {
  const who = await almaAuth(req)
  if (!who.ok) return who.response

  let body: { conversation_id?: unknown; deal_id?: unknown; motivo?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const dealId = typeof body.deal_id === 'number' ? body.deal_id : parseInt(String(body.deal_id ?? ''), 10)
  if (!Number.isInteger(dealId) || dealId <= 0) return Response.json({ error: 'deal_id no válido' }, { status: 400 })
  const motivo = String(body.motivo ?? '').trim().slice(0, 500)

  const supabase = await createAdminClient()
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : null
  if (conversationId) {
    const { data } = await supabase.from('alma_conversations').select('id').eq('id', conversationId).eq('user_email', who.email).maybeSingle()
    if (!data) return Response.json({ error: 'Conversación no encontrada' }, { status: 404 })
  }

  const { data: today } = await supabase
    .from('alma_reports')
    .select('id, evidence')
    .eq('user_email', who.email)
    .gte('created_at', madridDayStart(0).toISOString())
  if ((today ?? []).filter((r) => (r.evidence as { tipo?: string } | null)?.tipo === 'dossier_regen').length >= DAILY_LIMIT) {
    return Response.json({ accepted: false, reason: 'daily_limit', error: 'Has llegado al límite de regeneraciones de hoy. Pídeselo a Juanjo.' }, { status: 429 })
  }

  const result = await requestDossierRegen(dealId, who.email)

  await supabase.from('alma_reports').insert({
    conversation_id: conversationId,
    user_email: who.email,
    opportunity_id: dealId,
    summary: motivo || `Regenerar dossier del deal ${dealId}`,
    evidence: { tipo: 'dossier_regen', deal_id: dealId, accepted: result.accepted, reason: result.reason, app: who.app },
    env: almaEnv(),
  })

  // accepted:false con un motivo de n8n (p. ej. ya en curso) es una respuesta válida → 200
  const status = result.reason === 'not_configured' ? 503 : result.reason === 'unreachable' || result.reason.startsWith('http_') ? 502 : 200
  return Response.json(result, { status })
}
