/**
 * POST /api/alma/feedback — 👍/👎 sobre una respuesta de Alma.
 *
 * Body: { message_id, rating: 'up'|'down', comment? }  (con 'down' el comentario es obligatorio)
 * Solo sobre respuestas de conversaciones de la propia persona. Se puede cambiar de opinión (sobrescribe).
 * El feedback se revisa con scripts/alma-feedback.ts y lo útil se convierte en alma_lessons.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { almaAuth } from '@/lib/alma/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const who = await almaAuth(req)
  if (!who.ok) return who.response

  let body: { message_id?: unknown; rating?: unknown; comment?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const messageId = typeof body.message_id === 'string' ? body.message_id : ''
  const rating = body.rating === 'up' || body.rating === 'down' ? body.rating : null
  const comment = String(body.comment ?? '').trim().slice(0, 1000)
  if (!messageId || !rating) return Response.json({ error: 'Faltan datos' }, { status: 400 })
  if (rating === 'down' && !comment) return Response.json({ error: 'Cuéntame qué falló para poder mejorar.' }, { status: 400 })

  const supabase = await createAdminClient()
  const { data: msg } = await supabase
    .from('alma_messages')
    .select('id, role, alma_conversations!inner(user_email)')
    .eq('id', messageId)
    .eq('role', 'assistant')
    .eq('alma_conversations.user_email', who.email)
    .maybeSingle()
  if (!msg) return Response.json({ error: 'Respuesta no encontrada' }, { status: 404 })

  const { error } = await supabase
    .from('alma_messages')
    .update({ feedback_rating: rating, feedback_comment: comment || null, feedback_at: new Date().toISOString(), feedback_by: who.email })
    .eq('id', messageId)
  if (error) return Response.json({ error: 'No se ha podido guardar' }, { status: 500 })
  return Response.json({ ok: true })
}
