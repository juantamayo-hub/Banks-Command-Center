/**
 * Eventos de diagnóstico de los flujos (tabla flow_events, migración 025).
 * Los escriben n8n (POST /api/flow-events) y el propio Command Center (p. ej. bloqueos anti-duplicado).
 * Alma los usa para explicar por qué un envío no salió sin tener que adivinar.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const FLOW_EVENT_KINDS = [
  'gmail_error',
  'dossier_too_big',
  'dossier_generated',
  'compress_failed',
  'merge_failed',
  'upload_failed',
  'decrypt_failed',
  'missing_docs',
  'docs_snapshot',
  'antidup_blocked',
  'flow_error',
] as const
export type FlowEventKind = (typeof FLOW_EVENT_KINDS)[number]

export interface FlowEventInput {
  opportunity_id?: number | null
  bank_deal_id?: number | null
  bank_slug?: string | null
  workflow: string
  step?: string | null
  kind: FlowEventKind
  severity?: 'info' | 'warning' | 'error'
  message?: string | null
  detail?: Record<string, unknown>
  execution_id?: string | null
}

const KINDS = new Set<string>(FLOW_EVENT_KINDS)

const str = (v: unknown, max = 2000): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s && s !== 'null' && s !== 'undefined' ? s.slice(0, max) : null
}
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Valida y normaliza un evento recibido desde fuera (n8n). */
export function toFlowEventRow(input: Record<string, unknown>): { row?: FlowEventInput; error?: string } {
  const workflow = str(input.workflow, 64)
  const kind = str(input.kind, 32)
  if (!workflow) return { error: 'workflow obligatorio' }
  if (!kind || !KINDS.has(kind)) return { error: `kind inválido: ${kind}` }
  const severityRaw = str(input.severity, 16)
  const severity = severityRaw === 'warning' || severityRaw === 'error' ? severityRaw : 'info'
  const detail = input.detail && typeof input.detail === 'object' && !Array.isArray(input.detail)
    ? (input.detail as Record<string, unknown>)
    : {}
  return {
    row: {
      opportunity_id: int(input.opportunity_id),
      bank_deal_id: int(input.bank_deal_id),
      bank_slug: str(input.bank_slug, 64),
      workflow,
      step: str(input.step, 128),
      kind: kind as FlowEventKind,
      severity,
      message: str(input.message, 2000),
      detail,
      execution_id: str(input.execution_id, 64),
    },
  }
}

/** Inserta eventos; nunca lanza (el diagnóstico no debe romper el flujo que lo llama). */
export async function recordFlowEvents(supabase: SupabaseClient, events: FlowEventInput[]): Promise<number> {
  if (!events.length) return 0
  const { error } = await supabase.from('flow_events').insert(events)
  if (error) {
    console.error('[flow_events] insert error:', error.message)
    return 0
  }
  return events.length
}
