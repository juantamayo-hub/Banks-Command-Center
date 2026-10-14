/**
 * POST /api/lender-submissions — registro de envíos a entidades de préstamo (Cofidis…), lo llama n8n.
 *
 * En una sola llamada:
 *   1. UPSERT en lender_submissions (estado actual; 1 fila por lender + deal_id).
 *   2. INSERT en lender_submission_events (historial del intento).
 *
 * Un caso ya 'sent' no vuelve a 'pending_docs'/'error' (el evento se guarda igual): evita que el
 * Command Center lo muestre como pendiente y se envíe dos veces.
 *
 * Requiere cabecera x-offers-secret = OFFERS_API_SECRET (la misma que usan los flujos de ofertas).
 *
 * Body: { lender, source, product, deal_id, status, missing_docs?, bank_deal_id?, client_name?, dni?,
 *         holders?, owner_email?, sent_at?, sent_to?, gmail_message_id?, drive_folder_id?,
 *         error_message?, detail?, workflow_id?, execution_id? }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const SOURCES = ['loans_pipeline', 'no_bank_fee'] as const
const PRODUCTS = ['personal_loan', 'debt_consolidation'] as const
const STATUSES = ['pending_docs', 'sent', 'error'] as const

const str = (v: unknown, max = 300): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  return s ? s.slice(0, max) : null
}
const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}

export async function POST(req: Request) {
  const secret = process.env.OFFERS_API_SECRET
  if (!secret || req.headers.get('x-offers-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let b: Record<string, unknown>
  try {
    const raw = await req.json()
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error()
    b = raw as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const lender = str(b.lender, 40)?.toLowerCase() ?? ''
  const source = SOURCES.find((s) => s === b.source)
  const product = PRODUCTS.find((p) => p === b.product)
  const status = STATUSES.find((s) => s === b.status)
  const dealId = posInt(b.deal_id)
  const holders = b.holders === undefined || b.holders === null ? null : posInt(b.holders)

  const errors = [
    !/^[a-z_]{2,40}$/.test(lender) && '`lender` (p. ej. "cofidis")',
    !source && `\`source\` (${SOURCES.join(' | ')})`,
    !product && `\`product\` (${PRODUCTS.join(' | ')})`,
    !dealId && '`deal_id` (entero positivo)',
    !status && `\`status\` (${STATUSES.join(' | ')})`,
    holders !== null && holders !== 1 && holders !== 2 && '`holders` (1 o 2)',
    b.missing_docs !== undefined && !Array.isArray(b.missing_docs) && '`missing_docs` (lista de textos)',
  ].filter(Boolean)
  if (errors.length) return NextResponse.json({ error: `Campos inválidos: ${errors.join(', ')}` }, { status: 400 })

  const missingDocs = ((b.missing_docs as unknown[] | undefined) ?? [])
    .map((d) => str(d, 120))
    .filter((d): d is string => !!d)
    .slice(0, 30)
  const sentAt = str(b.sent_at, 40)
  if (sentAt && Number.isNaN(Date.parse(sentAt))) {
    return NextResponse.json({ error: 'Campos inválidos: `sent_at` (fecha ISO)' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data: prev, error: prevError } = await supabase
    .from('lender_submissions')
    .select('id, status, attempts')
    .eq('lender', lender)
    .eq('deal_id', dealId)
    .maybeSingle()
  if (prevError) return NextResponse.json({ error: prevError.message }, { status: 500 })

  // Un caso enviado (o descartado a mano) no se reabre por un aviso posterior; solo un nuevo 'sent' lo actualiza
  const keepStatus = prev && (prev.status === 'sent' || prev.status === 'dismissed') && status !== 'sent'
  const finalStatus = keepStatus ? prev.status : status!

  const row: Record<string, unknown> = {
    lender,
    source,
    product,
    deal_id: dealId,
    status: finalStatus,
    attempts: (prev?.attempts ?? 0) + 1,
    workflow_id: str(b.workflow_id, 60),
    execution_id: str(b.execution_id, 60),
  }
  if (!keepStatus) {
    row.missing_docs = status === 'sent' ? [] : missingDocs
    row.error_message = status === 'error' ? str(b.error_message, 1000) : null
    if (status === 'sent') {
      row.sent_at = sentAt ?? new Date().toISOString()
      row.sent_to = str(b.sent_to, 200)
      row.gmail_message_id = str(b.gmail_message_id, 200)
    }
  }
  // Datos del caso: solo se escriben si vienen (no se borran con nulos)
  for (const [key, value] of Object.entries({
    bank_deal_id: posInt(b.bank_deal_id),
    client_name: str(b.client_name, 200),
    dni: str(b.dni, 20),
    holders,
    owner_email: str(b.owner_email, 200)?.toLowerCase() ?? null,
    drive_folder_id: str(b.drive_folder_id, 200),
  })) {
    if (value !== null) row[key] = value
  }

  const { data: saved, error: upsertError } = await supabase
    .from('lender_submissions')
    .upsert(row, { onConflict: 'lender,deal_id' })
    .select('id, status, attempts')
    .single()
  if (upsertError || !saved) return NextResponse.json({ error: upsertError?.message ?? 'No guardado' }, { status: 500 })

  const { error: eventError } = await supabase.from('lender_submission_events').insert({
    submission_id: saved.id,
    lender,
    source,
    deal_id: dealId,
    status: status!,
    missing_docs: status === 'sent' ? [] : missingDocs,
    detail: str(b.detail, 1000) ?? (status === 'error' ? str(b.error_message, 1000) : null),
    workflow_id: row.workflow_id,
    execution_id: row.execution_id,
  })
  if (eventError) console.error('[lender-submissions] evento no guardado:', eventError.message)

  return NextResponse.json({
    ok: true,
    id: saved.id,
    status: saved.status,
    attempts: saved.attempts,
    ...(keepStatus ? { note: `El caso ya estaba '${prev!.status}'; se registra el intento pero no se cambia el estado` } : {}),
  })
}
