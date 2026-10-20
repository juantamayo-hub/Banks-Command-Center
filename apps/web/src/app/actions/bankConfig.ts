'use server'

/**
 * Server Actions: edición de la configuración de bancos (sección /dashboard/configuracion).
 *
 * - Solo pueden editar los correos de bank_config_editors (además de sesión válida @huspy.io / @bayteca.com).
 * - Cada cambio se guarda en bank_config_history (antes / después / quién).
 * - Escriben con service_role (createAdminClient). Lo que se guarda aquí lo leen los flujos de n8n en el
 *   siguiente envío vía /api/bank-config/*: un correo mal escrito = dossier al destinatario equivocado.
 */

import { revalidatePath } from 'next/cache'
import {
  OPERATION_TYPES,
  isValidEmail,
  type ContactScope,
  type OperationType,
  type ToSource,
} from '@/lib/bankConfig'
import { isAllowedDomain, requireEditor, type AdminClient } from '@/lib/bankConfigAuth'

const TO_SOURCES: ToSource[] = ['contacts', 'deal_field', 'deal_field_then_contacts', 'contacts_then_deal_field', 'contacts_cc_deal_field']
const SCOPES: ContactScope[] = ['default', 'province', 'when_to']
const DRIVE_CODE_RE = /^[A-Z]\d{3}$/

export type ConfigResult = { ok: true } | { ok: false; error: string }

/** ¿El usuario actual puede editar? (para pintar la UI en modo lectura) */
export async function canEditBankConfig(): Promise<boolean> {
  const r = await requireEditor()
  return !('error' in r)
}

async function logHistory(
  db: AdminClient,
  actor: string,
  entry: { bank_slug: string | null; table_name: string; record_key: string; action: 'insert' | 'update' | 'delete'; before: unknown; after: unknown },
) {
  const { error } = await db.from('bank_config_history').insert({ ...entry, actor })
  if (error) console.error('[bankConfig] history insert failed:', error.message)
}

function revalidate(slug?: string | null) {
  revalidatePath('/dashboard/configuracion')
  if (slug) revalidatePath(`/dashboard/configuracion/${slug}`)
}

function cleanEmails(list: string[]): { emails: string[] } | { error: string } {
  const emails = Array.from(new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean)))
  const bad = emails.filter((e) => !isValidEmail(e))
  if (bad.length) return { error: `Correo no válido: ${bad.join(', ')}` }
  return { emails }
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// ── Ajustes del banco ────────────────────────────────────────────────────────

export async function updateBankSettings(
  slug: string,
  patch: {
    block_on_red_flags?: boolean
    to_source?: ToSource
    cc_owner?: boolean
    subject_template?: string | null
    pipedrive_names?: string[]
    notes?: string | null
  },
): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  if (patch.to_source && !TO_SOURCES.includes(patch.to_source)) return { ok: false, error: 'Origen del TO no válido' }

  const { data: before, error: e1 } = await auth.db.from('bank_config').select('*').eq('bank_slug', slug).single()
  if (e1 || !before) return { ok: false, error: e1?.message ?? 'Banco no encontrado' }

  const update: Record<string, unknown> = { updated_by: auth.email }
  for (const k of ['block_on_red_flags', 'to_source', 'cc_owner', 'subject_template', 'notes'] as const) {
    if (patch[k] !== undefined) update[k] = typeof patch[k] === 'string' ? (patch[k] as string).trim() || null : patch[k]
  }
  if (patch.pipedrive_names) {
    update.pipedrive_names = Array.from(new Set(patch.pipedrive_names.map((n) => n.trim()).filter(Boolean)))
  }

  const { data: after, error } = await auth.db.from('bank_config').update(update).eq('bank_slug', slug).select('*').single()
  if (error) return { ok: false, error: error.message }
  await logHistory(auth.db, auth.email, { bank_slug: slug, table_name: 'bank_config', record_key: slug, action: 'update', before, after })
  revalidate(slug)
  return { ok: true }
}

// ── Reglas de red flags ──────────────────────────────────────────────────────

