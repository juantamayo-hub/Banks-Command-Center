/**
 * Revisión del feedback de Alma (👍/👎) para convertir lo útil en lecciones (tabla alma_lessons).
 * Uso: cd apps/web && npx tsx --env-file=.env.local scripts/alma-feedback.ts [días=7]
 *
 * Muestra cada 👎 con la pregunta, la respuesta, las herramientas usadas y el comentario.
 * Las lecciones se añaden a mano (SQL editor) tras revisarlas — nunca se copian comentarios tal cual:
 *   insert into alma_lessons (texto, origen_message_id, created_by) values ('…', '<id>', 'juan.tamayo@huspy.io');
 */

import { createClient } from '@supabase/supabase-js'

async function main() {
  const dias = Number(process.argv[2] ?? 7)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const since = new Date(Date.now() - dias * 86400_000).toISOString()
  const { data, error } = await sb
    .from('alma_messages')
    .select('id, conversation_id, content, tools_used, feedback_rating, feedback_comment, feedback_at, feedback_by, created_at, alma_conversations(env, app)')
    .not('feedback_rating', 'is', null)
    .gte('feedback_at', since)
    .order('feedback_at', { ascending: false })
  if (error) throw error
  const rows = data ?? []
  const up = rows.filter((r) => r.feedback_rating === 'up').length
  console.log(`Últimos ${dias} días: 👍 ${up} · 👎 ${rows.length - up}\n`)
  for (const r of rows.filter((x) => x.feedback_rating === 'down')) {
    const { data: prev } = await sb
      .from('alma_messages')
      .select('content')
      .eq('conversation_id', r.conversation_id)
      .eq('role', 'user')
      .lt('created_at', r.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
    const tools = ((r.tools_used as Array<{ name: string }>) ?? []).map((t) => t.name).join(', ') || '—'
    console.log('━'.repeat(70))
    console.log(`👎 ${r.feedback_at} · ${r.feedback_by} · ${JSON.stringify(r.alma_conversations)} · id ${r.id}`)
    console.log(`Pregunta: ${prev?.[0]?.content ?? '?'}`)
    console.log(`Herramientas: ${tools}`)
    console.log(`Respuesta: ${String(r.content).slice(0, 800)}`)
    console.log(`Comentario: ${r.feedback_comment}\n`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
