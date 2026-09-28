/**
 * POST /api/dossier/claim
 *
 * Reserva atómica de un envío de dossier al banco (anti-duplicados).
 * Los workflows n8n "Send Dossier *" la llaman justo antes de mandar el correo al banco
 * y solo envían si la respuesta es { allowed: true }.
 *
 * Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 *
 * Body: { bank_slug, opportunity_id, bank_deal_id?, workflow_id?, execution_id?, source?, force? }
 *
 * Clave: banco + Opportunity ID (el Bank Deal ID de la hoja puede venir vacío).
 * Reglas:
 *  - Primera reserva → permitido (UNIQUE(bank_slug, opportunity_id) resuelve la carrera).
 *  - Reserva previa de hace menos de 6 h → bloqueado (duplicado), salvo:
 *      · force = true (relanzamiento explícito), o
 *      · han pasado > 15 min y el deal bancario NO figura como enviado en Pipedrive
 *        (el intento anterior falló antes de enviar) → reintento permitido.
 *  - Reserva previa de hace más de 6 h → permitido (reenvío intencionado desde la hoja).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000
const RETRY_AFTER_MS = 15 * 60 * 1000
// Etapas previas al envío: pipeline 7 → 77 (Pre Bank Submission), pipeline 10 → 104 (Pre-Underwriting)
const PRE_SUBMISSION_STAGES = new Set([77, 104])

const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const str = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/** true si el deal bancario ya figura como enviado (o cerrado) en Pipedrive; null si no se pudo comprobar */
async function isSentInPipedrive(bankDealId: number | null): Promise<boolean | null> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token || !bankDealId) return null
  try {
    const res = await fetch(`https://api.pipedrive.com/v1/deals/${bankDealId}?api_token=${token}`, { cache: 'no-store' })
    if (!res.ok) return null
    const deal = (await res.json())?.data
    if (!deal) return null
    if (deal.status === 'won' || deal.status === 'lost') return true
    return !PRE_SUBMISSION_STAGES.has(Number(deal.stage_id))
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const secret = process.env.OFFERS_API_SECRET
  if (!secret || req.headers.get('x-offers-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const bankSlug = str(body.bank_slug, 64)
  const opportunityId = int(body.opportunity_id)
  if (!bankSlug || !opportunityId) {
    return NextResponse.json({ error: 'bank_slug y opportunity_id obligatorios' }, { status: 400 })
  }
  const force = body.force === true || body.force === 'true'
  const row = {
    bank_slug: bankSlug,
    opportunity_id: opportunityId,
    bank_deal_id: int(body.bank_deal_id),
    workflow_id: str(body.workflow_id, 64),
    execution_id: str(body.execution_id, 64),
    source: str(body.source, 64),
  }

  const supabase = await createAdminClient()

  // 1) Intento de reserva: el UNIQUE(bank_slug, opportunity_id) hace que solo una de dos llamadas simultáneas gane
  const { error: insertError } = await supabase.from('dossier_dispatches').insert(row)
  if (!insertError) return NextResponse.json({ allowed: true, reason: 'first_claim' })
  if (insertError.code !== '23505') {
    console.error('[dossier/claim insert]', insertError)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // 2) Ya existe una reserva para este deal + banco
  const { data: existing, error: selectError } = await supabase
    .from('dossier_dispatches')
    .select('id, claimed_at, attempts, blocked_count, bank_deal_id')
    .eq('bank_slug', bankSlug)
    .eq('opportunity_id', opportunityId)
    .single()
  if (selectError || !existing) {
    console.error('[dossier/claim select]', selectError)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const ageMs = Date.now() - Date.parse(existing.claimed_at as string)
  let reason: string | null = null
  if (force) reason = 'forced'
  else if (ageMs > DUPLICATE_WINDOW_MS) reason = 'new_dispatch_after_window'
  else if (ageMs > RETRY_AFTER_MS) {
    const bankDealId = row.bank_deal_id ?? (existing.bank_deal_id as number | null)
    if ((await isSentInPipedrive(bankDealId)) === false) reason = 'retry_after_failed_attempt'
  }

  if (reason) {
    // Reclamación condicionada al claimed_at leído: si otra llamada reclamó entre medias, esta pierde
    const { data: updated } = await supabase
      .from('dossier_dispatches')
      .update({
        ...row,
        bank_deal_id: row.bank_deal_id ?? existing.bank_deal_id,
        claimed_at: new Date().toISOString(),
        attempts: (existing.attempts as number) + 1,
        forced: force,
      })
      .eq('id', existing.id)
      .eq('claimed_at', existing.claimed_at)
      .select('id')
    if (updated && updated.length > 0) return NextResponse.json({ allowed: true, reason })
  }

  await supabase
    .from('dossier_dispatches')
    .update({
      blocked_count: (existing.blocked_count as number) + 1,
      last_blocked_at: new Date().toISOString(),
      last_blocked_execution_id: row.execution_id,
    })
    .eq('id', existing.id)

  return NextResponse.json({ allowed: false, reason: 'duplicate', claimed_at: existing.claimed_at })
}
