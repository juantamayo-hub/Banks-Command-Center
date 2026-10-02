/**
 * Motor de diagnóstico de envíos (determinista). A partir de los datos reales de un cliente decide,
 * para cada banco, si el dossier salió y, si no, por qué y qué hacer. Alma solo lo redacta.
 * Cada regla deja constancia de la evidencia en la que se basa.
 */

import { PLATFORM_BANKS } from '@/lib/platformDispatch'

export const GMAIL_LIMIT_MB = 25

export interface Diagnosis {
  banco: string
  estado: 'enviado' | 'no_enviado' | 'pendiente' | 'desconocido'
  motivo: string            // código estable: sent, dossier_too_big, gmail_error, missing_docs, red_flag, …
  explicacion: string
  que_hacer: string
  es_tecnico: boolean       // true → se puede reportar a Juanjo
  evidencias: string[]
}

type Row = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const lc = (v: unknown) => s(v).toLowerCase()
/** Fecha (dd/mm/aaaa) en hora de Madrid: la hoja guarda la medianoche de Madrid como las 22:00 UTC del día anterior */
const fechaMadrid = (v: unknown) => {
  const t = Date.parse(s(v))
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }) : s(v).slice(0, 10)
}

export interface DiagnoseInput {
  filas_hoja: Row[]
  envios_plataforma: Row[]
  kutxabank: Row[]
  reservas_envio: Row[]
  eventos_flujo: Row[]
  red_flags: Row[]
  dossieres?: Array<{ nombre: string; mb: number | null; creado: string | null }>
  documentos?: Array<{ codigo: string; documento: string; presente: boolean; archivos: Array<{ mb: number | null; vacio: boolean }> }>
}

const BLOQUEOS: Array<[RegExp, string, string]> = [
  [/no hay itemid|no hay item id/i, 'La fila no tiene ITEM ID, así que Apps Script no la lanzó.', 'Editar la fila (p. ej. volver a poner Enviar=Yes) para que se genere el ITEM ID. No crear una fila nueva.'],
  [/no hay opportunity/i, 'La fila no tiene Opportunity ID.', 'Rellenar el Opportunity ID en la fila.'],
  [/no hay enviar=yes ni autorizaci/i, 'La fila no tiene Enviar=Yes ni Autorización=Yes.', 'Poner Enviar=Yes en la fila cuando esté lista.'],
  [/ya tiene timestamp/i, 'La fila ya tenía fecha de envío, así que no se volvió a lanzar (protección contra duplicados).', 'Si de verdad hay que reenviar, coméntalo con el TL.'],
  [/status ya cerrado|process status ya cerrado/i, 'La fila ya estaba cerrada (enviada o completada).', 'Revisar si ya salió; si hay que reenviar, coméntalo con el TL.'],
  [/cooldown|anti-duplicado/i, 'Se bloqueó un reintento automático para no enviar dos veces.', 'Esperar unos minutos antes de volver a intentarlo.'],
  [/fila inv[aá]lida/i, 'La fila no tiene los datos mínimos para enviarse.', 'Revisar que la fila esté completa.'],
]

function latestEvent(events: Row[], bankSlug: string | null, kinds: string[]) {
  return events.find((e) => kinds.includes(s(e.kind)) && (!bankSlug || !e.bank_slug || e.bank_slug === bankSlug))
}