export interface RuleInput {
  min_importe?: unknown
  max_plazo_anos?: unknown
  max_financiacion_pct?: unknown
  max_edad_plazo?: unknown
  min_ingresos_1t?: unknown
  max_dti_pct?: unknown
  min_ingresos_2t?: unknown
  max_bancos?: unknown
  min_antiguedad_anos?: unknown
  validate_dti?: boolean
  notes?: string | null
}

export async function saveRedFlagRule(slug: string, op: OperationType, input: RuleInput): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  if (!OPERATION_TYPES.includes(op)) return { ok: false, error: 'Tipo de operación no válido' }

  const v = ruleValues(input)
  if ('error' in v) return { ok: false, error: v.error }
  const row = { bank_slug: slug, operation_type: op, ...v.values, updated_by: auth.email }

  const { data: before } = await auth.db
    .from('bank_redflag_rules').select('*').eq('bank_slug', slug).eq('operation_type', op).maybeSingle()
  const { data: after, error } = await auth.db
    .from('bank_redflag_rules').upsert(row, { onConflict: 'bank_slug,operation_type' }).select('*').single()
  if (error) return { ok: false, error: error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: slug, table_name: 'bank_redflag_rules', record_key: op, action: before ? 'update' : 'insert', before, after,
  })
  revalidate(slug)
  return { ok: true }
}

// ── Regla general ────────────────────────────────────────────────────────────

const RULE_NUM_KEYS = [
  'min_importe', 'max_plazo_anos', 'max_financiacion_pct', 'max_edad_plazo', 'min_ingresos_1t',
  'max_dti_pct', 'min_ingresos_2t', 'max_bancos', 'min_antiguedad_anos',
] as const

function ruleValues(input: RuleInput): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = { validate_dti: !!input.validate_dti, notes: input.notes?.trim() || null }
  for (const k of RULE_NUM_KEYS) {
    const v = numOrNull(input[k])
    if (v !== null && v < 0) return { error: 'Los valores no pueden ser negativos' }
    values[k] = v
  }
  return { values }
}

export async function saveGeneralRule(op: OperationType, input: RuleInput): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  if (!OPERATION_TYPES.includes(op)) return { ok: false, error: 'Tipo de operación no válido' }
  const v = ruleValues(input)
  if ('error' in v) return { ok: false, error: v.error }

  const { data: before } = await auth.db.from('bank_redflag_general').select('*').eq('operation_type', op).maybeSingle()
  const { data: after, error } = await auth.db
    .from('bank_redflag_general')
    .upsert({ operation_type: op, ...v.values, updated_by: auth.email }, { onConflict: 'operation_type' })
    .select('*').single()
  if (error) return { ok: false, error: error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: null, table_name: 'bank_redflag_general', record_key: op, action: before ? 'update' : 'insert', before, after,
  })
  revalidatePath('/dashboard/configuracion', 'layout')
  return { ok: true }
}

/**
 * Mete o saca un banco de la regla general. Al sacarlo, si no tiene reglas propias, se crean con los valores
 * de la regla general como punto de partida (así el comportamiento no cambia hasta que alguien las edite).
 */
export async function setUsesGeneralRules(slug: string, useGeneral: boolean): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }

  const { data: before, error: e1 } = await auth.db.from('bank_config').select('*').eq('bank_slug', slug).single()
  if (e1 || !before) return { ok: false, error: e1?.message ?? 'Banco no encontrado' }

  if (!useGeneral) {
    const { data: own } = await auth.db.from('bank_redflag_rules').select('operation_type').eq('bank_slug', slug)
    const have = new Set((own ?? []).map((r) => r.operation_type as string))
    const { data: general } = await auth.db.from('bank_redflag_general').select('*')
    const missing = (general ?? []).filter((g) => !have.has(g.operation_type as string))
    if (missing.length) {
      const rows = missing.map((g) => {
        const r: Record<string, unknown> = { bank_slug: slug, operation_type: g.operation_type, updated_by: auth.email }
        for (const k of [...RULE_NUM_KEYS, 'validate_dti', 'notes'] as const) r[k] = g[k]
        return r
      })
      const { error } = await auth.db.from('bank_redflag_rules').insert(rows)
      if (error) return { ok: false, error: error.message }
    }
  }

  const { data: after, error } = await auth.db
    .from('bank_config').update({ uses_general_rules: useGeneral, updated_by: auth.email })
    .eq('bank_slug', slug).select('*').single()
  if (error) return { ok: false, error: error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: slug, table_name: 'bank_config', record_key: slug, action: 'update',
    before: { uses_general_rules: before.uses_general_rules }, after: { uses_general_rules: after.uses_general_rules },
  })
  revalidatePath('/dashboard/configuracion', 'layout')
  return { ok: true }
}

