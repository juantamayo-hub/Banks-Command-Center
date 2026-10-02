/**
 * POST /api/alma/slack — enviar por Slack el mensaje que Alma preparó (lo confirma y edita la persona).
 *
 * Body: { conversation_id, destinatario: 'oscar'|'flor'|'silvia'|'juanjo'|'ceci', mensaje }
 * Solo a personas del equipo (lib/alma/team.ts). Se envía como DM con el bot de Alma, indicando quién lo manda.
 * Límite: 20 mensajes por persona y día. Queda registrado en alma_reports (evidence.tipo = 'slack_dm').
 */

import { createAdminClient } from '@/lib/supabase/server'
import { almaAuth } from '@/lib/alma/auth'
import { almaEnv } from '@/lib/alma/config'
import { findMember } from '@/lib/alma/team'
import { madridDayStart } from '@/lib/dossierSends'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const who = await almaAuth(req)
  if (!who.ok) return who.response

  let body: { conversation_id?: unknown; destinatario?: unknown; mensaje?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const member = findMember(String(body.destinatario ?? ''))
  const mensaje = String(body.mensaje ?? '').trim().slice(0, 2000)
  if (!member) return Response.json({ error: 'Solo puedo escribir a personas del equipo.' }, { status: 400 })
  if (!mensaje) return Response.json({ error: 'El mensaje está vacío.' }, { status: 400 })

  const supabase = await createAdminClient()
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : null
  if (conversationId) {
    const { data } = await supabase.from('alma_conversations').select('id').eq('id', conversationId).eq('user_email', who.email).maybeSingle()
    if (!data) return Response.json({ error: 'Conversación no encontrada' }, { status: 404 })
  }

  const { data: sentToday } = await supabase
    .from('alma_reports')
    .select('id, evidence')
    .eq('user_email', who.email)
    .gte('created_at', madridDayStart(0).toISOString())
  if ((sentToday ?? []).filter((r) => (r.evidence as { tipo?: string } | null)?.tipo === 'slack_dm').length >= 20) {
    return Response.json({ error: 'Has enviado muchos mensajes por Alma hoy; escríbele directamente por Slack.' }, { status: 429 })
  }

  const env = almaEnv()
  const text = `${env !== 'production' ? '[STAGING] ' : ''}💬 *Mensaje de ${who.email} vía Alma*${who.app === 'request_hub' ? ' (Request Hub)' : ''}\n${mensaje}`

  const reportUrl = process.env.ALMA_N8N_REPORT_URL || ''
  const url = process.env.ALMA_N8N_SLACK_DM_URL || reportUrl.replace('alma-reporte-juanjo', 'alma-slack-dm')
  const secret = process.env.OFFERS_API_SECRET
  if (!url || !secret) return Response.json({ error: 'El envío por Slack no está configurado.' }, { status: 503 })

  let sent = false
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-offers-secret': secret },
      body: JSON.stringify({ email: member.email, text }),
      signal: AbortSignal.timeout(20_000),
    })
    sent = res.ok
  } catch {
    sent = false
  }

  await supabase.from('alma_reports').insert({
    conversation_id: conversationId,
    user_email: who.email,
    summary: mensaje,
    evidence: { tipo: 'slack_dm', destinatario: member.clave, enviado: sent },
    slack_ts: sent ? 'sent' : null,
    env,
  })

  return sent
    ? Response.json({ ok: true, sent: true, destinatario: member.apodo })
    : Response.json({ error: `No he podido enviárselo a ${member.apodo} por Slack. Prueba a escribirle directamente.` }, { status: 502 })
}