/** Diagnóstico de los bancos con fila en la hoja (envío por n8n). */
function diagnoseSheetRow(row: Row, input: DiagnoseInput): Diagnosis {
  const banco = s(row.banco) || s(row.bank_slug)
  const slug = s(row.bank_slug) || null
  const ev: string[] = []
  const status = lc(row.status)
  const statusRaw = s(row.status_raw)
  const proc = s(row.process_status)
  const notas = s(row.notas)
  if (statusRaw) ev.push(`Status en la hoja: "${statusRaw}"`)
  if (proc) ev.push(`Process Status: "${proc}"`)
  if (notas) ev.push(`NOTAS: "${notas}"`)

  // 1) Enviado
  if (status === 'sent' || /^enviado/i.test(statusRaw) || row.timestamp_sent) {
    const fecha = row.timestamp_sent ? fechaMadrid(row.timestamp_sent) : ''
    return { banco, estado: 'enviado', motivo: 'sent', explicacion: `El dossier salió${fecha ? ` (fecha de envío ${fecha})` : ''}.`, que_hacer: 'Nada: está enviado. Si el banco no responde, mirar sus respuestas.', es_tecnico: false, evidencias: ev }
  }

  // 2) Dossier demasiado pesado (evento del flujo o peso real en Drive)
  const tooBig = latestEvent(input.eventos_flujo, slug, ['dossier_too_big', 'gmail_error'])
  const bigFile = (input.dossieres ?? []).find((d) => (d.mb ?? 0) > GMAIL_LIMIT_MB)
  const gmailFailed = /error env[ií]o|no ha salido|gmail no pudo/i.test(statusRaw + ' ' + notas) || s(tooBig?.kind) === 'gmail_error'
  if (bigFile && (gmailFailed || !row.timestamp_sent)) {
    ev.push(`Dossier en Drive: "${bigFile.nombre}" pesa ${bigFile.mb} MB (límite de Gmail: ${GMAIL_LIMIT_MB} MB)`)
    if (tooBig) ev.push(`Evento del flujo: ${s(tooBig.message)}`)
    return {
      banco, estado: 'no_enviado', motivo: 'dossier_too_big',
      explicacion: `El dossier pesa ${bigFile.mb} MB y Gmail solo permite adjuntos de hasta ${GMAIL_LIMIT_MB} MB, así que el correo no puede salir.`,
      que_hacer: 'Subir a la carpeta versiones más ligeras de los documentos más pesados (escaneos de DNI, movimientos…), regenerar el dossier y volver a lanzar el envío.',
      es_tecnico: false, evidencias: ev,
    }
  }
  if (gmailFailed) {
    if (tooBig) ev.push(`Evento del flujo: ${s(tooBig.message)}`)
    return {
      banco, estado: 'no_enviado', motivo: 'gmail_error',
      explicacion: 'Gmail no pudo enviar el correo al banco.',
      que_hacer: 'Si el dossier pesa mucho, aligerarlo; si no, puede ser un fallo técnico: reportarlo.',
      es_tecnico: !bigFile, evidencias: ev,
    }
  }

  // 3) Webhook de n8n desactivado / error del flujo
  if (/error n8n/i.test(proc)) {
    const notReg = /404|not registered/i.test(proc)
    return {
      banco, estado: 'no_enviado', motivo: notReg ? 'n8n_flow_inactive' : 'n8n_error',
      explicacion: notReg ? 'El flujo de envío de n8n de este banco estaba desactivado, así que la orden no llegó.' : 'El flujo de n8n devolvió un error al recibir la orden.',
      que_hacer: 'Es un problema técnico: reportarlo a Juanjo. Cuando esté arreglado, volver a lanzar el envío.',
      es_tecnico: true, evidencias: ev,
    }
  }
  if (/error apps script/i.test(proc)) {
    return { banco, estado: 'no_enviado', motivo: 'apps_script_error', explicacion: 'El script de la hoja falló al lanzar el envío.', que_hacer: 'Es un problema técnico: reportarlo a Juanjo.', es_tecnico: true, evidencias: ev }
  }

  // 4) Bloqueos de Apps Script
  if (/^bloqueado/i.test(proc)) {
    const m = BLOQUEOS.find(([re]) => re.test(proc))
    return {
      banco, estado: 'no_enviado', motivo: 'sheet_blocked',
      explicacion: m ? m[1] : `Apps Script no lanzó el envío: ${proc}.`,
      que_hacer: m ? m[2] : 'Revisar la fila con el motivo indicado.',
      es_tecnico: false, evidencias: ev,
    }
  }

  // 5) Anti-duplicado (bloqueo silencioso en n8n)
  const anti = latestEvent(input.eventos_flujo, slug, ['antidup_blocked'])
  if (anti) {
    ev.push(`Evento: ${s(anti.message)}`)
    const release = s((anti.detail as Row | undefined)?.release_at)
    return {
      banco, estado: 'no_enviado', motivo: 'antidup_blocked',
      explicacion: 'El envío se bloqueó porque este banco ya recibió el dossier de este cliente hace menos de 6 horas (protección contra duplicados).',
      que_hacer: release ? `Comprobar si el primer envío salió. Se puede reenviar a partir de ${release}.` : 'Comprobar si el primer envío salió.',
      es_tecnico: false, evidencias: ev,
    }
  }

  // 6) Red flags
  const flags = s(row.red_flags_raw) || input.red_flags.filter((r) => s(r.banco) === banco).map((r) => s(r.raw_text)).join(' | ')
  if (status === 'blocked_red_flag' || (flags && !/^(yes|ok|no red flags)/i.test(flags) && !lc(row.autorizacion_red_flag).startsWith('yes'))) {
    if (flags) ev.push(`Red flags: ${flags}`)
    if (status === 'blocked_red_flag' || /red flag/i.test(statusRaw)) {
      return { banco, estado: 'no_enviado', motivo: 'red_flag', explicacion: `El envío está parado por red flags${flags ? `: ${flags}` : ''}.`, que_hacer: 'Revisarlo con el TL y, si procede, poner "Autorización Red Flag" = Yes en la fila.', es_tecnico: false, evidencias: ev }
    }
  }

  // 7) Faltan documentos / dossier
  const falta = notas.match(/falta[n]?\s+(.+)/i)?.[1]
  if (falta || status === 'blocked_missing_docs' || /falta dossier|ver notas/i.test(statusRaw + notas)) {
    const sinDossier = (input.dossieres ?? []).length === 0
    return {
      banco, estado: 'no_enviado', motivo: 'missing_docs',
      explicacion: falta ? `Faltan elementos para enviar: ${falta}.` : sinDossier ? 'No se encontró el dossier en la carpeta de Drive.' : 'Faltan documentos o autorizaciones (ver la nota del deal en Pipedrive).',
      que_hacer: falta && /nuevo_documento/i.test(falta)
        ? 'Es el documento de datos básicos de Ibercaja: se genera solo al lanzar el envío; si sigue faltando, reportarlo.'
        : sinDossier ? 'Comprobar que el dossier se generó (si el generador falló, reportarlo) y volver a lanzar el envío.' : 'Subir lo que falta a la carpeta con su código y volver a lanzar el envío.',
      es_tecnico: !!falta && /nuevo_documento/i.test(falta), evidencias: ev,
    }
  }

  // 8) Aún no se ha pedido el envío
  if (!row.send_trigger && !lc(row.autorizacion).startsWith('yes')) {
    return { banco, estado: 'pendiente', motivo: 'not_requested', explicacion: 'Todavía no se ha puesto Enviar=Yes en la fila de este banco.', que_hacer: 'Cuando el expediente esté listo, poner Enviar=Yes.', es_tecnico: false, evidencias: ev }
  }

  // 9) En curso o sin resultado
  if (/esperando|procesando|enviando a n8n/i.test(proc)) {
    return { banco, estado: 'pendiente', motivo: 'in_progress', explicacion: 'El envío está en curso (el flujo espera al dossier o está procesando).', que_hacer: 'Esperar unos minutos. Si en 30 minutos no cambia, avisar.', es_tecnico: false, evidencias: ev }
  }
  if (/enviado a n8n/i.test(proc)) {
    return { banco, estado: 'desconocido', motivo: 'no_result', explicacion: 'El flujo recibió la orden pero no dejó resultado en la hoja.', que_hacer: 'Puede ser un fallo del flujo: reportarlo a Juanjo para que revise la ejecución.', es_tecnico: true, evidencias: ev }
  }
  return { banco, estado: 'desconocido', motivo: 'unknown', explicacion: 'No hay datos suficientes para saber qué pasó con este envío.', que_hacer: 'Revisar la fila en la hoja; si no se entiende, reportarlo.', es_tecnico: false, evidencias: ev }
}

