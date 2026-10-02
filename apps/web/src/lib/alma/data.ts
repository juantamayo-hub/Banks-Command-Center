/**
 * Consultas de solo lectura que usa Alma. Nada aquí escribe en Supabase, Pipedrive, Drive ni la hoja.
 * Cada función devuelve datos "planos" y acotados (Alma los recibe como resultado de herramienta).
 */

import { createClient as createSupabase } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { BANK_ID_FIELD_IDS, BANK_LINK_FIELD_IDS, PLATFORM_BANKS } from '@/lib/platformDispatch'
import { dossierSends, madridDayStart } from '@/lib/dossierSends'

type Admin = Awaited<ReturnType<typeof createAdminClient>>

// Campos de Pipedrive (deal general, pipeline 6/9)
const F = {
  folder: 'c2ea08d72de437ee4957ff3807c48cebe7a1aa3e',
  md: 'b5d36c005e38a4cd72d831be655996a3d6b34dc1',
  dni1: '60228dc43313b931378ec9bb3f21f7ad7f5a144c',
  dni2: 'c83f49f1e2fd08f55a16b159dd88802d2b5baa04',
  dossierCreado: 'bb735a607be5082db41ac876f1c7f283599ad742',
  linkDossier: 'a84af88ae6aa30f8b7f840d95bf737a71f42077a',
  bankMail: '498dd83b5c5e1f1181c232131933717ceadfda34', // deal bancario
}

const pipedriveUrl = (id: number | string) => `https://mdsl.pipedrive.com/deal/${id}`
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const val = (v: unknown): unknown => (v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v)