// ── Destinatarios ────────────────────────────────────────────────────────────

export interface ContactInput {
  id?: string
  bank_slug: string
  scope: ContactScope
  scope_value: string | null
  to_emails: string[]
  cc_emails: string[]
  cc_owner: boolean | null
  active: boolean
  notes?: string | null
}

export async function saveContact(input: ContactInput): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  if (!SCOPES.includes(input.scope)) return { ok: false, error: 'Ámbito no válido' }

  const to = cleanEmails(input.to_emails)
  if ('error' in to) return { ok: false, error: to.error }
  const cc = cleanEmails(input.cc_emails)
  if ('error' in cc) return { ok: false, error: cc.error }

  let scopeValue: string | null = input.scope === 'default' ? null : (input.scope_value ?? '').trim()
  if (input.scope === 'province') {
    const { data: prov } = await auth.db.from('provinces').select('name').eq('name', scopeValue ?? '').limit(1)
    if (!prov?.length) return { ok: false, error: `Provincia desconocida: ${scopeValue}` }
  }
  if (input.scope === 'when_to') {
    scopeValue = (scopeValue ?? '').toLowerCase()
    if (!isValidEmail(scopeValue)) return { ok: false, error: 'Indica el correo TO que activa la copia' }
    if (!cc.emails.length) return { ok: false, error: 'La regla de copia necesita al menos un correo en CC' }
  } else if (input.active && !to.emails.length && !(input.scope === 'province' && cc.emails.length)) {
    return { ok: false, error: 'Añade al menos un correo en Para' }
  }

  const row = {
    bank_slug: input.bank_slug,
    scope: input.scope,
    scope_value: scopeValue,
    to_emails: to.emails,
    cc_emails: cc.emails,
    cc_owner: input.cc_owner,
    active: input.active,
    notes: input.notes?.trim() || null,
    updated_by: auth.email,
  }

  let before = null
  let res
  if (input.id) {
    const { data } = await auth.db.from('bank_contacts').select('*').eq('id', input.id).single()
    before = data
    res = await auth.db.from('bank_contacts').update(row).eq('id', input.id).select('*').single()
  } else {
    res = await auth.db.from('bank_contacts').insert(row).select('*').single()
  }
  if (res.error) {
    const dup = res.error.code === '23505'
    return { ok: false, error: dup ? 'Ya existe una fila para esa provincia / ámbito' : res.error.message }
  }
  await logHistory(auth.db, auth.email, {
    bank_slug: input.bank_slug, table_name: 'bank_contacts', record_key: `${row.scope}:${row.scope_value ?? '—'}`,
    action: before ? 'update' : 'insert', before, after: res.data,
  })
  revalidate(input.bank_slug)
  return { ok: true }
}

export async function deleteContact(id: string): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  const { data: before } = await auth.db.from('bank_contacts').select('*').eq('id', id).single()
  if (!before) return { ok: false, error: 'No encontrado' }
  const { error } = await auth.db.from('bank_contacts').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: before.bank_slug, table_name: 'bank_contacts', record_key: `${before.scope}:${before.scope_value ?? '—'}`,
    action: 'delete', before, after: null,
  })
  revalidate(before.bank_slug)
  return { ok: true }
}

// ── Documentos obligatorios ──────────────────────────────────────────────────

