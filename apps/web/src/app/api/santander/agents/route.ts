/**
 * POST /api/santander/agents
 *
 * Alta / actualización de un gestor de Santander y reproceso de las asignaciones que esperaban su correo.
 * Lo llama el Request Hub cuando alguien completa el modal "Añadir correo del gestor" del aviso de Slack.
 * Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 *
 * Body: { name: string, email: string, added_by: string }
 */

import { NextResponse } from 'next/server'
import { hasOffersSecret } from '@/lib/auth/offersSecret'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidEmail } from '@/lib/bankConfig'
import { upsertAgentAndResolve } from '@/lib/santanderAgents'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  if (!hasOffersSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: { name?: unknown; email?: unknown; added_by?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON no válido' }, { status: 400 })
  }
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const actor = String(body.added_by ?? '').trim() || 'request-hub'
  if (!name) return NextResponse.json({ error: 'Falta name' }, { status: 400 })
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Correo no válido' }, { status: 400 })

  try {
    const db = await createAdminClient()
    const { agent, resolved } = await upsertAgentAndResolve(db, { name, email, actor: `${actor} (Slack)` })
    return NextResponse.json({
      agent: { name: agent.full_name, email: agent.email },
      resolved: resolved.length,
      assigned: resolved.filter((r) => r.status === 'assigned' || r.status === 'already_assigned').length,
      results: resolved,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 })
  }
}
