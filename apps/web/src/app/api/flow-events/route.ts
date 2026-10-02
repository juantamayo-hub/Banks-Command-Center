/**
 * POST /api/flow-events
 *
 * Registra eventos de diagnóstico de los flujos (n8n) en flow_events: peso del dossier, error de Gmail,
 * merge/compresión fallidos, documentos de la carpeta, etc. Alma los usa para explicar envíos.
 * Requiere cabecera x-offers-secret = OFFERS_API_SECRET (mismo secreto que /api/bank-responses).
 *
 * Body: un evento o { events: [...] } (máx. 100).
 *   { opportunity_id, bank_deal_id, bank_slug, workflow, step, kind, severity, message, detail, execution_id }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { recordFlowEvents, toFlowEventRow, type FlowEventInput } from '@/lib/flowEvents'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.OFFERS_API_SECRET
  if (!secret || req.headers.get('x-offers-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const asObj = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  const inputs = (Array.isArray(asObj?.events) ? (asObj!.events as unknown[]) : [body])
  if (inputs.length === 0 || inputs.length > 100) {
    return NextResponse.json({ error: 'Se esperan entre 1 y 100 eventos' }, { status: 400 })
  }

  const rows: FlowEventInput[] = []
  const errors: string[] = []
  inputs.forEach((input, i) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return errors.push(`[${i}] no es un objeto`)
    const { row, error } = toFlowEventRow(input as Record<string, unknown>)
    if (error) errors.push(`[${i}] ${error}`)
    else rows.push(row!)
  })
  if (!rows.length) return NextResponse.json({ saved: 0, errors }, { status: 400 })

  const supabase = await createAdminClient()
  const saved = await recordFlowEvents(supabase, rows)
  return NextResponse.json({ saved, errors }, { status: saved ? 200 : 500 })
}
