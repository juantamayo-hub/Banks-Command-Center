/**
 * Solo servidor. Asignación de gestores de Santander (migración 032).
 *
 * Santander contesta al informe diario de activaciones con un Excel: Nombre cliente, DNI, …, Gestor Asignado.
 * Por cada fila:
 *   1. Busca el DEAL BANCARIO de Santander en el pipeline 7 (por DNI: santander_reports del Request Hub y, si no,
 *      búsqueda en Pipedrive). Si el id apunta a otro pipeline (p. ej. el deal general), busca el deal bancario
 *      Santander de la misma persona. Debe salir exactamente uno; si no → deal_not_found. Nunca escribe en un deal dudoso.
 *   2. Cruza el nombre del gestor con bank_agents.
 *   3. Gestor conocido → "Bank Mail / Email agente bancario" + nota + comentario en el ticket del Request Hub,
 *      que queda solucionado (status closed) si seguía abierto.
 *      Gestor desconocido → pending_agent + nota + aviso (DM del Request Hub con botón para añadir el correo).
 * Escribe en Pipedrive SIEMPRE como Hipotecas Bayteca (PIPEDRIVE_API_TOKEN_HIPOTECAS); nunca con otro token.
 * Idempotente: UNIQUE(bank_slug, dni, agent_key) en bank_agent_assignments; lo ya asignado no se repite.
 */

import { hubCloseTicket, hubComment, hubNotifyAssignmentIssue, hubTicketsForDeal } from '@/lib/requestHub'
import type { AdminClient } from '@/lib/bankConfigAuth'

export const SANTANDER = 'santander'
const BANK_PIPELINE_ID = 7
const BANK_NAME_FIELD = 'c3a445b9bf0422b9db09abc776cf2dc281b7e975'   // "Bank Name / Nombre del Banco"
const BANK_MAIL_FIELD = '498dd83b5c5e1f1181c232131933717ceadfda34'   // "Bank Mail / Email agente bancario"
const SANTANDER_NAMES = ['santander', 'bsch']
// Request Hub: categoría "Contactar con el cliente (Banco)" — el ticket con el que se pide la activación a Santander
const HUB_CONTACT_CATEGORY_ID = '3eeac518-8cc2-408c-bfe2-7ada741924a4'
const HUB_OPEN_STATUSES = ['new', 'in_progress', 'waiting_on_employee']

// ── Normalización ────────────────────────────────────────────────────────────

