/**
 * POST /api/alma/chat — chat con Alma (streaming).
 *
 * Body: { message: string, conversation_id?: string }
 * Respuesta: text/event-stream con líneas `data: {json}`:
 *   { type: 'start', conversation_id }
 *   { type: 'tool', name }                 Alma está consultando datos
 *   { type: 'text', delta }                texto de la respuesta
 *   { type: 'technical', resumen }         problema técnico → mostrar "Enviar reporte a Juanjo"
 *   { type: 'done', message_id }
 *   { type: 'error', message }
 *
 * Solo lectura: las herramientas no modifican nada. Todo queda registrado en alma_messages.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/server'
import { almaAuth } from '@/lib/alma/auth'
import { ALMA_DAILY_MESSAGE_LIMIT, ALMA_MODEL, almaEnv } from '@/lib/alma/config'
import { ALMA_SYSTEM, almaContext } from '@/lib/alma/prompt'
import { ALMA_TOOLS, runAlmaTool } from '@/lib/alma/tools'
import { madridDayStart } from '@/lib/dossierSends'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_TOOL_ROUNDS = 6
const HISTORY_MESSAGES = 20

export async function POST(req: Request) {
  const who = await almaAuth(req)
  if (!who.ok) return who.response

  let body: { message?: unknown; conversation_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const message = String(body.message ?? '').trim().slice(0, 4000)
  if (!message) return Response.json({ error: 'Mensaje vacío' }, { status: 400 })

  const supabase = await createAdminClient()
  const env = almaEnv()

  // Conversación (propia del usuario) o nueva
  let conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : null
  if (conversationId) {
    const { data } = await supabase.from('alma_conversations').select('id').eq('id', conversationId).eq('user_email', who.email).maybeSingle()
    if (!data) conversationId = null
  }
  if (!conversationId) {
    const { data, error } = await supabase
      .from('alma_conversations')
      .insert({ user_email: who.email, app: who.app, env, title: message.slice(0, 80) })
      .select('id')
      .single()
    if (error || !data) return Response.json({ error: 'No se pudo iniciar la conversación' }, { status: 500 })
    conversationId = data.id as string
  }

  // Límite diario por usuario
  const { data: convs } = await supabase.from('alma_conversations').select('id').eq('user_email', who.email).gte('updated_at', madridDayStart(0).toISOString())
  const { count } = await supabase
    .from('alma_messages')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'user')
    .in('conversation_id', (convs ?? []).map((c) => c.id))
    .gte('created_at', madridDayStart(0).toISOString())
  if ((count ?? 0) >= ALMA_DAILY_MESSAGE_LIMIT) {
    return Response.json({ error: 'Has llegado al límite de mensajes de hoy con Alma. ¡Mañana más!' }, { status: 429 })
  }

  // Historial (solo texto: Alma vuelve a consultar los datos si los necesita, así siempre están frescos)
  const { data: history } = await supabase
    .from('alma_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_MESSAGES)
  const messages: Anthropic.MessageParam[] = (history ?? [])
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }))
  messages.push({ role: 'user', content: message })

  await supabase.from('alma_messages').insert({ conversation_id: conversationId, role: 'user', content: message })

  const encoder = new TextEncoder()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const convId = conversationId

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      send({ type: 'start', conversation_id: convId })

      let answer = ''
      let technical: { resumen: string } | null = null
      const toolsUsed: Array<{ name: string; input: unknown; ok: boolean }> = []
      let inTok = 0
      let outTok = 0

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const s = client.messages.stream({
            model: ALMA_MODEL,
            max_tokens: 8000,
            system: [
              { type: 'text', text: ALMA_SYSTEM, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: almaContext(who.email, who.app) },
            ],
            tools: ALMA_TOOLS,
            messages,
          })
          s.on('text', (delta) => {
            answer += delta
            send({ type: 'text', delta })
          })
          const msg = await s.finalMessage()
          inTok += msg.usage.input_tokens
          outTok += msg.usage.output_tokens

          if (msg.stop_reason === 'refusal') {
            const t = '\n\nUy, esta pregunta no la puedo responder. ¿La reformulas?'
            answer += t
            send({ type: 'text', delta: t })
            break
          }
          const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          if (!toolUses.length || msg.stop_reason === 'end_turn') break
          if (msg.stop_reason === 'max_tokens') break
          if (round === MAX_TOOL_ROUNDS) {
            const t = '\n\n(Me he liado consultando datos; ¿me lo preguntas de forma más concreta?)'
            answer += t
            send({ type: 'text', delta: t })
            break
          }

          messages.push({ role: 'assistant', content: msg.content })
          if (answer && !answer.endsWith('\n')) {
            answer += '\n\n'
            send({ type: 'text', delta: '\n\n' })
          }
          const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolUses.map(async (tu) => {
              send({ type: 'tool', name: tu.name })
              const input = (tu.input && typeof tu.input === 'object' ? tu.input : {}) as Record<string, unknown>
              const out = await runAlmaTool(tu.name, input)
              toolsUsed.push({ name: tu.name, input, ok: out.ok })
              if (out.technical) {
                technical = out.technical
                send({ type: 'technical', resumen: out.technical.resumen })
              }
              return { type: 'tool_result' as const, tool_use_id: tu.id, content: out.content, is_error: !out.ok }
            }),
          )
          messages.push({ role: 'user', content: results })
        }

        const { data: saved } = await supabase
          .from('alma_messages')
          .insert({
            conversation_id: convId,
            role: 'assistant',
            content: answer.trim() || '(sin respuesta)',
            tools_used: toolsUsed,
            technical_issue: !!technical,
            input_tokens: inTok,
            output_tokens: outTok,
          })
          .select('id')
          .single()
        await supabase.from('alma_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId)
        send({ type: 'done', message_id: saved?.id ?? null })
      } catch (e) {
        let msg = 'Algo ha fallado al hablar con Alma. Prueba otra vez en un momento.'
        if (e instanceof Anthropic.RateLimitError) msg = 'Alma está saturada ahora mismo. Prueba en un minuto.'
        else if (e instanceof Anthropic.APIError) console.error('[alma] API error', e.status, e.message)
        else console.error('[alma] error', e)
        send({ type: 'error', message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
