'use client'

/**
 * Burbuja flotante + panel de chat con Alma.
 * Autocontenido (sin dependencias) para poder copiarlo a Request Hub; solo cambia `apiBase`.
 * Habla con `${apiBase}/chat` (streaming SSE) y `${apiBase}/report`.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const ALMA_AVATAR = 'https://avatars.slack-edge.com/2026-09-24/12138584226886_93ebfcd0afee7bfc313e_72.png'
const STORAGE_KEY = 'alma-chat-v1'

const TOOL_LABELS: Record<string, string> = {
  buscar_cliente: 'Buscando al cliente…',
  ficha_cliente: 'Revisando su ficha…',
  explicar_envio: 'Revisando el envío, la hoja y Drive…',
  documentos_cliente: 'Mirando su carpeta de Drive…',
  tickets_cliente: 'Consultando Request Hub…',
  metricas: 'Calculando cifras…',
  conocimiento: 'Repasando cómo funciona el proceso…',
  marcar_problema_tecnico: 'Preparando el reporte técnico…',
  envios_pendientes: 'Revisando la cola de envíos del equipo…',
  ofertas_pendientes: 'Revisando las ofertas por revisar…',
  equipo: 'Mirando quién lleva qué…',
  preparar_mensaje_slack: 'Preparando el mensaje de Slack…',
}

const SUGGESTIONS = [
  '¿Por qué no ha salido el envío de…?',
  '¿Qué documentos tiene…?',
  '¿Qué tickets abiertos tiene…?',
  '¿Qué envíos tenemos bloqueados?',
  '¿Cuántos dossieres enviamos ayer?',
]

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  status?: string | null
  technical?: string | null
  report?: 'idle' | 'sending' | 'sent' | 'error'
  reportMsg?: string
  error?: boolean
  slack?: { destinatario: string; nombre: string; mensaje: string; state: 'draft' | 'sending' | 'sent' | 'error'; info?: string }
}

// ── Formato mínimo y seguro: **negrita**, [texto](url), viñetas y saltos de línea ─────────────
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={`${keyBase}-b${i++}`}>{m[1]}</strong>)
    else {
      const href = m[3] ?? m[4]
      out.push(
        <a key={`${keyBase}-a${i++}`} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-bayteca-green underline underline-offset-2 hover:opacity-80">
          {m[2] ?? 'enlace'}
        </a>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function RichText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const bullet = line.match(/^\s*[-•*]\s+(.*)$/)
        if (bullet) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-bayteca-green">•</span>
              <span>{renderInline(bullet[1], `l${i}`)}</span>
            </div>
          )
        }
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i}>{renderInline(line, `l${i}`)}</p>
      })}
    </div>
  )
}

function loadSaved(): { conversationId: string | null; messages: ChatMessage[] } {
  if (typeof window === 'undefined') return { conversationId: null, messages: [] }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { conversationId: null, messages: [] }
    const parsed = JSON.parse(raw) as { conversationId: string | null; messages: ChatMessage[] }
    return { conversationId: parsed.conversationId ?? null, messages: (parsed.messages ?? []).map((m) => ({ ...m, status: null })) }
  } catch {
    return { conversationId: null, messages: [] }
  }
}

export default function AlmaChat({ apiBase = '/api/alma', envLabel }: { apiBase?: string; envLabel?: string }) {
  const [open, setOpen] = useState(false)
  // La conversación de esta pestaña se restaura al iniciar (el panel empieza cerrado, así que no afecta al primer render)
  const [saved] = useState(loadSaved)
  const [messages, setMessages] = useState<ChatMessage[]>(saved.messages)
  const [conversationId, setConversationId] = useState<string | null>(saved.conversationId)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ conversationId, messages: messages.slice(-40) }))
    } catch {
      /* ignorar */
    }
  }, [conversationId, messages])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const patch = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)))
  }, [])

  const send = useCallback(async (textArg?: string) => {
    const text = (textArg ?? input).trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text }
    const botId = crypto.randomUUID()
    setMessages((prev) => [...prev, userMsg, { id: botId, role: 'assistant', text: '', status: 'Pensando…' }])

    try {
      const res = await fetch(`${apiBase}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: conversationId }),
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        patch(botId, (m) => ({ ...m, text: err.error || 'Ahora mismo no puedo responder. Prueba en un momento.', status: null, error: true }))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.replace(/^data:\s?/, '')
          if (!line) continue
          let ev: { type: string; [k: string]: unknown }
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.type === 'start') setConversationId(ev.conversation_id as string)
          else if (ev.type === 'text') patch(botId, (m) => ({ ...m, text: m.text + (ev.delta as string), status: null }))
          else if (ev.type === 'tool') patch(botId, (m) => ({ ...m, status: TOOL_LABELS[ev.name as string] ?? 'Consultando datos…' }))
          else if (ev.type === 'technical') patch(botId, (m) => ({ ...m, technical: ev.resumen as string, report: 'idle' }))
          else if (ev.type === 'slack_draft') patch(botId, (m) => ({ ...m, slack: { destinatario: ev.destinatario as string, nombre: ev.nombre as string, mensaje: ev.mensaje as string, state: 'draft' } }))
          else if (ev.type === 'error') patch(botId, (m) => ({ ...m, text: m.text || (ev.message as string), status: null, error: true }))
          else if (ev.type === 'done') patch(botId, (m) => ({ ...m, status: null }))
        }
      }
    } catch {
      patch(botId, (m) => ({ ...m, text: m.text || 'Se ha cortado la conexión. ¿Lo intentas otra vez?', status: null, error: true }))
    } finally {
      patch(botId, (m) => ({ ...m, status: null }))
      setBusy(false)
    }
  }, [apiBase, busy, conversationId, input, patch])

  const report = useCallback(async (id: string) => {
    if (!conversationId) return
    patch(id, (m) => ({ ...m, report: 'sending' }))
    try {
      const res = await fetch(`${apiBase}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.sent) patch(id, (m) => ({ ...m, report: 'sent', reportMsg: '¡Enviado! Juanjo ya lo tiene en Slack.' }))
      else if (res.ok) patch(id, (m) => ({ ...m, report: 'sent', reportMsg: 'Guardado. Juanjo lo verá aunque Slack no respondió.' }))
      else patch(id, (m) => ({ ...m, report: 'error', reportMsg: data.error || 'No se pudo enviar el reporte.' }))
    } catch {
      patch(id, (m) => ({ ...m, report: 'error', reportMsg: 'No se pudo enviar el reporte.' }))
    }
  }, [apiBase, conversationId, patch])

  const sendSlack = useCallback(async (id: string, slack: NonNullable<ChatMessage['slack']>) => {
    patch(id, (m) => ({ ...m, slack: { ...slack, state: 'sending' } }))
    try {
      const res = await fetch(`${apiBase}/slack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, destinatario: slack.destinatario, mensaje: slack.mensaje }),
      })
      const data = await res.json().catch(() => ({}))
      patch(id, (m) => ({ ...m, slack: { ...slack, state: res.ok ? 'sent' : 'error', info: res.ok ? `¡Enviado a ${slack.nombre} por Slack!` : data.error || 'No se pudo enviar.' } }))
    } catch {
      patch(id, (m) => ({ ...m, slack: { ...slack, state: 'error', info: 'No se pudo enviar.' } }))
    }
  }, [apiBase, conversationId, patch])

  const reset = () => {
    setMessages([])
    setConversationId(null)
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignorar */
    }
  }

  return (
    <>
      {/* Burbuja */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Cerrar chat con Alma' : 'Abrir chat con Alma'}
        className="group fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-bayteca-green shadow-xl shadow-black/25 ring-4 ring-white transition-transform hover:scale-105 focus:outline-none focus-visible:ring-bayteca-green/40"
      >
        {open ? (
          <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ALMA_AVATAR} alt="Alma" className="h-12 w-12 rounded-full" />
        )}
        {!open && (
          <span className="pointer-events-none absolute right-16 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100">
            Pregúntale a Alma
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-[60] flex h-[min(600px,calc(100vh-8rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/25 ring-1 ring-black/5">
          <div className="flex items-center gap-3 bg-bayteca-green px-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ALMA_AVATAR} alt="" className="h-9 w-9 rounded-full ring-2 ring-white/40" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">
                Alma {envLabel && <span className="ml-1 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-950">{envLabel}</span>}
              </p>
              <p className="truncate text-[11px] text-white/70">Te cuento qué pasa con tus clientes y envíos</p>
            </div>
            <button type="button" onClick={reset} className="rounded-md px-2 py-1 text-[11px] font-medium text-white/80 hover:bg-white/10 hover:text-white" title="Nueva conversación">
              Nueva
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 px-3 py-4">
            {messages.length === 0 && (
              <div className="space-y-3 px-1">
                <div className="rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-gray-800 shadow-sm ring-1 ring-black/5">
                  ¡Hola! Soy Alma 👋 Pregúntame por un cliente (nombre, nº de deal o DNI): por qué no ha salido un envío, qué
                  documentos tiene, sus tickets… Yo miro la hoja, Pipedrive, Drive y Request Hub por ti. Lo que no puedo es
                  cambiar nada (soy de mirar, no de tocar 😇).
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setInput(s.endsWith('…?') ? s.replace('…?', ' ') : s)
                        inputRef.current?.focus()
                      }}
                      className="rounded-full bg-white px-3 py-1.5 text-[12px] text-gray-700 shadow-sm ring-1 ring-black/10 hover:bg-bayteca-green hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-bayteca-green px-3.5 py-2 text-[13px] text-white shadow-sm">{m.text}</div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ALMA_AVATAR} alt="" className="mt-0.5 h-6 w-6 shrink-0 rounded-full" />
                  <div className="min-w-0 max-w-[88%] space-y-2">
                    {(m.text || m.status) && (
                      <div className={`rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ring-1 ${m.error ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-white text-gray-800 ring-black/5'}`}>
                        {m.text && <RichText text={m.text} />}
                        {m.status && (
                          <p className="flex items-center gap-2 text-[12px] italic text-gray-500">
                            <span className="inline-flex gap-0.5">
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-bayteca-green [animation-delay:-0.3s]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-bayteca-green [animation-delay:-0.15s]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-bayteca-green" />
                            </span>
                            {m.status}
                          </p>
                        )}
                      </div>
                    )}
                    {m.slack && (
                      <div className="rounded-xl bg-sky-50 px-3 py-2 text-[12px] text-sky-950 ring-1 ring-sky-200">
                        <p className="font-medium">💬 Mensaje para {m.slack.nombre} por Slack</p>
                        {m.slack.state === 'sent' ? (
                          <p className="mt-1">{m.slack.info}</p>
                        ) : (
                          <>
                            <textarea
                              value={m.slack.mensaje}
                              onChange={(e) => {
                                const value = e.target.value
                                patch(m.id, (x) => (x.slack ? { ...x, slack: { ...x.slack, mensaje: value } } : x))
                              }}
                              rows={4}
                              className="mt-1.5 w-full resize-y rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-[12px] text-gray-800 focus:border-sky-400 focus:outline-none"
                            />
                            {m.slack.state === 'error' && <p className="mt-1 text-red-700">{m.slack.info}</p>}
                            <button
                              type="button"
                              disabled={m.slack.state === 'sending' || !m.slack.mensaje.trim()}
                              onClick={() => m.slack && sendSlack(m.id, m.slack)}
                              className="mt-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                            >
                              {m.slack.state === 'sending' ? 'Enviando…' : `Enviar a ${m.slack.nombre}`}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {m.technical && (
                      <div className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">
                        <p className="font-medium">Parece un problema técnico 🛠️</p>
                        {m.report === 'sent' || m.report === 'error' ? (
                          <p className="mt-1">{m.reportMsg}</p>
                        ) : (
                          <button
                            type="button"
                            disabled={m.report === 'sending'}
                            onClick={() => report(m.id)}
                            className="mt-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                          >
                            {m.report === 'sending' ? 'Enviando…' : 'Enviar reporte a Juanjo'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
            className="flex items-end gap-2 border-t border-gray-100 bg-white px-3 py-2.5"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Escribe tu pregunta…"
              className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-bayteca-green focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-bayteca-green text-white disabled:opacity-40"
              aria-label="Enviar"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  )
}
