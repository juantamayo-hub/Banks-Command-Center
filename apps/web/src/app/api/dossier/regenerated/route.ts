/**
 * POST /api/dossier/regenerated
 *
 * n8n avisa de que ha regenerado el dossier completo de un cliente (flujo "regenerar dossier", lanzado desde
 * Alma en el Command Center o desde Slack). Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 *
 * Body: { deal_id, drive_url, file_name, included: string[], excluded: [{ doc, reason }], requested_by, origin: 'bcc'|'slack' }
 *   deal_id = Opportunity ID (deal general de Pipedrive) = sheet_rows.opportunity_id. Si no hay filas con ese
 *   valor se prueba como deal bancario (sheet_rows.bank_deal_id) y se usa el Opportunity ID de esas filas.
 *
 * Efectos:
 *  a) sheet_rows.link_dossier = drive_url en todas las filas del cliente.
 *  b) flow_events kind 'dossier_generated' con detail { regenerated: true, included, excluded, requested_by, origin, file_name, drive_url }.
 *  c) Comentario público en los tickets ABIERTOS del Request Hub del cliente (deal general y deals bancarios).
 *     Si falla, la petición no falla: rhb = 'failed'.
 *
 * Respuesta: { ok: true, opportunity_id, sheet_rows_updated, flow_event_saved, rhb: 'commented'|'no_ticket'|'failed'|'not_configured', tickets_commented }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { recordFlowEvents } from '@/lib/flowEvents'
import { hubComment, hubTicketsForDeal } from '@/lib/requestHub'
import { isCompanyEmail } from '@/lib/alma/auth'

export const dynamic = 'force-dynamic'

interface RegeneratedBody {
  deal_id: number
  drive_url: string
  file_name: string
  included: string[]
  excluded: Array<{ doc: string; reason: string }>
  requested_by: string
  origin: 'bcc' | 'slack'
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

/** Validación manual (el repo no usa zod): devuelve el body normalizado o el primer error. */
function parseRegeneratedBody(b: unknown): { body?: RegeneratedBody; error?: string } {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'Body debe ser un objeto' }
  const o = b as Record<string, unknown>
  const dealId = typeof o.deal_id === 'number' ? o.deal_id : parseInt(String(o.deal_id ?? ''), 10)
  if (!Number.isInteger(dealId) || dealId <= 0) return { error: 'deal_id debe ser un entero positivo' }
  const driveUrl = str(o.drive_url, 1000)
  if (!driveUrl || !/^https:\/\/(drive|docs)\.google\.com\//.test(driveUrl)) return { error: 'drive_url debe ser un enlace https de Google Drive' }
  const fileName = str(o.file_name, 300)
  if (!fileName) return { error: 'file_name obligatorio' }
  if (!Array.isArray(o.included) || o.included.some((x) => typeof x !== 'string')) return { error: 'included debe ser string[]' }
  if (!Array.isArray(o.excluded) || o.excluded.some((x) => !x || typeof x !== 'object' || typeof (x as Record<string, unknown>).doc !== 'string' || typeof (x as Record<string, unknown>).reason !== 'string')) {
    return { error: 'excluded debe ser [{ doc: string, reason: string }]' }
  }
  const requestedBy = str(o.requested_by, 200)
  if (!requestedBy) return { error: 'requested_by obligatorio' }
  if (o.origin !== 'bcc' && o.origin !== 'slack') return { error: "origin debe ser 'bcc' o 'slack'" }
  return {
    body: {
      deal_id: dealId,
      drive_url: driveUrl,
      file_name: fileName,
      included: (o.included as string[]).slice(0, 100).map((x) => x.slice(0, 300)),
      excluded: (o.excluded as Array<{ doc: string; reason: string }>).slice(0, 100).map((x) => ({ doc: x.doc.slice(0, 300), reason: x.reason.slice(0, 500) })),
      requested_by: requestedBy,
      origin: o.origin,
    },
  }
}