async function pipedriveGet(path: string): Promise<Record<string, unknown> | null> {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return null
  try {
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`https://api.pipedrive.com/v1/${path}${sep}api_token=${token}`, { cache: 'no-store' })
    if (!res.ok) return null
    return ((await res.json())?.data as Record<string, unknown>) ?? null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Búsqueda de clientes
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientHit {
  opportunity_id: number
  nombre: string | null
  bancos: string[]
  enlace_pipedrive: string
}

/** Busca por nº de deal general, nº de deal bancario, nombre o DNI. Máx. 10 clientes. */
export async function searchClients(supabase: Admin, q: string): Promise<ClientHit[]> {
  const term = q.trim()
  if (!term) return []
  const n = /^\d{4,9}$/.test(term) ? Number(term) : null
  const isDni = /^[XYZ]?\d{7,8}[A-Z]$/i.test(term.replace(/[\s-]/g, ''))
  // Insensible a tildes y mayúsculas: "Pérez" encuentra "Perez" y viceversa (vocales y n/ñ pasan a comodín de 1 carácter)
  const like = `%${term.replace(/[%_]/g, '').replace(/[aáàäeéèëiíìïoóòöuúùünñ]/gi, '_')}%`

  const [{ data: banks }, sheet, platform, kutxa] = await Promise.all([
    supabase.from('banks').select('id, name'),
    n
      ? supabase.from('sheet_rows').select('opportunity_id, nombre_cliente, bank_id').or(`opportunity_id.eq.${n},bank_deal_id.eq.${n}`).limit(50)
      : supabase.from('sheet_rows').select('opportunity_id, nombre_cliente, bank_id').ilike('nombre_cliente', like).limit(50),
    n
      ? supabase.from('platform_dispatches').select('deal_id, person_name, bank_name').or(`deal_id.eq.${n},bank_deal_id.eq.${n}`).limit(20)
      : supabase.from('platform_dispatches').select('deal_id, person_name, bank_name').ilike('person_name', like).limit(20),
    n
      ? supabase.from('kutxabank_submissions').select('deal_id, nombre_cliente').or(`deal_id.eq.${n},bank_deal_id.eq.${n}`).limit(5)
      : isDni
        ? supabase.from('kutxabank_submissions').select('deal_id, nombre_cliente').ilike('dni', term.replace(/[\s-]/g, '')).limit(5)
        : supabase.from('kutxabank_submissions').select('deal_id, nombre_cliente').ilike('nombre_cliente', like).limit(5),
  ])
  const bankName = new Map((banks ?? []).map((b) => [b.id, b.name as string]))
  const byOpp = new Map<number, ClientHit>()
  const add = (opp: number | null, nombre: string | null, banco: string | null) => {
    if (!opp) return
    const hit = byOpp.get(opp) ?? { opportunity_id: opp, nombre: null, bancos: [], enlace_pipedrive: pipedriveUrl(opp) }
    if (!hit.nombre && nombre) hit.nombre = nombre
    if (banco && !hit.bancos.includes(banco)) hit.bancos.push(banco)
    byOpp.set(opp, hit)
  }
  for (const r of sheet.data ?? []) add(r.opportunity_id, r.nombre_cliente, bankName.get(r.bank_id) ?? null)
  for (const r of platform.data ?? []) add(r.deal_id, r.person_name, r.bank_name)
  for (const r of kutxa.data ?? []) add(r.deal_id, r.nombre_cliente, 'Kutxabank')

  // DNI o nº sin resultados en el Command Center: probar en Pipedrive (deal general)
  if (byOpp.size === 0 && (isDni || n)) {
    const found = await pipedriveGet(`deals/search?term=${encodeURIComponent(term)}&exact_match=false&limit=5`)
    const items = (found?.items as Array<{ item: { id: number; title: string } }> | undefined) ?? []
    for (const it of items) add(it.item.id, it.item.title, null)
    // Completar con los bancos que el Command Center tiene para esos deals (la búsqueda de Pipedrive no los trae)
    const ids = [...byOpp.keys()]
    if (ids.length) {
      const [s2, p2, k2] = await Promise.all([
        supabase.from('sheet_rows').select('opportunity_id, nombre_cliente, bank_id').in('opportunity_id', ids),
        supabase.from('platform_dispatches').select('deal_id, person_name, bank_name').in('deal_id', ids),
        supabase.from('kutxabank_submissions').select('deal_id, nombre_cliente').in('deal_id', ids),
      ])
      for (const r of s2.data ?? []) add(r.opportunity_id, r.nombre_cliente, bankName.get(r.bank_id) ?? null)
      for (const r of p2.data ?? []) add(r.deal_id, r.person_name, r.bank_name)
      for (const r of k2.data ?? []) add(r.deal_id, r.nombre_cliente, 'Kutxabank')
    }
  }
  return [...byOpp.values()].slice(0, 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// Deal de Pipedrive (general + bancarios)
// ─────────────────────────────────────────────────────────────────────────────

export interface DealInfo {
  opportunity_id: number
  titulo: string | null
  cliente: string | null
  owner: string | null
  etapa_id: number | null
  estado: string | null
  md: string | null
  carpeta_drive: string | null
  dossier_creado: string | null
  enlace_dossier_pipedrive: string | null
  enlace_pipedrive: string
  deals_bancarios: Array<{ id: number; titulo: string | null; etapa_id: number | null; estado: string | null; bank_mail: string | null; enlace: string }>
}

export async function getDealInfo(opportunityId: number): Promise<DealInfo | null> {
  const d = await pipedriveGet(`deals/${opportunityId}`)
  if (!d) return null
  const bankIds = new Set<number>()
  BANK_ID_FIELD_IDS.forEach((f, i) => {
    const id = num(d[f]) ?? num(String(d[BANK_LINK_FIELD_IDS[i]] ?? '').match(/deal\/(\d+)/)?.[1])
    if (id) bankIds.add(id)
  })
  const bankDeals = await Promise.all([...bankIds].slice(0, 6).map(async (id) => {
    const b = await pipedriveGet(`deals/${id}`)
    return {
      id,
      titulo: (b?.title as string) ?? null,
      etapa_id: num(b?.stage_id),
      estado: (b?.status as string) ?? null,
      bank_mail: (val(b?.[F.bankMail]) as string) || null,
      enlace: pipedriveUrl(id),
    }
  }))
  const person = d.person_id as { name?: string } | null
  const owner = d.user_id as { name?: string } | null
  return {
    opportunity_id: opportunityId,
    titulo: (d.title as string) ?? null,
    cliente: person?.name ?? (d.person_name as string) ?? null,
    owner: owner?.name ?? null,
    etapa_id: num(d.stage_id),
    estado: (d.status as string) ?? null,
    md: (val(d[F.md]) as string) || null,
    carpeta_drive: (val(d[F.folder]) as string) || null,
    dossier_creado: (val(d[F.dossierCreado]) as string) || null,
    enlace_dossier_pipedrive: (val(d[F.linkDossier]) as string) || null,
    enlace_pipedrive: pipedriveUrl(opportunityId),
    deals_bancarios: bankDeals,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ficha del cliente en el Command Center
// ─────────────────────────────────────────────────────────────────────────────

export async function getClientRecords(supabase: Admin, opportunityId: number, bankDealIds: number[] = []) {
  const dealIds = [opportunityId, ...bankDealIds]
  const [banks, sheet, platform, kutxa, responses, dispatches, events, redFlags] = await Promise.all([
    supabase.from('banks').select('id, slug, name'),
    supabase
      .from('sheet_rows')
      .select('id, bank_id, opportunity_id, bank_deal_id, nombre_cliente, uid, status, status_raw, process_status, notas, send_trigger, autorizacion, autorizacion_red_flag, red_flags_raw, timestamp_sent, timestamp_entry, link_dossier, dossier, auto_bayteca, auto_banco, test_time, owner, is_discarded, pipedrive_lost, synced_at')
      .eq('opportunity_id', opportunityId),
    supabase.from('platform_dispatches').select('bank_name, bank_deal_id, sent_at, sent_by, dismissed_at, created_at').eq('deal_id', opportunityId),
    supabase.from('kutxabank_submissions').select('bank_deal_id, plan, missing_docs, rastreator_status, sent_at, zip_drive_link, dismissed_at, updated_at').eq('deal_id', opportunityId),
    supabase
      .from('bank_responses')
      .select('bank_slug, received_at, subject, classification, summary, required_action, lost_reason, status, match_status, error_message, bank_deal_id')
      .or(`general_deal_id.in.(${dealIds.join(',')}),bank_deal_id.in.(${dealIds.join(',')})`)
      .order('received_at', { ascending: false })
      .limit(20),
    supabase.from('dossier_dispatches').select('bank_slug, claimed_at, attempts, forced, blocked_count, last_blocked_at').eq('opportunity_id', opportunityId),
    supabase
      .from('flow_events')
      .select('bank_slug, workflow, step, kind, severity, message, detail, created_at')
      .or(`opportunity_id.eq.${opportunityId},bank_deal_id.in.(${dealIds.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('red_flag_events').select('bank_id, raw_text, normalized_reason').eq('opportunity_id', opportunityId).limit(20),
  ])
  const bankById = new Map((banks.data ?? []).map((b) => [b.id, b]))
  const dealTxt = dealIds.map(String)
  const sheetIds = (sheet.data ?? []).map((r) => r.id)
  const [caixaEstado, caixaPeticiones, kutxaEstados, relaunches, notesSheet, notesPlatform, notesKutxa] = await Promise.all([
    supabase
      .from('caixa_processed')
      .select('numero_peticion, deal_id, processed_at, estado_del_lead, motivo_pendiente, resolucion, resolution_text, marked_lost, error_message')
      .in('deal_id', dealTxt)
      .order('processed_at', { ascending: false })
      .limit(10),
    supabase.from('caixa_requests_responses').select('oportunidad_caixa, id_bayteca, processed_at, error_message').in('id_bayteca', dealTxt).limit(10),
    supabase
      .from('kutxabank_estados_processed')
      .select('deal_id, bank_deal_id, estado_rastreator, otros_comentarios, marked_won, processed_at')
      .or(`deal_id.in.(${dealIds.join(',')}),bank_deal_id.in.(${dealIds.join(',')})`)
      .order('processed_at', { ascending: false })
      .limit(10),
    supabase
      .from('event_log')
      .select('event_type, bank_id, actor, payload, created_at')
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false })
      .limit(15),
    sheetIds.length
      ? supabase.from('submission_notes').select('sheet_row_id, content, created_at').in('sheet_row_id', sheetIds).order('created_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as Array<{ sheet_row_id: string; content: string; created_at: string }> }),
    supabase
      .from('platform_dispatch_notes')
      .select('content, created_at, platform_dispatches!inner(deal_id, bank_name)')
      .eq('platform_dispatches.deal_id', opportunityId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('kutxabank_submission_notes')
      .select('content, created_at, kutxabank_submissions!inner(deal_id)')
      .eq('kutxabank_submissions.deal_id', opportunityId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  const sheetBank = new Map((sheet.data ?? []).map((r) => [r.id, bankById.get(r.bank_id)?.name ?? null]))
  const notasEquipo = [
    ...((notesSheet.data ?? []) as Array<{ sheet_row_id: string; content: string; created_at: string }>).map((n) => ({ banco: sheetBank.get(n.sheet_row_id) ?? null, origen: 'hoja', nota: n.content, fecha: n.created_at })),
    ...((notesPlatform.data ?? []) as unknown as Array<{ content: string; created_at: string; platform_dispatches: { bank_name: string } }>).map((n) => ({ banco: n.platform_dispatches?.bank_name ?? null, origen: 'envío por plataforma', nota: n.content, fecha: n.created_at })),
    ...((notesKutxa.data ?? []) as Array<{ content: string; created_at: string }>).map((n) => ({ banco: 'Kutxabank', origen: 'Kutxabank', nota: n.content, fecha: n.created_at })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha))
  return {
    notas_equipo_command_center: notasEquipo,
    caixabank_estado_peticion: caixaEstado.data ?? [],
    caixabank_peticiones_registradas: caixaPeticiones.data ?? [],
    // Algunas filas antiguas tienen un DNI o un importe en vez del estado (Excel desplazado): no son estados reales
    kutxabank_estados_rastreator: (kutxaEstados.data ?? []).filter((e) => /[a-záéíóú]{3}/i.test(e.estado_rastreator ?? '') && !/^[XYZ]?\d{6,9}[A-Z]$/i.test(e.estado_rastreator ?? '')),
    historial_relanzamientos: (relaunches.data ?? [])
      .filter((e) => e.event_type !== 'sync')
      .map((e) => ({ ...e, banco: e.bank_id ? bankById.get(e.bank_id)?.name ?? null : null })),
    filas_hoja: (sheet.data ?? []).map((r) => ({ ...r, banco: bankById.get(r.bank_id)?.name ?? null, bank_slug: bankById.get(r.bank_id)?.slug ?? null })),
    envios_plataforma: platform.data ?? [],
    kutxabank: kutxa.data ?? [],
    respuestas_banco: responses.data ?? [],
    reservas_envio: dispatches.data ?? [],
    eventos_flujo: events.error ? [] : (events.data ?? []),
    red_flags: (redFlags.data ?? []).map((r) => ({ ...r, banco: bankById.get(r.bank_id)?.name ?? null })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Documentos de la carpeta de Drive (vía webhook de n8n, que tiene acceso a Drive)
// ─────────────────────────────────────────────────────────────────────────────

export interface DriveFile {
  name: string
  size_mb: number | null
  mime: string | null
  created: string | null
  link: string | null
  code: string | null      // C003…D008
  is_dossier: boolean
}

const DOC_CODES: Record<string, string> = {
  C003: 'DNI/NIE 1er titular', C004: 'Vida laboral 1er titular', C005: 'Nóminas 1er titular', C006: 'Contrato 1er titular',
  C007: 'IRPF 1er titular', C008: 'Movimientos 1er titular', D003: 'DNI/NIE 2º titular', D004: 'Vida laboral 2º titular',
  D005: 'Nóminas 2º titular', D006: 'Contrato 2º titular', D007: 'IRPF 2º titular', D008: 'Movimientos 2º titular',
}

export async function listDriveFolder(folderLink: string | null): Promise<{ ok: boolean; error?: string; files: DriveFile[] }> {
  const url = process.env.ALMA_N8N_DOCS_URL
  const secret = process.env.OFFERS_API_SECRET
  if (!folderLink) return { ok: false, error: 'El deal no tiene carpeta de Drive (campo "Documents link" vacío).', files: [] }
  if (!url || !secret) return { ok: false, error: 'Consulta de Drive no configurada (ALMA_N8N_DOCS_URL).', files: [] }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-offers-secret': secret },
      body: JSON.stringify({ folder_link: folderLink }),
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) return { ok: false, error: `Drive respondió ${res.status}`, files: [] }
    const data = (await res.json()) as { files?: Array<Record<string, unknown>> }
    const files = (data.files ?? []).map((f) => {
      const name = String(f.name ?? '')
      const size = Number(f.size ?? NaN)
      const code = name.match(/\b([CD]00[3-8])\b/)?.[1] ?? null
      return {
        name,
        size_mb: Number.isFinite(size) ? Math.round((size / 1048576) * 10) / 10 : null,
        mime: (f.mimeType as string) ?? null,
        created: (f.createdTime as string) ?? null,
        link: (f.webViewLink as string) ?? null,
        code,
        is_dossier: /€\s*MD/i.test(name) || /^dossier/i.test(name),
      }
    })
    return { ok: true, files }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'error', files: [] }
  }
}

export function summarizeDocs(files: DriveFile[]) {
  const present = new Set(files.map((f) => f.code).filter(Boolean) as string[])
  return {
    documentos: Object.entries(DOC_CODES).map(([code, label]) => {
      const fs = files.filter((f) => f.code === code)
      return {
        codigo: code,
        documento: label,
        presente: present.has(code),
        archivos: fs.map((f) => ({ nombre: f.name, mb: f.size_mb, vacio: f.size_mb === 0, enlace: f.link })),
      }
    }),
    dossieres: files.filter((f) => f.is_dossier).map((f) => ({ nombre: f.name, mb: f.size_mb, creado: f.created, enlace: f.link, supera_limite_gmail_25mb: (f.size_mb ?? 0) > 25 })),
    autorizaciones: files.filter((f) => /autorizaci/i.test(f.name)).map((f) => ({ nombre: f.name, mb: f.size_mb, enlace: f.link })),
    otros: files.filter((f) => !f.code && !f.is_dossier && !/autorizaci/i.test(f.name)).map((f) => ({ nombre: f.name, mb: f.size_mb, enlace: f.link })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tickets de Request Hub (otro proyecto de Supabase)
// ─────────────────────────────────────────────────────────────────────────────

const RH_STATUS: Record<string, string> = {
  new: 'nuevo', in_progress: 'en curso', waiting_on_employee: 'esperando al empleado', resolved: 'resuelto', closed: 'cerrado',
}

export async function getTickets(dealIds: number[]) {
  const url = process.env.REQUEST_HUB_SUPABASE_URL
  const key = process.env.REQUEST_HUB_SUPABASE_SERVICE_KEY
  if (!url || !key) return { ok: false, error: 'Request Hub no configurado', tickets: [] as unknown[] }
  const rh = createSupabase(url, key, { auth: { persistSession: false } })
  const { data, error } = await rh
    .from('tickets')
    .select('id, display_id, subject, status, priority, bank_name, client_name, pipedrive_deal_id, sla_deadline, created_at, updated_at, resolved_at, assignee:profiles!tickets_assignee_id_fkey(first_name, last_name, email), category:categories(name)')
    .in('pipedrive_deal_id', dealIds)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    // Si la relación con nombre no existe, repetir sin joins
    const plain = await rh
      .from('tickets')
      .select('id, display_id, subject, status, priority, bank_name, client_name, pipedrive_deal_id, sla_deadline, created_at, updated_at, resolved_at, assignee_id')
      .in('pipedrive_deal_id', dealIds)
      .order('created_at', { ascending: false })
      .limit(20)
    if (plain.error) return { ok: false, error: plain.error.message, tickets: [] }
    return { ok: true, tickets: (plain.data ?? []).map((t) => ({ ...t, estado: RH_STATUS[t.status] ?? t.status })) }
  }
  const ids = (data ?? []).map((t) => t.id)
  const { data: comments } = ids.length
    ? await rh.from('ticket_comments').select('ticket_id, body, created_at').in('ticket_id', ids).eq('visibility', 'public').order('created_at', { ascending: false }).limit(60)
    : { data: [] as Array<{ ticket_id: string; body: string; created_at: string }> }
  return {
    ok: true,
    tickets: (data ?? []).map((t) => ({
      ...t,
      estado: RH_STATUS[t.status] ?? t.status,
      abierto: ['new', 'in_progress', 'waiting_on_employee'].includes(t.status),
      ultimos_comentarios: (comments ?? []).filter((c) => c.ticket_id === t.id).slice(0, 3).map((c) => ({ fecha: c.created_at, texto: c.body.slice(0, 400) })),
    })),
  }
}

/** Cola de tickets abiertos de Request Hub (todo el equipo), con filtros opcionales. */
export async function getOpenTickets(opts: { banco?: string | null; asignado?: string | null; solo_vencidos?: boolean }) {
  const url = process.env.REQUEST_HUB_SUPABASE_URL
  const key = process.env.REQUEST_HUB_SUPABASE_SERVICE_KEY
  if (!url || !key) return { ok: false, error: 'Request Hub no configurado' }
  const rh = createSupabase(url, key, { auth: { persistSession: false } })
  const data: Array<Record<string, unknown> & { display_id: string; subject: string; status: string; priority: string; bank_name: string | null; client_name: string | null; pipedrive_deal_id: number | null; sla_deadline: string | null; created_at: string }> = []
  for (let off = 0; off < 10000; off += 1000) {
    const page = await rh
      .from('tickets')
      .select('display_id, subject, status, priority, bank_name, client_name, pipedrive_deal_id, sla_deadline, created_at, assignee:profiles!tickets_assignee_id_fkey(first_name, last_name, email), category:categories(name)')
      .in('status', ['new', 'in_progress', 'waiting_on_employee'])
      .order('created_at', { ascending: true })
      .range(off, off + 999)
    if (page.error) return { ok: false, error: page.error.message }
    data.push(...(page.data as unknown as typeof data))
    if ((page.data ?? []).length < 1000) break
  }
  const now = Date.now()
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const bancoQ = norm(opts.banco ?? '')
  const asigQ = norm(opts.asignado ?? '')
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  const rows = data.map((t) => {
    const a = one(t.assignee as unknown as { first_name: string | null; last_name: string | null; email: string | null } | null)
    const c = one(t.category as unknown as { name: string } | null)
    return {
      ticket: t.display_id,
      asunto: t.subject,
      automatico: /^\[auto\]/i.test(t.subject ?? ''),
      estado: RH_STATUS[t.status] ?? t.status,
      prioridad: t.priority,
      banco: t.bank_name,
      cliente: t.client_name,
      deal: t.pipedrive_deal_id,
      categoria: c?.name ?? null,
      asignado: a ? [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email : null,
      asignado_email: a?.email ?? null,
      sla_vencido: t.sla_deadline ? Date.parse(t.sla_deadline) < now : false,
      dias_abierto: Math.floor((now - Date.parse(t.created_at)) / 86400_000),
    }
  })
  const filtered = rows.filter(
    (t) =>
      (!bancoQ || norm(t.banco ?? '').includes(bancoQ)) &&
      (!asigQ || (asigQ === 'sin asignar' ? !t.asignado : norm(`${t.asignado ?? ''} ${t.asignado_email ?? ''}`).includes(asigQ))) &&
      (!opts.solo_vencidos || t.sla_vencido),
  )
  const count = (f: (t: (typeof rows)[number]) => string) => {
    const c: Record<string, number> = {}
    for (const t of filtered) c[f(t)] = (c[f(t)] ?? 0) + 1
    return Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]))
  }
  const manuales = filtered.filter((t) => !t.automatico)
  const brief = (t: (typeof rows)[number]) => {
    const copy: Partial<typeof t> = { ...t }
    delete copy.asignado_email
    delete copy.automatico
    return copy
  }
  return {
    ok: true,
    total_abiertos: filtered.length,
    automaticos: filtered.length - manuales.length,
    manuales: manuales.length,
    sla_vencidos: filtered.filter((t) => t.sla_vencido).length,
    por_estado: count((t) => t.estado),
    por_asignado: count((t) => t.asignado ?? 'sin asignar'),
    por_categoria: count((t) => t.categoria ?? 'sin categoría'),
    por_banco: Object.fromEntries(Object.entries(count((t) => t.banco ?? 'sin banco')).slice(0, 12)),
    manuales_mas_antiguos: manuales.slice(0, 12).map(brief),
    manuales_mas_recientes: manuales.slice(-8).reverse().map(brief),
    nota: 'Los tickets «[Auto] … Overdue» los crea el sistema cuando una tasación/FEIN pasa de plazo; los «manuales» los abre una persona.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Métricas
// ─────────────────────────────────────────────────────────────────────────────

export async function getMetrics(supabase: Admin, dias: number) {
  const d = Math.min(Math.max(Math.round(dias) || 1, 1), 90)
  const from = madridDayStart(d)
  const to = madridDayStart(0)
  const [envios, envios_hoy, respuestas, respuestasHoy, caixa, kutxa] = await Promise.all([
    dossierSends(supabase, from, to),
    dossierSends(supabase, to, new Date(Date.now() + 60_000)),
    supabase.rpc('bank_responses_summary', { p_since: from.toISOString() }),
    supabase.from('bank_responses').select('bank_slug, classification').gte('received_at', to.toISOString()).limit(1000),
    caixaPipeline(supabase, from),
    supabase.from('kutxabank_estados_processed').select('estado_rastreator').gte('processed_at', from.toISOString()).limit(1000),
  ])
  const kutxaCount: Record<string, number> = {}
  for (const r of kutxa.data ?? []) {
    const e = String(r.estado_rastreator ?? '')
    if (!/[a-záéíóú]{3}/i.test(e) || /^[XYZ]?\d{6,9}[A-Z]$/i.test(e)) continue
    kutxaCount[e] = (kutxaCount[e] ?? 0) + 1
  }
  const TIPO: Record<string, string> = { offer: 'ofertas', more_info: 'mas_info', rejection: 'rechazos', other: 'otros' }
  const hoy: Record<string, Record<string, number>> = {}
  const porTipo: Record<string, number> = { ofertas: 0, mas_info: 0, rechazos: 0, otros: 0 }
  for (const r of respuestasHoy.data ?? []) {
    const b = String(r.bank_slug ?? 'sin banco')
    const c = TIPO[String(r.classification)] ?? 'otros'
    hoy[b] ??= {}
    hoy[b][c] = (hoy[b][c] ?? 0) + 1
    porTipo[c] += 1
  }
  const ofertasPorBanco = Object.fromEntries(
    Object.entries(hoy).filter(([, v]) => v.ofertas).map(([b, v]) => [b, v.ofertas] as const).sort((a, b) => b[1] - a[1]),
  )
  return {
    respuestas_bancos_hoy: { total: (respuestasHoy.data ?? []).length, por_tipo: porTipo, ofertas_por_banco: ofertasPorBanco, por_banco_y_tipo: hoy },
    caixabank: caixa,
    kutxabank_estados_rastreator_en_periodo: kutxaCount,
    periodo: `últimos ${d} día(s) completos (hora de Madrid) + hoy`,
    envios_dossier: { total: envios.total, por_banco: envios.por_banco },
    envios_hoy: { total: envios_hoy.total, por_banco: envios_hoy.por_banco },
    respuestas_bancos_periodo_incluye_hoy: respuestas.data ?? [],
    nota: `Los bancos por plataforma (${PLATFORM_BANKS.join(', ')}) cuentan lo marcado como enviado en "Envíos por plataforma".`,
  }
}

/** Foto de las peticiones de CaixaBank (último estado conocido de cada una) y cambios de estado en el periodo. */
async function caixaPipeline(supabase: Admin, from: Date) {
  const rows: Array<{ numero_peticion: string; estado_del_lead: string | null; motivo_pendiente: string | null; resolucion: string | null; processed_at: string }> = []
  for (let off = 0; off < 20000; off += 1000) {
    const { data, error } = await supabase
      .from('caixa_processed')
      .select('numero_peticion, estado_del_lead, motivo_pendiente, resolucion, processed_at')
      .order('processed_at', { ascending: true })
      .range(off, off + 999)
    if (error || !data) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  const latest = new Map<string, (typeof rows)[number]>()
  for (const r of rows) latest.set(r.numero_peticion, r)
  const count = (list: Iterable<string>) => {
    const c: Record<string, number> = {}
    for (const k of list) c[k] = (c[k] ?? 0) + 1
    return Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]))
  }
  const actuales = [...latest.values()]
  const enPeriodo = rows.filter((r) => Date.parse(r.processed_at) >= from.getTime())
  return {
    peticiones_total: latest.size,
    estado_actual: count(actuales.map((r) => r.estado_del_lead || 'sin estado')),
    motivos_pendientes_actuales_sia_en_curso: count(actuales.filter((r) => /SIA EN CURSO/i.test(r.estado_del_lead ?? '') && r.motivo_pendiente).map((r) => String(r.motivo_pendiente))),
    cambios_de_estado_en_periodo: count(enPeriodo.map((r) => r.estado_del_lead || 'sin estado')),
    motivos_cierre_en_periodo: count(enPeriodo.filter((r) => /CERRADA/i.test(r.estado_del_lead ?? '') && r.resolucion).map((r) => String(r.resolucion))),
    ultima_actualizacion: rows.length ? rows[rows.length - 1].processed_at : null,
    nota: 'Datos del Excel de CaixaBank subido en la página Caixa; solo cambia cuando alguien sube un Excel nuevo.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Colas del equipo (no por persona: "lo mío" = lo del equipo)
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_SHEET_STATUSES = ['pending_ready', 'sending', 'failed', 'blocked_red_flag', 'blocked_missing_docs', 'blocked_validation', 'relaunch_requested', 'unknown']

/** Envíos que se pidieron (Enviar=Yes/Autorización) y no constan enviados, por plataforma pendientes y Kutxabank pendientes. */
export async function getPendingSends(
  supabase: Admin,
  opts: { banco?: string | null; owner?: string | null; dias?: number },
  diagnoseRow: (row: Record<string, unknown>) => { motivo: string; explicacion: string; es_tecnico: boolean },
) {
  const dias = Math.min(Math.max(Math.round(opts.dias ?? 21) || 21, 1), 90)
  const since = new Date(Date.now() - dias * 86400_000).toISOString()
  const bancoQ = (opts.banco || '').trim().toLowerCase()
  const ownerQ = (opts.owner || '').trim().toLowerCase()

  const [banks, sheet, platform, kutxa] = await Promise.all([
    supabase.from('banks').select('id, slug, name'),
    supabase
      .from('sheet_rows')
      .select('bank_id, opportunity_id, nombre_cliente, owner, status, status_raw, process_status, notas, send_trigger, autorizacion, autorizacion_red_flag, red_flags_raw, uid, timestamp_sent, created_at, is_discarded, pipedrive_lost')
      .in('status', OPEN_SHEET_STATUSES)
      .is('timestamp_sent', null)
      .gte('created_at', since)
      .limit(1000),
    supabase.from('platform_dispatches').select('bank_name, deal_id, person_name, created_at').is('sent_at', null).is('dismissed_at', null).gte('created_at', since).limit(500),
    supabase.from('kutxabank_submissions').select('deal_id, nombre_cliente, missing_docs, created_at').is('sent_at', null).is('dismissed_at', null).gte('created_at', since).limit(200),
  ])
  const bankById = new Map((banks.data ?? []).map((b) => [b.id, b]))

  type Item = { cliente: string | null; opportunity_id: number; banco: string; motivo: string; detalle: string; tecnico: boolean; owner: string | null; desde: string }
  const items: Item[] = []
  for (const r of sheet.data ?? []) {
    if (r.is_discarded || r.pipedrive_lost) continue
    if (!r.send_trigger && !String(r.autorizacion ?? '').toLowerCase().startsWith('yes')) continue // no se ha pedido el envío
    const b = bankById.get(r.bank_id)
    const banco = b?.name ?? String(r.bank_id)
    if (bancoQ && !banco.toLowerCase().includes(bancoQ) && !(b?.slug ?? '').includes(bancoQ)) continue
    if (ownerQ && !String(r.owner ?? '').toLowerCase().includes(ownerQ)) continue
    const d = diagnoseRow({ ...r, banco, bank_slug: b?.slug })
    items.push({ cliente: r.nombre_cliente, opportunity_id: r.opportunity_id, banco, motivo: d.motivo, detalle: d.explicacion, tecnico: d.es_tecnico, owner: r.owner, desde: r.created_at })
  }
  for (const p of platform.data ?? []) {
    if (bancoQ && !String(p.bank_name).toLowerCase().includes(bancoQ)) continue
    if (ownerQ) continue // la plataforma no guarda owner
    items.push({ cliente: p.person_name, opportunity_id: p.deal_id, banco: p.bank_name, motivo: 'platform_pending', detalle: 'Pendiente de enviar por la plataforma del banco y marcar en "Envíos por plataforma".', tecnico: false, owner: null, desde: p.created_at })
  }
  for (const k of kutxa.data ?? []) {
    if (bancoQ && !'kutxabank'.includes(bancoQ)) continue
    if (ownerQ) continue
    const missing = (k.missing_docs as string[] | null) ?? []
    items.push({ cliente: k.nombre_cliente, opportunity_id: k.deal_id, banco: 'Kutxabank', motivo: missing.length ? 'missing_docs' : 'platform_pending', detalle: missing.length ? `Faltan: ${missing.join(', ')}` : 'Pendiente de enviar a Rastreator.', tecnico: false, owner: null, desde: k.created_at })
  }

  const count = (key: (i: Item) => string) => Object.entries(items.reduce<Record<string, number>>((acc, i) => ((acc[key(i)] = (acc[key(i)] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ [k]: n }))
  const BLOQUEO = new Set(['dossier_too_big', 'gmail_error', 'n8n_flow_inactive', 'n8n_error', 'apps_script_error', 'sheet_blocked', 'antidup_blocked', 'red_flag', 'missing_docs', 'no_result'])
  const sorted = items.sort((a, b) => Number(BLOQUEO.has(b.motivo)) - Number(BLOQUEO.has(a.motivo)) || a.desde.localeCompare(b.desde))
  return {
    periodo: `filas creadas en los últimos ${dias} días`,
    total: items.length,
    bloqueados: items.filter((i) => BLOQUEO.has(i.motivo)).length,
    por_motivo: count((i) => i.motivo),
    por_banco: count((i) => i.banco),
    lista: sorted.slice(0, 40).map((i) => ({ ...i, desde: i.desde.slice(0, 10), enlace: pipedriveUrl(i.opportunity_id) })),
    nota: items.length > 40 ? `Se muestran 40 de ${items.length}; filtra por banco u owner para ver el resto.` : undefined,
  }
}

/** Cola «Requieren atención» de Ofertas recibidas (respuestas sin vincular, con error o en revisión manual). */
export async function getPendingOffers(supabase: Admin, opts: { banco?: string | null }) {
  const bancoQ = (opts.banco || '').trim().toLowerCase()
  const { data, error } = await supabase
    .from('bank_responses')
    .select('bank_slug, client_name, subject, classification, status, match_status, error_message, received_at, bank_deal_id, general_deal_id')
    .neq('status', 'resolved')
    .or('status.in.(error,manual_review),match_status.neq.matched')
    .order('received_at', { ascending: false })
    .limit(200)
  if (error) return { error: error.message }
  const rows = (data ?? []).filter((r) => !bancoQ || r.bank_slug.includes(bancoQ.replace(/\s+/g, '_')))
  const porBanco = Object.entries(rows.reduce<Record<string, number>>((a, r) => ((a[r.bank_slug] = (a[r.bank_slug] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1])
  return {
    total: rows.length,
    por_banco: porBanco.map(([b, n]) => ({ [b]: n })),
    lista: rows.slice(0, 30).map((r) => ({
      banco: r.bank_slug,
      cliente: r.client_name,
      asunto: r.subject,
      tipo: r.classification,
      motivo: r.status === 'error' ? `error: ${r.error_message ?? ''}`.slice(0, 160) : r.match_status !== 'matched' ? 'sin vincular a un deal' : (r.error_message ?? 'revisión manual').slice(0, 160),
      recibido: r.received_at?.slice(0, 16),
      deal: r.bank_deal_id ?? r.general_deal_id,
    })),
    donde: 'Command Center → Ofertas recibidas → «Requieren atención»',
  }
}
