/**
 * Estado del dossier de un cliente (herramienta estado_dossier) y llamada a n8n para regenerarlo
 * (la lanza la persona con el botón; Alma nunca la llama directamente).
 *
 * deal_id = Opportunity ID (deal general de Pipedrive) = sheet_rows.opportunity_id = flow_events.opportunity_id.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const DOSSIER_KINDS = ['dossier_generated', 'dossier_too_big', 'decrypt_failed', 'merge_failed', 'compress_failed', 'missing_docs', 'upload_failed']

export async function estadoDossier(supabase: SupabaseClient, dealId: number) {
  const [rowsRes, eventsRes, banksRes] = await Promise.all([
    supabase
      .from('sheet_rows')
      .select('bank_id, opportunity_id, bank_deal_id, nombre_cliente, status, process_status, link_dossier, timestamp_sent')
      .or(`opportunity_id.eq.${dealId},bank_deal_id.eq.${dealId}`)
      .limit(30),
    supabase
      .from('flow_events')
      .select('kind, severity, message, detail, workflow, bank_slug, created_at')
      .eq('opportunity_id', dealId)
      .in('kind', DOSSIER_KINDS)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('banks').select('id, name'),
  ])
  const bankName = new Map((banksRes.data ?? []).map((b) => [b.id as number, b.name as string]))
  const eventos = (eventsRes.data ?? []).map((e) => {
    const d = (e.detail ?? {}) as Record<string, unknown>
    return {
      tipo: e.kind,
      gravedad: e.severity,
      fecha: e.created_at,
      banco: e.bank_slug,
      mensaje: e.message,
      ...(d.regenerated ? { regenerado: true, solicitado_por: d.requested_by, origen: d.origin, archivo: d.file_name, enlace: d.drive_url } : {}),
      ...(Array.isArray(d.excluded) && d.excluded.length ? { excluidos: d.excluded } : {}),
      ...(d.error ? { error: String(d.error).slice(0, 300) } : {}),
      ...(d.size_mb ? { peso_mb: d.size_mb } : {}),
    }
  })
  const filas = (rowsRes.data ?? []).map((r) => ({
    banco: bankName.get(r.bank_id as number) ?? r.bank_id,
    estado: r.status,
    estado_proceso: r.process_status,
    enviado: r.timestamp_sent,
    enlace_dossier: r.link_dossier,
  }))
  const ultimo = eventos[0] ?? null
  return {
    deal_id: dealId,
    cliente: rowsRes.data?.[0]?.nombre_cliente ?? null,
    ultimo_evento: ultimo,
    fallo_o_excluidos: !!ultimo && (ultimo.tipo !== 'dossier_generated' || !!ultimo.excluidos),
    eventos_dossier: eventos,
    filas_por_banco: filas,
    ...(rowsRes.error || eventsRes.error ? { aviso: 'No se pudieron leer todos los datos.' } : {}),
  }
}

/** Llama al flujo de n8n que regenera el dossier. Devuelve { accepted, reason }. */
export async function requestDossierRegen(dealId: number, requestedBy: string): Promise<{ accepted: boolean; reason: string }> {
  const url = process.env.ALMA_N8N_DOSSIER_REGEN_URL
  const secret = process.env.ALMA_N8N_SECRET
  if (!url || !secret) return { accepted: false, reason: 'not_configured' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-alma-secret': secret },
      body: JSON.stringify({ deal_id: dealId, requested_by: requestedBy, origin: 'bcc' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    const data = (await res.json().catch(() => ({}))) as { accepted?: unknown; reason?: unknown }
    if (!res.ok) return { accepted: false, reason: `http_${res.status}` }
    return { accepted: data.accepted !== false, reason: typeof data.reason === 'string' ? data.reason : 'accepted' }
  } catch {
    return { accepted: false, reason: 'unreachable' }
  }
}
