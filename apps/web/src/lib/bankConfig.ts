/**
 * Configuración de bancos (migración 028): tipos y resolución PURA de destinatarios y reglas de red flags.
 *
 * La usan:
 *   · /api/bank-config/recipients y /api/bank-config/redflags (n8n, solo lectura)
 *   · la sección /dashboard/configuracion (vista previa "¿a quién se enviaría?")
 *
 * Reproduce lo que hacían los flujos de n8n con la hoja "Red_Flags_Bancos_Config" y los mapas escritos a mano.
 * Cualquier cambio aquí cambia a quién se envían los dossiers: validar con scripts/bank_config_parity.py.
 */

export type ToSource = 'contacts' | 'deal_field' | 'deal_field_then_contacts' | 'contacts_cc_deal_field'
export type OperationType = 'primera_residencia' | 'segunda_residencia' | 'cambio_hipoteca'
export type ContactScope = 'default' | 'province' | 'when_to'

export const OPERATION_TYPES: OperationType[] = ['primera_residencia', 'segunda_residencia', 'cambio_hipoteca']

export const OPERATION_LABEL: Record<OperationType, string> = {
  primera_residencia: 'Primera residencia',
  segunda_residencia: 'Segunda residencia',
  cambio_hipoteca: 'Cambio de hipoteca',
}

export const TO_SOURCE_LABEL: Record<ToSource, string> = {
  contacts: 'Correos configurados aquí',
  deal_field: 'Campo "Email bancario" del deal',
  deal_field_then_contacts: '"Email bancario" del deal; si está vacío, correos configurados aquí',
  contacts_cc_deal_field: 'Correos configurados aquí; en CC el "Email bancario" del deal o, si falta, el CC de la provincia',
}

export type Channel = 'email' | 'platform' | 'none'

export interface BankConfig {
  bank_slug: string
  display_name: string
  pipedrive_names: string[]
  channel: Channel
  channel_note: string | null
  redflags_apply: boolean
  uses_general_rules: boolean
  block_on_red_flags: boolean
  to_source: ToSource
  subject_template: string | null
  email_from: string | null
  cc_owner: boolean
  sheet_tab: string | null
  notes: string | null
  updated_by: string | null
  updated_at: string
}

export interface BankContact {
  id: string
  bank_slug: string
  scope: ContactScope
  scope_value: string | null
  to_emails: string[]
  cc_emails: string[]
  cc_owner: boolean | null
  active: boolean
  notes: string | null
  updated_by: string | null
  updated_at: string
}

export interface RedFlagRule {
  id: string
  bank_slug: string
  operation_type: OperationType
  min_importe: number | null
  max_plazo_anos: number | null
  max_financiacion_pct: number | null
  max_edad_plazo: number | null
  min_ingresos_1t: number | null
  max_dti_pct: number | null
  min_ingresos_2t: number | null
  max_bancos: number | null
  min_antiguedad_anos: number | null
  validate_dti: boolean
  notes: string | null
  updated_by: string | null
  updated_at: string
}

/** Regla general (tabla bank_redflag_general): mismas columnas, sin banco. */
export type GeneralRule = Omit<RedFlagRule, 'id' | 'bank_slug'>

export type RuleValues = Pick<
  RedFlagRule,
  | 'min_importe' | 'max_plazo_anos' | 'max_financiacion_pct' | 'max_edad_plazo' | 'min_ingresos_1t'
  | 'max_dti_pct' | 'min_ingresos_2t' | 'max_bancos' | 'min_antiguedad_anos' | 'validate_dti' | 'notes'
>

export interface RequiredDocument {
  id: string
  bank_slug: string
  drive_code: string
  label: string
  required: boolean
  ocr: boolean
  extract_field: string | null
}

export interface Province {
  pipedrive_option_id: number
  name: string
  aliases: string[]
}

export interface BlockedEmail {
  id: string
  email: string
  bank_slug: string | null
  reason: string | null
}

// ── Utilidades ───────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim())
}

/** "a@x.com, b@y.com; c@z.com" → ['a@x.com','b@y.com','c@z.com'] */
export function splitEmails(s: string | null | undefined): string[] {
  return (s ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'))
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function uniqLower(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of list) {
    const k = e.trim().toLowerCase()
    if (k && !seen.has(k)) {
      seen.add(k)
      out.push(e.trim())
    }
  }
  return out
}

// ── Banco ────────────────────────────────────────────────────────────────────

/** Resuelve el banco a partir del slug o del nombre que llega en el deal bancario (mayúsculas/tildes indiferentes). */
export function resolveBank(configs: BankConfig[], input: string): BankConfig | null {
  const n = norm(input)
  if (!n) return null
  return (
    configs.find((c) => c.bank_slug === input.trim()) ??
    configs.find((c) => norm(c.display_name) === n || c.pipedrive_names.some((p) => norm(p) === n)) ??
    null
  )
}

// ── Provincia ────────────────────────────────────────────────────────────────

/** Provincia del deal: id de opción de Pipedrive ("2582") o nombre ("Madrid", "Palmas Las"…). */
export function resolveProvince(provinces: Province[], input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const raw = String(input).trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) {
    return provinces.find((p) => p.pipedrive_option_id === Number(raw))?.name ?? null
  }
  const n = norm(raw)
  const hit = provinces.find((p) => norm(p.name) === n || p.aliases.some((a) => norm(a) === n))
  return hit?.name ?? raw
}

// ── Destinatarios ────────────────────────────────────────────────────────────

export type RecipientRoute = 'ok' | 'sin_configuracion' | 'falta_email' | 'bloqueado'