export async function saveDocument(input: {
  id?: string
  bank_slug: string
  drive_code: string
  label: string
  required: boolean
  ocr: boolean
  extract_field?: string | null
}): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  const code = input.drive_code.trim().toUpperCase()
  if (!DRIVE_CODE_RE.test(code)) return { ok: false, error: 'Código de Drive no válido (formato C007, F001…)' }
  if (!input.label.trim()) return { ok: false, error: 'Falta el nombre del documento' }

  const row = {
    bank_slug: input.bank_slug, drive_code: code, label: input.label.trim(), required: input.required, ocr: input.ocr,
    extract_field: input.extract_field?.trim() || null, updated_by: auth.email,
  }
  const { data: before } = input.id
    ? await auth.db.from('bank_required_documents').select('*').eq('id', input.id).single()
    : { data: null }
  const res = input.id
    ? await auth.db.from('bank_required_documents').update(row).eq('id', input.id).select('*').single()
    : await auth.db.from('bank_required_documents').insert(row).select('*').single()
  if (res.error) return { ok: false, error: res.error.code === '23505' ? 'Ese código ya está' : res.error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: input.bank_slug, table_name: 'bank_required_documents', record_key: code,
    action: before ? 'update' : 'insert', before, after: res.data,
  })
  revalidate(input.bank_slug)
  return { ok: true }
}

export async function deleteDocument(id: string): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  const { data: before } = await auth.db.from('bank_required_documents').select('*').eq('id', id).single()
  if (!before) return { ok: false, error: 'No encontrado' }
  const { error } = await auth.db.from('bank_required_documents').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: before.bank_slug, table_name: 'bank_required_documents', record_key: before.drive_code,
    action: 'delete', before, after: null,
  })
  revalidate(before.bank_slug)
  return { ok: true }
}

// ── Correos bloqueados y editores (globales) ─────────────────────────────────

export async function addBlockedEmail(email: string, bankSlug: string | null, reason: string): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  const e = email.trim().toLowerCase()
  if (!isValidEmail(e)) return { ok: false, error: 'Correo no válido' }
  const { data, error } = await auth.db
    .from('blocked_emails').insert({ email: e, bank_slug: bankSlug || null, reason: reason.trim() || null, updated_by: auth.email })
    .select('*').single()
  if (error) return { ok: false, error: error.code === '23505' ? 'Ya está bloqueado' : error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: bankSlug || null, table_name: 'blocked_emails', record_key: e, action: 'insert', before: null, after: data,
  })
  revalidatePath('/dashboard/configuracion/ajustes')
  return { ok: true }
}

export async function deleteBlockedEmail(id: string): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  const { data: before } = await auth.db.from('blocked_emails').select('*').eq('id', id).single()
  if (!before) return { ok: false, error: 'No encontrado' }
  const { error } = await auth.db.from('blocked_emails').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: before.bank_slug, table_name: 'blocked_emails', record_key: before.email, action: 'delete', before, after: null,
  })
  revalidatePath('/dashboard/configuracion/ajustes')
  return { ok: true }
}

export async function addEditor(email: string): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  const e = email.trim().toLowerCase()
  if (!isValidEmail(e) || !isAllowedDomain(e)) {
    return { ok: false, error: 'Solo correos @huspy.io o @bayteca.com' }
  }
  const { error } = await auth.db.from('bank_config_editors').insert({ email: e, added_by: auth.email })
  if (error) return { ok: false, error: error.code === '23505' ? 'Ya es editor' : error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: null, table_name: 'bank_config_editors', record_key: e, action: 'insert', before: null, after: { email: e },
  })
  revalidatePath('/dashboard/configuracion/ajustes')
  return { ok: true }
}

export async function removeEditor(email: string): Promise<ConfigResult> {
  const auth = await requireEditor()
  if ('error' in auth) return { ok: false, error: auth.error }
  const e = email.trim().toLowerCase()
  if (e === auth.email) return { ok: false, error: 'No puedes quitarte a ti mismo' }
  const { error } = await auth.db.from('bank_config_editors').delete().eq('email', e)
  if (error) return { ok: false, error: error.message }
  await logHistory(auth.db, auth.email, {
    bank_slug: null, table_name: 'bank_config_editors', record_key: e, action: 'delete', before: { email: e }, after: null,
  })
  revalidatePath('/dashboard/configuracion/ajustes')
  return { ok: true }
}
