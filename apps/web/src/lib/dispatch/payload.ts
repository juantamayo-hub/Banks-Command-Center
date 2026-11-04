/**
 * Cuerpo que recibe el webhook n8n "Send Dossier <Banco>".
 *
 * Reproduce EXACTAMENTE lo que manda hoy Apps Script (postToN8N* en apps/appscript/ROW_ID *.js): las cabeceras
 * de la pestaña del banco como claves + los campos de control _<prefijo>_*. Así los 19 flujos funcionan sin cambiar
 * su lógica. Novedades:
 *   _source = 'platform-cc'   → contiene "platform": n8n se salta la espera de "creando dossier" (ya está creado)
 *   test_mode                 → n8n desvía el correo al email de prueba y no toca Pipedrive
 *   report_url                → a qué Command Center informar del resultado (staging o producción)
 */

export const CC_SOURCE = 'platform-cc'

export interface PayloadRow {
  id: string
  uid: string | null
  opportunity_id: number
  bank_deal_id: number | null
  nombre_cliente: string | null
  importe: number | null
  link_dossier: string | null
  timestamp_entry: string | null
  autorizacion: string | null
  autorizacion_red_flag: string | null
  status_raw: string | null
  red_flags_raw: string | null
  clasificacion: string | null
  dossier: string | null
  auto_bayteca: string | null
  auto_banco: string | null
  notas: string | null
  test_time: string | null
  process_status: string | null
  owner: string | null
}

export interface PayloadOptions {
  action: 'ENVIAR' | 'AUTORIZACION'
  prefix: string            // bank_config.send_payload_prefix (teruel, cajamar, UNICAJA…)
  force: boolean
  testMode: boolean
  reportUrl: string | null
  attemptAt?: Date
}

export function buildSendPayload(row: PayloadRow, o: PayloadOptions): Record<string, unknown> {
  const s = (v: unknown) => (v === null || v === undefined ? '' : v)
  const p = o.prefix
  // Importe como número entero, igual que la hoja (Supabase devuelve numeric como "180000.00"; los flujos quitan
  // los puntos como separador de miles y buscan el dossier por "180.000€<expediente>": con decimales no lo encuentran)
  const importeNum = Number(row.importe)
  const importe = row.importe !== null && row.importe !== undefined && Number.isFinite(importeNum) ? Math.round(importeNum) : ''
  return {
    'Opportunity ID': row.opportunity_id,
    'Nombre Cliente': s(row.nombre_cliente),
    'Importe': importe,
    'Link Dossier': s(row.link_dossier),
    'Timestamp': s(row.timestamp_entry),
    'Bank Deal ID': s(row.bank_deal_id),
    'Enviar': 'Yes',
    'Autorización': o.action === 'AUTORIZACION' ? 'Yes' : s(row.autorizacion),
    'Autorización Red Flag': s(row.autorizacion_red_flag),
    'Timestamp Sent': '',
    'Status': s(row.status_raw),
    'Red Flag': s(row.red_flags_raw),
    'Clasificación': s(row.clasificacion),
    'Dossier': s(row.dossier),
    'Auto Bayteca': s(row.auto_bayteca),
    'Auto Banco': s(row.auto_banco),
    'NOTAS': s(row.notas),
    'ITEM ID': s(row.uid),
    'TEST TIME': s(row.test_time),
    'Process Status': s(row.process_status),
    'Owner': s(row.owner),
    'Plataforma': 'Sí',
    'Opportunity': row.opportunity_id,
    [`_${p}_opportunity_id`]: row.opportunity_id,
    [`_${p}_action`]: o.action,
    [`_${p}_row`]: '',
    [`_${p}_item_id`]: s(row.uid),
    [`_${p}_attempt_at`]: (o.attemptAt ?? new Date()).toISOString(),
    _source: CC_SOURCE,
    force: o.force,
    test_mode: o.testMode,
    report_url: o.reportUrl,
    cc_row_id: row.id,
  }
}
