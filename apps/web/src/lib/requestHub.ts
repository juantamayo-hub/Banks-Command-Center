/**
 * Solo servidor. Cliente mínimo de la API externa del Request Hub Bancos (otra app, otro repo y otro Supabase).
 * Autenticación: Bearer REQUEST_HUB_EXTERNAL_API_SECRET. Si no está configurado, las funciones no hacen nada.
 */

function config() {
  const base = process.env.REQUEST_HUB_BASE_URL
  const secret = process.env.REQUEST_HUB_EXTERNAL_API_SECRET
  return base && secret ? { base: base.replace(/\/$/, ''), secret } : null
}

/**
 * Último ticket del deal. Con includeClosed=true también los cerrados (requiere el parámetro include_closed en el
 * Request Hub; si aún no lo soporta, devuelve solo los abiertos, como antes).
 */
export async function hubTicketForDeal(dealId: number, includeClosed = true): Promise<{ id: string; display_id?: string } | null> {
  const c = config()
  if (!c) return null
  const res = await fetch(`${c.base}/api/external/tickets/deal/${dealId}${includeClosed ? '?include_closed=1' : ''}`, {
    headers: { Authorization: `Bearer ${c.secret}` },
  })
  if (res.status === 404 || res.status === 401 || res.status === 403) return null
  if (!res.ok) throw new Error(`Request Hub GET ticket ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const tickets: Array<{ id: string; display_id?: string }> = json?.tickets ?? []
  return tickets[0] ?? null
}

export async function hubComment(ticketId: string, body: string): Promise<void> {
  const c = config()
  if (!c) return
  const res = await fetch(`${c.base}/api/external/tickets/${ticketId}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.secret}` },
    body: JSON.stringify({ body, visibility: 'public', author_email: process.env.REQUEST_HUB_AUTHOR_EMAIL }),
  })
  if (!res.ok) throw new Error(`Request Hub POST comment ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

export interface AssignmentIssue {
  type: 'agent_missing' | 'deal_not_found'
  bank: string
  client_name: string | null
  dni: string
  agent_name: string
  deal_id: number | null
  detail: string
}

/**
 * Aviso por Slack (DM del bot del Request Hub a quien gestiona los tickets de ese banco). Para agent_missing el
 * mensaje trae el botón "Añadir correo del gestor". Devuelve a quién llegó el DM, o false si el Request Hub aún no
 * tiene el endpoint.
 */
export async function hubNotifyAssignmentIssue(issue: AssignmentIssue): Promise<string[] | false> {
  const c = config()
  if (!c) return false
  const res = await fetch(`${c.base}/api/external/notify/assignment-issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.secret}` },
    // ASSIGNMENT_NOTIFY_TEST_EMAIL (opcional): en pruebas, el aviso va a esa persona y no a quien gestiona el banco
    body: JSON.stringify({ ...issue, notify_email: process.env.ASSIGNMENT_NOTIFY_TEST_EMAIL || undefined }),
  })
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`Request Hub notify ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json().catch(() => ({}))) as { notified?: string[] }
  return json.notified ?? []
}