function commentText(b: RegeneratedBody): string {
  const lines = [`Dossier regenerado (método nuevo de descifrado): ${b.file_name}`, b.drive_url]
  if (b.excluded.length) {
    lines.push('', 'Documentos que no se pudieron incluir:')
    for (const e of b.excluded) lines.push(`- ${e.doc}: ${e.reason}`)
  } else {
    lines.push('', 'Se incluyeron todos los documentos.')
  }
  lines.push('', `Solicitado por ${b.requested_by} desde ${b.origin === 'slack' ? 'Slack' : 'el Command Center'}.`)
  return lines.join('\n')
}

export async function POST(req: Request) {
  const secret = process.env.OFFERS_API_SECRET
  if (!secret || req.headers.get('x-offers-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { body, error } = parseRegeneratedBody(raw)
  if (!body) return NextResponse.json({ error }, { status: 400 })

  const supabase = await createAdminClient()

  // Filas del cliente: deal_id es el Opportunity ID; si no hay, se prueba como deal bancario
  let { data: rows, error: selErr } = await supabase.from('sheet_rows').select('id, opportunity_id, bank_deal_id').eq('opportunity_id', body.deal_id)
  if (!selErr && !rows?.length) {
    ;({ data: rows, error: selErr } = await supabase.from('sheet_rows').select('id, opportunity_id, bank_deal_id').eq('bank_deal_id', body.deal_id))
  }
  if (selErr) {
    console.error('[dossier/regenerated select]', selErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
  const opportunityId = (rows?.[0]?.opportunity_id as number | undefined) ?? body.deal_id
  const rowIds = (rows ?? []).map((r) => r.id as string)

  // a) Enlace del dossier en las filas del cliente
  let sheetRowsUpdated = 0
  if (rowIds.length) {
    const { data: upd, error: updErr } = await supabase.from('sheet_rows').update({ link_dossier: body.drive_url }).in('id', rowIds).select('id')
    if (updErr) {
      console.error('[dossier/regenerated update]', updErr)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }
    sheetRowsUpdated = upd?.length ?? 0
  }

  // b) Rastro para Alma
  const saved = await recordFlowEvents(supabase, [{
    opportunity_id: opportunityId,
    workflow: 'dossier_regeneration',
    step: 'regenerated',
    kind: 'dossier_generated',
    severity: body.excluded.length ? 'warning' : 'info',
    message: `Dossier regenerado (${body.file_name}); ${body.included.length} incluidos, ${body.excluded.length} excluidos`,
    detail: {
      regenerated: true,
      included: body.included,
      excluded: body.excluded,
      requested_by: body.requested_by,
      origin: body.origin,
      file_name: body.file_name,
      drive_url: body.drive_url,
    },
  }])

  // c) Comentario en los tickets abiertos del Request Hub (no bloqueante)
  let rhb: 'commented' | 'no_ticket' | 'failed' | 'not_configured' = 'no_ticket'
  let ticketsCommented = 0
  if (!process.env.REQUEST_HUB_BASE_URL || !process.env.REQUEST_HUB_EXTERNAL_API_SECRET) {
    rhb = 'not_configured'
  } else {
    try {
      const dealIds = [...new Set([opportunityId, ...(rows ?? []).map((r) => r.bank_deal_id as number | null).filter((x): x is number => !!x)])]
      const ticketLists = await Promise.all(dealIds.map((id) => hubTicketsForDeal(id, false)))
      const ticketIds = [...new Set(ticketLists.flat().map((t) => t.id))]
      const author = isCompanyEmail(body.requested_by) ? body.requested_by.toLowerCase() : undefined
      const text = commentText(body)
      for (const id of ticketIds) {
        await hubComment(id, text, author)
        ticketsCommented++
      }
      if (ticketsCommented) rhb = 'commented'
    } catch (e) {
      console.error('[dossier/regenerated request hub]', e instanceof Error ? e.message : e)
      rhb = 'failed'
    }
  }

  return NextResponse.json({
    ok: true,
    opportunity_id: opportunityId,
    sheet_rows_updated: sheetRowsUpdated,
    flow_event_saved: saved > 0,
    rhb,
    tickets_commented: ticketsCommented,
  })
}
