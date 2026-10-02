/**
 * POST /api/alma/report — "Enviar reporte a Juanjo" (lo pulsa la persona, no Alma).
 *
 * Body: { conversation_id, comentario? }
 * Solo funciona si Alma marcó un problema técnico en esa conversación. Guarda el reporte en alma_reports
 * y lo envía por Slack a Juanjo a través del webhook de n8n (ALMA_N8N_REPORT_URL), que usa el bot de Alma.
 * Límites: 1 reporte por conversación cada hora y 10 por persona al día.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { almaAuth } from '@/lib/alma/auth'
import { almaEnv } from '@/lib/alma/config'
import { madridDayStart } from '@/lib/dossierSends'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const who = await almaAuth(req)
  if (!who.ok) return who.response

  let body: { conversation_id?: unknown; comentario?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : ''
  const comentario = String(body.comentario ?? '').trim().slice(0, 1000)

  const supabase = await createAdminClient()
  const { data: conv } = await supabase.from('alma_conversations').select('id').eq('id', conversationId).eq('user_email', who.email).maybeSingle()
  if (!conv) return Response.json({ error: 'Conversación no encontrada' }, { status: 404 })

  const { data: msgs } = await supabase
    .from('alma_messages')
    .select('role, content, tools_used, technical_issue, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  const flagged = [...(msgs ?? [])].reverse().find((m) => m.technical_issue)
  if (!flagged) return Response.json({ error: 'Alma no detectó un problema técnico en esta conversación.' }, { status: 400 })

  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const [{ count: recentConv }, { count: today }] = await Promise.all([
    supabase.from('alma_reports').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).gte('created_at', hourAgo),
    supabase.from('alma_reports').select('id', { count: 'exact', head: true }).eq('user_email', who.email).gte('created_at', madridDayStart(0).toISOString()),
  ])
  if ((recentConv ?? 0) > 0) return Response.json({ error: 'Este caso ya se reportó hace menos de una hora.' }, { status: 429 })
  if ((today ?? 0) >= 10) return Response.json({ error: 'Has enviado muchos reportes hoy; Juanjo ya los tiene.' }, { status: 429 })

  // Resumen técnico: lo que Alma marcó (entrada de marcar_problema_tecnico) + la conversación reciente
  const tools = (flagged.tools_used as Array<{ name: string; input: Record<string, unknown> }> | null) ?? []
  const mark = tools.find((t) => t.name === 'marcar_problema_tecnico')?.input ?? {}
  const resumen = String(mark.resumen ?? flagged.content).slice(0, 1500)
  const transcript = (msgs ?? []).slice(-6).map((m) => `${m.role === 'user' ? '🙋' : '🤖'} ${String(m.content).slice(0, 500)}`).join('\n')
  const env = almaEnv()
  const opportunityId = Number(mark.opportunity_id) || null
  const banco = (mark.banco as string) || null

  const { data: report, error } = await supabase
    .from('alma_reports')
    .insert({ conversation_id: conversationId, user_email: who.email, opportunity_id: opportunityId, bank_slug: banco, summary: resumen, evidence: { comentario, transcript }, env })
    .select('id')
    .single()
  if (error || !report) return Response.json({ error: 'No se pudo guardar el reporte' }, { status: 500 })

  const text = [
    `${env !== 'production' ? '[STAGING] ' : ''}🛠️ *Reporte técnico vía Alma* — de ${who.email}${who.app === 'request_hub' ? ' (Request Hub)' : ''}`,
    opportunityId ? `*Deal:* <https://mdsl.pipedrive.com/deal/${opportunityId}|${opportunityId}>${banco ? ` · *Banco:* ${banco}` : ''}` : banco ? `*Banco:* ${banco}` : '',
    `*Problema:* ${resumen}`,
    comentario ? `*Comentario:* ${comentario}` : '',
    `*Conversación:*\n${transcript}`,
  ].filter(Boolean).join('\n')

  const url = process.env.ALMA_N8N_REPORT_URL
  const secret = process.env.OFFERS_API_SECRET
  let sent = false
  if (url && secret) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-offers-secret': secret }, body: JSON.stringify({ text, report_id: report.id }), signal: AbortSignal.timeout(15_000) })
      sent = res.ok
    } catch {
      sent = false
    }
  }
  if (sent) await supabase.from('alma_reports').update({ slack_ts: 'sent' }).eq('id', report.id)
  return Response.json({ ok: true, sent, report_id: report.id })
}
