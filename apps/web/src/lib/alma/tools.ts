/**
 * Herramientas de Alma (todas de SOLO LECTURA). La única "acción" es marcar_problema_tecnico, que no envía
 * nada: solo habilita en la interfaz el botón "Enviar reporte a Juanjo" (lo pulsa la persona).
 */

import type Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/server'
import { getClientRecords, getDealInfo, getMetrics, getOpenTickets, getTicketStats, getPendingOffers, getPendingSends, getTickets, listDriveFolder, revisarAutorizaciones, searchClients, summarizeDocs } from './data'
import { diagnose } from './diagnose'
import { KNOWLEDGE, KNOWLEDGE_TOPICS } from './knowledge'
import { TEAM, findMember } from './team'

export const ALMA_TOOLS: Anthropic.Tool[] = [
  {
    name: 'buscar_cliente',
    description: 'Busca clientes por nombre, nº de deal general (Opportunity ID), nº de deal bancario o DNI. Devuelve hasta 10 coincidencias con su Opportunity ID y los bancos en los que aparece. Úsala primero si no tienes el Opportunity ID exacto.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Nombre (o parte), nº de deal o DNI/NIE' } },
      required: ['q'],
      additionalProperties: false,
    },
  },
  {
    name: 'ficha_cliente',
    description: 'Ficha completa de un cliente por Opportunity ID: datos de Pipedrive (owner, DNI/NIE de los titulares, deals bancarios, carpeta de Drive), estado de cada envío por banco con su diagnóstico, respuestas de los bancos (correos clasificados), historial de estados de la petición en CaixaBank (estado del lead, motivo pendiente, resolución), estados de Rastreator para Kutxabank, notas del equipo en el Command Center, relanzamientos solicitados, reservas anti-duplicado, red flags y eventos de los flujos.',
    input_schema: {
      type: 'object',
      properties: { opportunity_id: { type: 'integer', description: 'Opportunity ID (deal general de Pipedrive)' } },
      required: ['opportunity_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'explicar_envio',
    description: 'Explica por qué el dossier de un cliente salió o no salió a un banco (o a todos si no se indica banco). Incluye el peso real del dossier en Drive. Úsala para cualquier pregunta tipo "¿por qué no ha salido…?".',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'integer' },
        banco: { type: 'string', description: 'Nombre del banco (opcional), p. ej. "Ibercaja", "Eurocaja"' },
      },
      required: ['opportunity_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'documentos_cliente',
    description: 'Lista en vivo los documentos de la carpeta de Drive del cliente: qué hay y qué falta por código (C003…D008), tamaños, archivos vacíos, dossieres generados (con su peso) y autorizaciones, con enlaces. Incluye revision_autorizaciones: compara cada autorización con el DNI del 1er titular de Pipedrive y el formato que buscan los flujos ("Autorizaciones <Banco> <DNI>.pdf") y marca las mal nombradas con el nombre correcto. Úsala para "¿están bien las autorizaciones?" o "¿por qué no encuentra la autorización?".',
    input_schema: {
      type: 'object',
      properties: { opportunity_id: { type: 'integer' } },
      required: ['opportunity_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'tickets_cliente',
    description: 'Tickets de Request Hub del cliente (por su deal general y sus deals bancarios): estado, prioridad, banco, responsable, SLA y últimos comentarios públicos.',
    input_schema: {
      type: 'object',
      properties: { opportunity_id: { type: 'integer' } },
      required: ['opportunity_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'tickets_abiertos',
    description: 'Cola de tickets abiertos de Request Hub de todo el equipo (nuevos, en curso, esperando al empleado): totales por estado, asignado y banco, SLA vencidos y la lista de los más antiguos. Filtros opcionales por banco, asignado ("sin asignar" para los que no tienen) y solo SLA vencido. Para los tickets de un cliente concreto usa tickets_cliente.',
    input_schema: {
      type: 'object',
      properties: {
        banco: { type: 'string' },
        asignado: { type: 'string', description: 'Nombre o email de la persona asignada, o "sin asignar"' },
        solo_vencidos: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tickets_estadisticas',
    description: 'Estadísticas de tickets de Request Hub CREADOS en un periodo (abiertos y cerrados), agrupadas por solicitante (el gestor que abrió el ticket), asignado, categoría, banco o estado. Úsala para preguntas por mes o periodo («¿cuántos tickets de nuevo envío abrió cada gestor en septiembre?»). Por defecto excluye los automáticos «[Auto] …». Para la cola abierta de hoy usa tickets_abiertos.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD (incluido, hora de Madrid)' },
        hasta: { type: 'string', description: 'YYYY-MM-DD (incluido, hora de Madrid)' },
        agrupar_por: { type: 'string', enum: ['solicitante', 'asignado', 'categoria', 'banco', 'estado'] },
        categoria: { type: 'string', description: 'Filtrar por categoría, p. ej. «Nuevo envío», «Contactar con el cliente»' },
        banco: { type: 'string' },
        incluir_automaticos: { type: 'boolean' },
      },
      required: ['desde', 'hasta', 'agrupar_por'],
      additionalProperties: false,
    },
  },
  {
    name: 'metricas',
    description: 'Cifras globales: envíos de dossier por banco (hojas + plataforma + Kutxabank), respuestas de los bancos (ofertas, rechazos, más info), foto de CaixaBank (peticiones por estado: en estudio, en firma, formalizadas, cerradas y sus motivos) y estados de Rastreator/Kutxabank en los últimos N días.',
    input_schema: {
      type: 'object',
      properties: { dias: { type: 'integer', description: 'Nº de días completos hacia atrás (1 = ayer). Máx. 90.' } },
      required: ['dias'],
      additionalProperties: false,
    },
  },
  {
    name: 'conocimiento',
    description: `Explica cómo funciona un proceso. Temas: ${KNOWLEDGE_TOPICS.join(', ')}. Úsala antes de explicar procesos, límites (Gmail 25 MB, anti-duplicado…) o el significado de un estado.`,
    input_schema: {
      type: 'object',
      properties: { tema: { type: 'string', enum: KNOWLEDGE_TOPICS } },
      required: ['tema'],
      additionalProperties: false,
    },
  },
  {
    name: 'envios_pendientes',
    description: 'Cola del EQUIPO de envíos de dossier que se pidieron y no constan enviados (hoja, plataforma y Kutxabank), con el motivo de cada uno (bloqueado por red flag, faltan documentos, dossier pesado, flujo caído, pendiente de plataforma…). Úsala para "¿qué envíos tenemos/tengo pendientes?", "¿hay algo bloqueado?". Filtros opcionales por banco u owner (MC).',
    input_schema: {
      type: 'object',
      properties: {
        banco: { type: 'string', description: 'Filtrar por banco (opcional)' },
        owner: { type: 'string', description: 'Filtrar por owner/MC (opcional)' },
        dias: { type: 'integer', description: 'Antigüedad máxima de las filas en días (por defecto 21)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ofertas_pendientes',
    description: 'Cola del EQUIPO de respuestas de bancos que hay que revisar a mano («Requieren atención» en Ofertas recibidas): sin vincular a un deal, con error o en revisión manual. Filtro opcional por banco.',
    input_schema: {
      type: 'object',
      properties: { banco: { type: 'string', description: 'Filtrar por banco (opcional)' } },
      additionalProperties: false,
    },
  },
  {
    name: 'equipo',
    description: 'Quién es quién en Bank Ops (Oscar, Flor, Silvia, Juanjo, Ceci): rol y de qué temas se encarga cada uno. Úsala para saber a quién derivar algo.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'preparar_mensaje_slack',
    description: 'Prepara un borrador de mensaje directo de Slack para una persona del equipo (oscar, flor, silvia, juanjo, ceci). NO lo envía: el usuario lo revisa y pulsa "Enviar". Úsala cuando haya que avisar o pedir algo a alguien, o cuando el usuario te lo pida. Escribe el mensaje en primera persona del usuario, breve y con el contexto necesario (cliente, deal, banco, qué se necesita).',
    input_schema: {
      type: 'object',
      properties: {
        destinatario: { type: 'string', enum: TEAM.map((m) => m.clave) },
        mensaje: { type: 'string', description: 'Texto del mensaje (máx. ~800 caracteres)' },
      },
      required: ['destinatario', 'mensaje'],
      additionalProperties: false,
    },
  },
  {
    name: 'marcar_problema_tecnico',
    description: 'Úsala SOLO cuando los datos muestran un problema técnico (flujo de n8n caído o con error, fallo de Supabase/Apps Script/sincronización, o un proceso mal diseñado), nunca para problemas operativos (documentos, red flags, dossier pesado…). No envía nada: muestra al usuario el botón para enviar el reporte a Juanjo.',
    input_schema: {
      type: 'object',
      properties: {
        resumen: { type: 'string', description: 'Resumen técnico breve del problema y la evidencia' },
        opportunity_id: { type: 'integer' },
        banco: { type: 'string' },
      },
      required: ['resumen'],
      additionalProperties: false,
    },
  },
]

export interface ToolOutcome {
  content: string
  ok: boolean
  technical?: { resumen: string; opportunity_id?: number; banco?: string }
  slackDraft?: { destinatario: string; nombre: string; mensaje: string }
}

const MAX_RESULT_CHARS = 14_000
const json = (v: unknown) => {
  const s = JSON.stringify(v)
  return s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + '…(recortado)' : s
}
const intArg = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Ejecuta una herramienta. Valida la entrada y nunca lanza (los errores vuelven como resultado). */
const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Notas que el equipo dejó en el Command Center para ese banco (si no se indica banco, todas). Suelen explicar el motivo real. */
function notasDelBanco(notas: Array<{ banco: string | null; origen: string; nota: string; fecha: string }>, banco: string | null) {
  const b = fold(banco ?? '')
  const out = b ? notas.filter((n) => { const nb = fold(n.banco ?? ''); return !!nb && (nb.includes(b) || b.includes(nb)) }) : notas
  return out.slice(0, 10)
}

export async function runAlmaTool(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    const supabase = await createAdminClient()
    switch (name) {
      case 'buscar_cliente': {
        const q = String(input.q ?? '').trim()
        if (q.length < 2) return { ok: false, content: 'Búsqueda demasiado corta.' }
        const hits = await searchClients(supabase, q)
        return { ok: true, content: json(hits.length ? hits : { resultado: 'Sin coincidencias en el Command Center ni en Pipedrive.' }) }
      }
      case 'ficha_cliente': {
        const opp = intArg(input.opportunity_id)
        if (!opp) return { ok: false, content: 'opportunity_id no válido' }
        const deal = await getDealInfo(opp)
        const records = await getClientRecords(supabase, opp, deal?.deals_bancarios.map((d) => d.id) ?? [])
        const diagnostico = diagnose(records)
        return { ok: true, content: json({ pipedrive: deal ?? 'No se pudo leer el deal en Pipedrive', diagnostico_envios: diagnostico, ...records }) }
      }
      case 'explicar_envio': {
        const opp = intArg(input.opportunity_id)
        if (!opp) return { ok: false, content: 'opportunity_id no válido' }
        const deal = await getDealInfo(opp)
        const [records, drive] = await Promise.all([
          getClientRecords(supabase, opp, deal?.deals_bancarios.map((d) => d.id) ?? []),
          listDriveFolder(deal?.carpeta_drive ?? null),
        ])
        const docs = drive.ok ? summarizeDocs(drive.files) : null
        const result = diagnose({ ...records, dossieres: docs?.dossieres, documentos: docs?.documentos }, (input.banco as string) || null)
        return {
          ok: true,
          content: json({
            cliente: deal?.cliente ?? records.filas_hoja[0]?.nombre_cliente ?? null,
            diagnostico: result.length ? result : 'No hay ningún envío registrado para ese banco y cliente.',
            notas_del_equipo: notasDelBanco(records.notas_equipo_command_center, (input.banco as string) || null),
            ...(/caixa/i.test(String(input.banco ?? '')) && records.caixabank_estado_peticion.length
              ? { caixabank_estado_peticion: records.caixabank_estado_peticion.slice(0, 5) }
              : {}),
            ...(/kutxa/i.test(String(input.banco ?? '')) && records.kutxabank_estados_rastreator.length
              ? { kutxabank_estados_rastreator: records.kutxabank_estados_rastreator }
              : {}),
            dossieres_en_drive: docs?.dossieres ?? `No se pudo consultar Drive: ${drive.error}`,
            // Una autorización mal nombrada hace que el flujo la dé por faltante y no envíe
            ...(drive.ok
              ? { revision_autorizaciones: revisarAutorizaciones(drive.files, deal?.dni_1t ?? null, deal?.dni_2t ?? null, (deal?.deals_bancarios ?? []).map((b) => b.banco ?? '').filter(Boolean)) }
              : {}),
            enlace_pipedrive: deal?.enlace_pipedrive,
          }),
        }
      }
      case 'documentos_cliente': {
        const opp = intArg(input.opportunity_id)
        if (!opp) return { ok: false, content: 'opportunity_id no válido' }
        const deal = await getDealInfo(opp)
        const drive = await listDriveFolder(deal?.carpeta_drive ?? null)
        if (!drive.ok) {
          const { data } = await supabase.from('flow_events').select('detail, created_at').eq('opportunity_id', opp).eq('kind', 'docs_snapshot').order('created_at', { ascending: false }).limit(1)
          return { ok: !!data?.length, content: json({ aviso: `No se pudo consultar Drive en vivo: ${drive.error}`, ultima_foto: data?.[0] ?? null, carpeta: deal?.carpeta_drive ?? null }) }
        }
        return {
          ok: true,
          content: json({
            cliente: deal?.cliente,
            carpeta: deal?.carpeta_drive,
            revision_autorizaciones: revisarAutorizaciones(drive.files, deal?.dni_1t ?? null, deal?.dni_2t ?? null, (deal?.deals_bancarios ?? []).map((b) => b.banco ?? '').filter(Boolean)),
            ...summarizeDocs(drive.files),
          }),
        }
      }
      case 'tickets_cliente': {
        const opp = intArg(input.opportunity_id)
        if (!opp) return { ok: false, content: 'opportunity_id no válido' }
        const deal = await getDealInfo(opp)
        const ids = [opp, ...(deal?.deals_bancarios.map((d) => d.id) ?? [])]
        const t = await getTickets(ids)
        return { ok: t.ok, content: json(t.ok ? { deals_consultados: ids, tickets: t.tickets } : { error: t.error }) }
      }
      case 'tickets_abiertos': {
        const t = await getOpenTickets({
          banco: typeof input.banco === 'string' ? input.banco : null,
          asignado: typeof input.asignado === 'string' ? input.asignado : null,
          solo_vencidos: input.solo_vencidos === true,
        })
        return { ok: t.ok, content: json(t) }
      }
      case 'tickets_estadisticas': {
        const grp = String(input.agrupar_por)
        if (!['solicitante', 'asignado', 'categoria', 'banco', 'estado'].includes(grp)) return { ok: false, content: 'agrupar_por no válido' }
        const t = await getTicketStats({
          desde: String(input.desde ?? ''),
          hasta: String(input.hasta ?? ''),
          agrupar_por: grp as 'solicitante',
          categoria: typeof input.categoria === 'string' ? input.categoria : null,
          banco: typeof input.banco === 'string' ? input.banco : null,
          incluir_automaticos: input.incluir_automaticos === true,
        })
        return { ok: t.ok, content: json(t) }
      }
      case 'metricas':
        return { ok: true, content: json(await getMetrics(supabase, Number(input.dias) || 1)) }
      case 'conocimiento': {
        const k = KNOWLEDGE[String(input.tema)]
        return k ? { ok: true, content: `${k.titulo}\n${k.texto}` } : { ok: false, content: `Tema desconocido. Temas: ${KNOWLEDGE_TOPICS.join(', ')}` }
      }
      case 'envios_pendientes': {
        const res = await getPendingSends(
          supabase,
          { banco: (input.banco as string) || null, owner: (input.owner as string) || null, dias: Number(input.dias) || 21 },
          (row) => diagnose({ filas_hoja: [row], envios_plataforma: [], kutxabank: [], reservas_envio: [], eventos_flujo: [], red_flags: [] })[0] ?? { motivo: 'unknown', explicacion: '', es_tecnico: false },
        )
        return { ok: true, content: json(res) }
      }
      case 'ofertas_pendientes':
        return { ok: true, content: json(await getPendingOffers(supabase, { banco: (input.banco as string) || null })) }
      case 'equipo':
        return { ok: true, content: json(TEAM.map(({ clave, nombre, apodo, rol, temas }) => ({ clave, nombre, apodo, rol, temas }))) }
      case 'preparar_mensaje_slack': {
        const m = findMember(String(input.destinatario ?? ''))
        const mensaje = String(input.mensaje ?? '').trim().slice(0, 1500)
        if (!m) return { ok: false, content: `Destinatario desconocido. Opciones: ${TEAM.map((t) => t.clave).join(', ')}` }
        if (!mensaje) return { ok: false, content: 'Falta el mensaje.' }
        return {
          ok: true,
          content: `Borrador listo para ${m.apodo}. El usuario lo verá en el chat, podrá editarlo y pulsar "Enviar". Dile que lo revise; no digas que ya está enviado.`,
          slackDraft: { destinatario: m.clave, nombre: m.apodo, mensaje },
        }
      }
      case 'marcar_problema_tecnico': {
        const resumen = String(input.resumen ?? '').slice(0, 1500)
        if (!resumen) return { ok: false, content: 'Falta el resumen.' }
        return {
          ok: true,
          content: 'Hecho: el usuario verá el botón "Enviar reporte a Juanjo". Dile que puede pulsarlo si quiere que Juanjo lo revise.',
          technical: { resumen, opportunity_id: intArg(input.opportunity_id) ?? undefined, banco: (input.banco as string) || undefined },
        }
      }
      default:
        return { ok: false, content: `Herramienta desconocida: ${name}` }
    }
  } catch (e) {
    return { ok: false, content: `Error al consultar los datos: ${e instanceof Error ? e.message : 'desconocido'}` }
  }
}
