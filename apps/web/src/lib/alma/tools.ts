/**
 * Herramientas de Alma (todas de SOLO LECTURA). La única "acción" es marcar_problema_tecnico, que no envía
 * nada: solo habilita en la interfaz el botón "Enviar reporte a Juanjo" (lo pulsa la persona).
 */

import type Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/server'
import { getClientRecords, getDealInfo, getMetrics, getTickets, listDriveFolder, searchClients, summarizeDocs } from './data'
import { diagnose } from './diagnose'
import { KNOWLEDGE, KNOWLEDGE_TOPICS } from './knowledge'

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
    description: 'Ficha completa de un cliente por Opportunity ID: datos de Pipedrive (owner, deals bancarios, carpeta de Drive), estado de cada envío por banco con su diagnóstico, respuestas de los bancos, reservas anti-duplicado, red flags y eventos de los flujos.',
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
    description: 'Lista en vivo los documentos de la carpeta de Drive del cliente: qué hay y qué falta por código (C003…D008), tamaños, archivos vacíos, dossieres generados (con su peso) y autorizaciones, con enlaces.',
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
    name: 'metricas',
    description: 'Cifras globales: envíos de dossier por banco (hojas + plataforma + Kutxabank) y respuestas de los bancos (ofertas, rechazos, más info) en los últimos N días.',
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
            dossieres_en_drive: docs?.dossieres ?? `No se pudo consultar Drive: ${drive.error}`,
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
        return { ok: true, content: json({ cliente: deal?.cliente, carpeta: deal?.carpeta_drive, ...summarizeDocs(drive.files) }) }
      }
      case 'tickets_cliente': {
        const opp = intArg(input.opportunity_id)
        if (!opp) return { ok: false, content: 'opportunity_id no válido' }
        const deal = await getDealInfo(opp)
        const ids = [opp, ...(deal?.deals_bancarios.map((d) => d.id) ?? [])]
        const t = await getTickets(ids)
        return { ok: t.ok, content: json(t.ok ? { deals_consultados: ids, tickets: t.tickets } : { error: t.error }) }
      }
      case 'metricas':
        return { ok: true, content: json(await getMetrics(supabase, Number(input.dias) || 1)) }
      case 'conocimiento': {
        const k = KNOWLEDGE[String(input.tema)]
        return k ? { ok: true, content: `${k.titulo}\n${k.texto}` } : { ok: false, content: `Tema desconocido. Temas: ${KNOWLEDGE_TOPICS.join(', ')}` }
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