/** "Carolina  Alonso-Ruiz" → "CAROLINA ALONSO RUIZ" (sin tildes ni signos) */
export function nameKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normDni(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export interface BankAgent {
  id: string
  bank_slug: string
  full_name: string
  name_key: string
  email: string
  active: boolean
}

/**
 * Gestor por nombre: coincidencia exacta; si no, la única cuyo nombre contiene TODAS las palabras recibidas
 * (Santander a veces recorta apellidos). Ambiguo o sin coincidencia → null.
 */
export function matchAgent(agents: BankAgent[], rawName: string): BankAgent | null {
  const key = nameKey(rawName)
  if (!key) return null
  const active = agents.filter((a) => a.active)
  const exact = active.find((a) => a.name_key === key)
  if (exact) return exact
  const words = key.split(' ')
  if (words.length < 2) return null
  const partial = active.filter((a) => {
    const aw = new Set(a.name_key.split(' '))
    return words.every((w) => aw.has(w))
  })
  return partial.length === 1 ? partial[0] : null
}

// ── Pipedrive (como Hipotecas Bayteca) ───────────────────────────────────────

function pdToken(): string {
  const t = process.env.PIPEDRIVE_API_TOKEN_HIPOTECAS
  if (!t) throw new Error('PIPEDRIVE_API_TOKEN_HIPOTECAS no configurado (las escrituras deben ir como Hipotecas Bayteca)')
  return t
}

async function pd<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`https://api.pipedrive.com/v1${path}${sep}api_token=${pdToken()}`, {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Pipedrive ${init?.method ?? 'GET'} ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

type PdDeal = Record<string, unknown> & {
  id: number
  title: string
  status: string
  pipeline_id: number
  person_id: { value: number } | number | null
}

function isSantanderBankDeal(d: PdDeal): boolean {
  if (d.pipeline_id !== BANK_PIPELINE_ID || d.status === 'deleted') return false
  const bankName = String(d[BANK_NAME_FIELD] ?? '').trim().toLowerCase()
  return SANTANDER_NAMES.includes(bankName) || d.title.trim().toLowerCase().startsWith('santander')
}

function personIdOf(d: PdDeal): number | null {
  const p = d.person_id
  if (!p) return null
  return typeof p === 'number' ? p : p.value ?? null
}

async function getDeal(id: number): Promise<PdDeal | null> {
  try {
    const r = await pd<{ data: PdDeal | null }>(`/deals/${id}`)
    return r.data
  } catch (e) {
    if (String(e).includes(' 404')) return null
    throw e
  }
}

/** Deals bancarios Santander (pipeline 7) de la persona. Si hay varios, solo cuentan los abiertos. */
async function santanderDealsOfPerson(personId: number): Promise<PdDeal[]> {
  const r = await pd<{ data: PdDeal[] | null }>(`/persons/${personId}/deals?status=all_not_deleted&limit=100`)
  const all = (r.data ?? []).filter(isSantanderBankDeal)
  const open = all.filter((d) => d.status === 'open')
  return all.length > 1 && open.length ? open : all
}

/** Ids candidatos por DNI: santander_reports del Request Hub (más reciente primero) y búsqueda en Pipedrive. */
async function candidateDealIds(dni: string): Promise<number[]> {
  const ids: number[] = []
  const url = process.env.REQUEST_HUB_SUPABASE_URL
  const key = process.env.REQUEST_HUB_SUPABASE_SERVICE_KEY
  if (url && key) {
    const res = await fetch(
      `${url}/rest/v1/santander_reports?select=pipedrive_deal_id&dni_1t=eq.${encodeURIComponent(dni)}&order=id.desc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    )
    if (res.ok) for (const r of (await res.json()) as { pipedrive_deal_id: number }[]) ids.push(Number(r.pipedrive_deal_id))
  }
  const s = await pd<{ data: { items: { item: { id: number } }[] } | null }>(
    `/deals/search?term=${encodeURIComponent(dni)}&fields=custom_fields&exact_match=true&limit=20`,
  )
  for (const it of s.data?.items ?? []) ids.push(it.item.id)
  return Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)))
}

export type DealLookup = { deal: PdDeal; via: string } | { error: string }

export async function findSantanderBankDeal(dni: string): Promise<DealLookup> {
  const ids = await candidateDealIds(dni)
  if (!ids.length) return { error: `Ningún deal con el DNI ${dni}` }

  const found = new Map<number, { deal: PdDeal; via: string }>()
  const persons = new Set<number>()
  for (const id of ids) {
    const d = await getDeal(id)
    if (!d) continue
    if (isSantanderBankDeal(d)) found.set(d.id, { deal: d, via: `deal ${id}` })
    const p = personIdOf(d)
    if (p) persons.add(p)
  }
  if (!found.size) {
    for (const p of persons) {
      for (const d of await santanderDealsOfPerson(p)) found.set(d.id, { deal: d, via: `persona ${p}` })
    }
  }
  if (found.size === 1) return Array.from(found.values())[0]
  if (!found.size) return { error: `El DNI ${dni} no tiene deal bancario de Santander en el pipeline ${BANK_PIPELINE_ID}` }
  const open = Array.from(found.values()).filter((f) => f.deal.status === 'open')
  if (open.length === 1) return open[0]
  return { error: `Varios deals bancarios de Santander para el DNI ${dni}: ${Array.from(found.keys()).join(', ')}` }
}

// ── Proceso de una fila ──────────────────────────────────────────────────────

export interface AssignmentRow {
  client_name?: string | null
  dni: string
  agent_name: string
}

export interface AssignmentResult {
  dni: string
  client_name: string | null
  agent_name: string
  status: 'assigned' | 'already_assigned' | 'pending_agent' | 'deal_not_found' | 'error' | 'skipped'
  bank_deal_id: number | null
  agent_email: string | null
  detail: string
  /** Solo en dryRun: lo que se haría */
  planned?: string[]
}

const DONE = new Set(['assigned', 'already_assigned'])

export async function processAssignment(
  db: AdminClient,
  agents: BankAgent[],
  row: AssignmentRow,
  opts: { dryRun?: boolean; messageId?: string | null; fileName?: string | null } = {},
): Promise<AssignmentResult> {
  const dni = normDni(row.dni)
  const agentKey = nameKey(row.agent_name ?? '')
  const base = { dni, client_name: row.client_name ?? null, agent_name: row.agent_name, bank_deal_id: null, agent_email: null }
  if (!dni || !agentKey) return { ...base, status: 'skipped', detail: 'Fila sin DNI o sin gestor' }

  const { data: prev } = await db
    .from('bank_agent_assignments')
    .select('*')
    .eq('bank_slug', SANTANDER).eq('dni', dni).eq('agent_key', agentKey)
    .maybeSingle()
  if (prev && DONE.has(prev.status)) {
    return { ...base, status: 'skipped', bank_deal_id: prev.bank_deal_id, agent_email: prev.agent_email, detail: 'Ya procesado' }
  }

  const planned: string[] = []
  let notifiedTo: string[] | null = null
  const avisoTxt = () => (notifiedTo ? ` · Aviso a: ${notifiedTo.join(', ') || 'nadie (sin destinatario)'}` : '')
  const save = async (r: Omit<AssignmentResult, 'planned'>, extra: Record<string, unknown> = {}) => {
    if (opts.dryRun) return { ...r, planned }
    const rec = {
      bank_slug: SANTANDER,
      source_message_id: opts.messageId ?? prev?.source_message_id ?? null,
      source_file: opts.fileName ?? prev?.source_file ?? null,
      client_name: r.client_name,
      dni,
      agent_name_raw: row.agent_name,
      agent_key: agentKey,
      agent_email: r.agent_email,
      bank_deal_id: r.bank_deal_id,
      status: r.status === 'skipped' ? 'error' : r.status,
      detail: r.detail,
      ...extra,
    }
    const { error } = await db.from('bank_agent_assignments').upsert(rec, { onConflict: 'bank_slug,dni,agent_key' })
    if (error) console.error('[santanderAgents] upsert', error.message)
    return r
  }

  try {
    // 1. Deal bancario
    const lookup = await findSantanderBankDeal(dni)
    if ('error' in lookup) {
      let notified = prev?.notified_at ?? null
      if (!opts.dryRun && !notified) {
        const to = await hubNotifyAssignmentIssue({
          type: 'deal_not_found', bank: SANTANDER, client_name: row.client_name ?? null, dni,
          agent_name: row.agent_name, deal_id: null, detail: lookup.error,
        }).catch(() => false as const)
        if (to) { notified = new Date().toISOString(); notifiedTo = to }
      }
      planned.push(`Aviso: ${lookup.error}`)
      return save({ ...base, status: 'deal_not_found', detail: lookup.error + avisoTxt() }, { notified_at: notified })
    }
    const deal = lookup.deal
    const dealId = deal.id

    // 2. Gestor
    const agent = matchAgent(agents, row.agent_name)
    if (!agent) {
      const detail = `«${row.agent_name}» no está en la lista de gestores de Santander`
      planned.push(`Nota en deal ${dealId}: gestor desconocido «${row.agent_name}»`, 'Aviso a quien gestiona Santander (Request Hub)')
      let noteId: number | null = prev?.pipedrive_note_id ?? null
      let notified = prev?.notified_at ?? null
      if (!opts.dryRun) {
        if (!noteId) {
          const n = await pd<{ data: { id: number } }>('/notes', {
            method: 'POST',
            body: JSON.stringify({
              deal_id: dealId,
              content: `⚠️ Santander ha asignado como gestor/a a «${row.agent_name}», que no está en la lista de gestores del Command Center. Pendiente de su correo para completar la asignación.`,
            }),
          })
          noteId = n.data?.id ?? null
        }
        if (!notified) {
          const to = await hubNotifyAssignmentIssue({
            type: 'agent_missing', bank: SANTANDER, client_name: row.client_name ?? null, dni,
            agent_name: row.agent_name, deal_id: dealId, detail,
          }).catch(() => false as const)
          if (to) { notified = new Date().toISOString(); notifiedTo = to }
        }
      }
      return save(
        { ...base, status: 'pending_agent', bank_deal_id: dealId, detail: detail + avisoTxt() },
        { pipedrive_note_id: noteId, notified_at: notified },
      )
    }

    // 3. Asignar (si no lo está ya)
    const current = String(deal[BANK_MAIL_FIELD] ?? '').trim().toLowerCase()
    if (current === agent.email.toLowerCase()) {
      // El gestor ya estaba escrito (p. ej. a mano): el ticket de la activación debe quedar solucionado igualmente
      let extra = ''
      if (opts.dryRun) planned.push('Si el ticket de la activación sigue abierto, marcarlo como solucionado')
      else {
        try {
          const tickets = await hubTicketsForDeal(dealId, true)
          const t = tickets.find((x) => x.category_id === HUB_CONTACT_CATEGORY_ID) ?? tickets[0]
          if (t?.status && HUB_OPEN_STATUSES.includes(t.status) && (await hubCloseTicket(t.id))) {
            extra = ` · ticket ${t.display_id ?? t.id} solucionado`
          }
        } catch (e) {
          extra = ` · Request Hub: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`
        }
      }
      return save({ ...base, status: 'already_assigned', bank_deal_id: dealId, agent_email: agent.email,
        detail: `El deal ${dealId} ya tenía a ${agent.email}${extra}` })
    }
    const noteText = `Gestor/a asignado/a SANTANDER: ${agent.full_name} — ${agent.email}` +
      (current ? `\n(antes: ${current})` : '')
    planned.push(`Deal ${dealId} (${deal.title}): Bank Mail = ${agent.email}${current ? ` (antes ${current})` : ''}`, `Nota: ${noteText}`)

    let noteId: number | null = null
    let ticketId: string | null = null
    let hubWarn = ''
    if (!opts.dryRun) {
      await pd(`/deals/${dealId}`, { method: 'PUT', body: JSON.stringify({ [BANK_MAIL_FIELD]: agent.email }) })
      const n = await pd<{ data: { id: number } }>('/notes', { method: 'POST', body: JSON.stringify({ deal_id: dealId, content: noteText }) })
      noteId = n.data?.id ?? null
      try {
        // Ticket de la activación (categoría "Contactar con el cliente (Banco)"); si no hay, el último del deal
        const tickets = await hubTicketsForDeal(dealId, true)
        const t = tickets.find((x) => x.category_id === HUB_CONTACT_CATEGORY_ID) ?? tickets[0]
        if (t) {
          await hubComment(t.id, `Gestor/a asignado/a por Santander: ${agent.full_name} (${agent.email}).`)
          ticketId = t.display_id ?? t.id
          // Con el gestor escrito, el ticket queda solucionado
          if (t.status && HUB_OPEN_STATUSES.includes(t.status)) {
            const closed = await hubCloseTicket(t.id)
            hubWarn += closed ? ` · ticket ${ticketId} solucionado` : ` · ticket ${ticketId} sin cerrar (Request Hub sin endpoint de cierre)`
          }
        }
      } catch (e) {
        hubWarn = ` · Request Hub: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`
      }
    } else {
      planned.push('Comentario en el ticket de la activación (Request Hub) y, si está abierto, marcarlo como solucionado')
    }
    return save(
      { ...base, status: 'assigned', bank_deal_id: dealId, agent_email: agent.email,
        detail: `Asignado en deal ${dealId} (${lookup.via})${hubWarn}` },
      { pipedrive_note_id: noteId, hub_ticket_id: ticketId },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return save({ ...base, status: 'error', detail: msg.slice(0, 300) })
  }
}

export async function loadAgents(db: AdminClient): Promise<BankAgent[]> {
  const { data, error } = await db.from('bank_agents').select('*').eq('bank_slug', SANTANDER)
  if (error) throw new Error(`bank_agents: ${error.message}`)
  return (data ?? []) as BankAgent[]
}

/**
 * Alta / actualización de un gestor y reproceso de sus asignaciones pendientes.
 * Lo usan la API (modal de Slack del Request Hub) y la UI de Configuración.
 */
export async function upsertAgentAndResolve(
  db: AdminClient,
  input: { name: string; email: string; actor: string },
): Promise<{ agent: BankAgent; resolved: AssignmentResult[] }> {
  const key = nameKey(input.name)
  const email = input.email.trim().toLowerCase()
  const { data: before } = await db.from('bank_agents').select('*').eq('bank_slug', SANTANDER).eq('name_key', key).maybeSingle()
  const { data: agent, error } = await db
    .from('bank_agents')
    .upsert(
      { bank_slug: SANTANDER, full_name: before?.full_name ?? input.name.trim(), name_key: key, email, active: true, updated_by: input.actor },
      { onConflict: 'bank_slug,name_key' },
    )
    .select('*')
    .single()
  if (error || !agent) throw new Error(error?.message ?? 'No se pudo guardar el gestor')
  await db.from('bank_config_history').insert({
    bank_slug: SANTANDER, table_name: 'bank_agents', record_key: key, action: before ? 'update' : 'insert',
    before, after: agent, actor: input.actor,
  })

  // Reprocesar pendientes de ese nombre (y de nombres que ahora casen con él)
  const agents = await loadAgents(db)
  const { data: pending } = await db
    .from('bank_agent_assignments')
    .select('dni, client_name, agent_name_raw, agent_key')
    .eq('bank_slug', SANTANDER).eq('status', 'pending_agent')
  const resolved: AssignmentResult[] = []
  for (const p of pending ?? []) {
    const m = matchAgent(agents, p.agent_name_raw)
    if (m?.id !== agent.id) continue
    resolved.push(await processAssignment(db, agents, { dni: p.dni, client_name: p.client_name, agent_name: p.agent_name_raw }))
  }
  return { agent: agent as BankAgent, resolved }
}
