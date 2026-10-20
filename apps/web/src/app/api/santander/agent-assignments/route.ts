/**
 * POST /api/santander/agent-assignments
 *
 * Lo llama el flujo n8n "Santander · Gestores asignados" con las filas del Excel que Santander devuelve
 * (respuesta al informe diario de activaciones). Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 *
 * Body: { message_id?: string, file_name?: string, dryRun?: boolean,
 *         rows: [{ client_name?, dni, agent_name }] }
 * dryRun=true no escribe nada (ni Pipedrive, ni Request Hub, ni Supabase): devuelve lo que haría.
 * Lógica en lib/santanderAgents.ts.
 */

import { NextResponse } from 'next/server'
import { hasOffersSecret } from '@/lib/auth/offersSecret'
import { createAdminClient } from '@/lib/supabase/server'
import { loadAgents, processAssignment, type AssignmentResult, type AssignmentRow } from '@/lib/santanderAgents'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_ROWS = 200

export async function POST(req: Request) {
  if (!hasOffersSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: { message_id?: unknown; file_name?: unknown; dryRun?: unknown; rows?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON no válido' }, { status: 400 })
  }
  if (!Array.isArray(body.rows) || body.rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `rows debe ser un array de como mucho ${MAX_ROWS} filas` }, { status: 400 })
  }
  const rows = (body.rows as Record<string, unknown>[]).map((r) => ({
    client_name: r.client_name ? String(r.client_name) : null,
    dni: String(r.dni ?? ''),
    agent_name: String(r.agent_name ?? ''),
  })) satisfies AssignmentRow[]

  const db = await createAdminClient()
  let agents
  try {
    agents = await loadAgents(db)
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 })
  }

  const opts = {
    dryRun: body.dryRun === true,
    messageId: typeof body.message_id === 'string' ? body.message_id : null,
    fileName: typeof body.file_name === 'string' ? body.file_name : null,
  }
  const results: AssignmentResult[] = []
  for (const row of rows) results.push(await processAssignment(db, agents, row, opts))

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
  return NextResponse.json({ dryRun: opts.dryRun, total: rows.length, summary, results })
}