export interface RecipientInput {
  province?: string | number | null   // id de opción o nombre
  dealEmail?: string | null           // campo "Email bancario" del deal bancario (498dd83b…)
  ownerEmail?: string | null          // gestor/owner del deal (va en CC si procede)
}

export interface RecipientResult {
  bank: string
  province: string | null
  toEmails: string[]
  ccEmails: string[]
  /** Compatibilidad con los nodos de n8n: listas unidas por coma */
  toEmail: string | null
  ccEmail: string
  route: RecipientRoute
  matchedBy: 'deal_field' | 'province' | 'default' | null
  blocked: string[]
  reason: string
}

export function resolveRecipients(
  bank: BankConfig,
  contacts: BankContact[],
  provinces: Province[],
  blocked: BlockedEmail[],
  input: RecipientInput,
): RecipientResult {
  const active = contacts.filter((c) => c.active && c.bank_slug === bank.bank_slug)
  const province = resolveProvince(provinces, input.province ?? null)
  const dealEmails = splitEmails(input.dealEmail)
  const owner = (input.ownerEmail ?? '').trim()

  const byProvince = province
    ? active.find((c) => c.scope === 'province' && (c.scope_value ?? '').toLowerCase() === province.toLowerCase())
    : undefined
  const byDefault = active.find((c) => c.scope === 'default')
  const contact = byProvince ?? byDefault

  let to: string[] = []
  let cc: string[] = []
  let matchedBy: RecipientResult['matchedBy'] = null
  let ccOwner = bank.cc_owner

  switch (bank.to_source) {
    case 'deal_field':
      to = dealEmails
      matchedBy = to.length ? 'deal_field' : null
      break
    case 'deal_field_then_contacts':
      if (dealEmails.length) {
        to = dealEmails
        matchedBy = 'deal_field'
      } else if (contact) {
        to = contact.to_emails
        cc = contact.cc_emails
        matchedBy = byProvince ? 'province' : 'default'
        if (contact.cc_owner !== null) ccOwner = contact.cc_owner
      }
      break
    case 'contacts_cc_deal_field':
      if (byDefault) {
        to = byDefault.to_emails
        matchedBy = 'default'
      }
      cc = dealEmails.length ? dealEmails : (byProvince?.cc_emails ?? [])
      break
    default:
      if (contact) {
        to = contact.to_emails
        cc = contact.cc_emails
        matchedBy = byProvince ? 'province' : 'default'
        if (contact.cc_owner !== null) ccOwner = contact.cc_owner
      }
  }

  // CC condicional según el TO (p. ej. Unicaja: si el TO es mclopezr@ → copia a lpenalver@)
  for (const rule of active.filter((c) => c.scope === 'when_to')) {
    if (to.some((t) => t.toLowerCase() === (rule.scope_value ?? '').toLowerCase())) cc = [...cc, ...rule.cc_emails]
  }
  if (ccOwner && owner) cc = [...cc, owner]

  to = uniqLower(to)
  cc = uniqLower(cc)

  const blockedHits = to.filter((t) =>
    blocked.some((b) => b.email.toLowerCase() === t.toLowerCase() && (!b.bank_slug || b.bank_slug === bank.bank_slug)),
  )

  let route: RecipientRoute = 'ok'
  let reason = ''
  if (!to.length) {
    if (bank.to_source === 'deal_field' || (bank.to_source === 'deal_field_then_contacts' && !contact)) {
      route = bank.to_source === 'deal_field' ? 'falta_email' : 'sin_configuracion'
    } else {
      route = 'sin_configuracion'
    }
    reason =
      route === 'falta_email'
        ? 'El deal bancario no tiene "Email bancario"'
        : province
          ? `Sin correo configurado para la provincia ${province}`
          : 'Provincia no informada y sin correo por defecto'
  } else if (blockedHits.length) {
    route = 'bloqueado'
    reason = `Correo bloqueado: ${blockedHits.join(', ')}`
  }

  return {
    bank: bank.bank_slug,
    province,
    toEmails: to,
    ccEmails: cc,
    toEmail: to.length ? to.join(', ') : null,
    ccEmail: cc.join(', '),
    route,
    matchedBy,
    blocked: blockedHits,
    reason,
  }
}

// ── Red flags ────────────────────────────────────────────────────────────────

export function pickRule(rules: RedFlagRule[], bankSlug: string, op: OperationType): RedFlagRule | null {
  return rules.find((r) => r.bank_slug === bankSlug && r.operation_type === op) ?? null
}

export type RuleSource = 'own' | 'own_primera' | 'general'

/**
 * Regla que se aplica de verdad a un banco y tipo de operación:
 *   · banco con "regla general"          → regla general
 *   · banco con reglas propias            → su regla de ese tipo; si no tiene la de segunda residencia, su primera
 *                                           residencia (así lo hacía el subflujo); si tampoco, la regla general
 */
export function effectiveRule(
  bank: BankConfig,
  rules: RedFlagRule[],
  general: GeneralRule[],
  op: OperationType,
): { rule: RuleValues | null; source: RuleSource } {
  const gen = general.find((g) => g.operation_type === op) ?? null
  if (bank.uses_general_rules) return { rule: gen, source: 'general' }
  const own = pickRule(rules, bank.bank_slug, op)
  if (own) return { rule: own, source: 'own' }
  if (op === 'segunda_residencia') {
    const primera = pickRule(rules, bank.bank_slug, 'primera_residencia')
    if (primera) return { rule: primera, source: 'own_primera' }
  }
  return { rule: gen, source: 'general' }
}