export function diagnose(input: DiagnoseInput, banco?: string | null): Diagnosis[] {
  const want = lc(banco)
  const match = (name: string) => !want || lc(name).includes(want) || want.includes(lc(name))
  const out: Diagnosis[] = []

  for (const row of input.filas_hoja) {
    if (row.is_discarded) continue
    if (!match(s(row.banco) || s(row.bank_slug))) continue
    out.push(diagnoseSheetRow(row, input))
  }

  for (const p of input.envios_plataforma) {
    const name = s(p.bank_name)
    if (!match(name) || p.dismissed_at) continue
    out.push(p.sent_at
      ? { banco: name, estado: 'enviado', motivo: 'sent', explicacion: `Se marcó como enviado por plataforma el ${fechaMadrid(p.sent_at)}${p.sent_by ? ` (${s(p.sent_by)})` : ''}.`, que_hacer: 'Nada.', es_tecnico: false, evidencias: ['Envíos por plataforma'] }
      : { banco: name, estado: 'pendiente', motivo: 'platform_pending', explicacion: `${name} se envía a mano por su plataforma y todavía no está marcado como enviado.`, que_hacer: 'Enviarlo desde la web del banco y marcarlo en "Envíos por plataforma".', es_tecnico: false, evidencias: ['Envíos por plataforma'] })
  }

  for (const k of input.kutxabank) {
    if (!match('Kutxabank') || k.dismissed_at) continue
    const missing = (k.missing_docs as string[] | null) ?? []
    out.push(k.sent_at
      ? { banco: 'Kutxabank', estado: 'enviado', motivo: 'sent', explicacion: `Enviado a Rastreator el ${fechaMadrid(k.sent_at)} (estado Rastreator: ${s(k.rastreator_status) || '—'}).`, que_hacer: 'Nada.', es_tecnico: false, evidencias: ['Kutxabank · envíos'] }
      : { banco: 'Kutxabank', estado: 'pendiente', motivo: missing.length ? 'missing_docs' : 'platform_pending', explicacion: missing.length ? `Faltan documentos para Kutxabank: ${missing.join(', ')}.` : 'Pendiente de enviar a Rastreator.', que_hacer: missing.length ? 'Subir los documentos y pulsar "Verificar documentos" en la tarjeta de Kutxabank.' : 'Enviarlo desde "Kutxabank · Envíos".', es_tecnico: false, evidencias: ['Kutxabank · envíos'] })
  }

  if (!out.length && want && PLATFORM_BANKS.some((b) => lc(b) === want)) {
    out.push({ banco: banco!, estado: 'desconocido', motivo: 'no_record', explicacion: `No hay registro de ${banco} para este cliente en "Envíos por plataforma".`, que_hacer: 'Comprobar en Pipedrive que el banco está seleccionado en el deal.', es_tecnico: false, evidencias: [] })
  }
  return out
}
