/**
 * Solo servidor. Lee del deal general de Pipedrive los bancos (Bank 1–5) con su importe y su deal bancario.
 * Es la fuente fiable: el generador de dossier rellena mal "Importe 2/4/5" en la hoja (los copia del 1).
 * Lee como Hipotecas Bayteca (PIPEDRIVE_API_TOKEN_HIPOTECAS): con otras cuentas, personas visible_to=1 dan 403.
 */

import { BANK_FIELD_IDS, BANK_ID_FIELD_IDS, BANK_LINK_FIELD_IDS } from '@/lib/platformDispatch'

export interface DealBankSlot {
  slot: number              // 1..5
  bank_name: string         // etiqueta de la opción en Pipedrive ("CR Teruel")
  bank_deal_id: number | null
  importe: number | null
}

export interface GeneralDeal {
  id: number
  title: string
  person_name: string | null
  owner_name: string | null
  slots: DealBankSlot[]
}

function token(): string {
  const t = process.env.PIPEDRIVE_API_TOKEN_HIPOTECAS || process.env.PIPEDRIVE_API_TOKEN
  if (!t) throw new Error('PIPEDRIVE_API_TOKEN_HIPOTECAS no configurado')
  return t
}

async function pd<T>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`https://api.pipedrive.com/v1${path}${sep}api_token=${token()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Pipedrive GET ${path.split('?')[0]} ${res.status}`)
  return (await res.json()) as T
}

interface DealField { key: string; name: string; options?: { id: number; label: string }[] }

// Diccionario de campos: se cachea en la instancia (cambia muy rara vez)
let fieldsCache: { at: number; optionLabels: Map<number, string>; importeKeys: (string | null)[] } | null = null

async function fieldDictionary() {
  if (fieldsCache && Date.now() - fieldsCache.at < 60 * 60 * 1000) return fieldsCache
  const fields: DealField[] = []
  for (let start = 0; start < 2000; start += 500) {
    const r = await pd<{ data: DealField[] | null; additional_data?: { pagination?: { more_items_in_collection?: boolean } } }>(
      `/dealFields?start=${start}&limit=500`,
    )
    fields.push(...(r.data ?? []))
    if (!r.additional_data?.pagination?.more_items_in_collection) break
  }
  const optionLabels = new Map<number, string>()
  for (const key of BANK_FIELD_IDS) {
    for (const o of fields.find((f) => f.key === key)?.options ?? []) optionLabels.set(o.id, o.label)
  }
  const importeKeys = [1, 2, 3, 4, 5].map(
    (n) => fields.find((f) => f.name.trim().toLowerCase() === `importe banco ${n}`)?.key ?? null,
  )
  fieldsCache = { at: Date.now(), optionLabels, importeKeys }
  return fieldsCache
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function getGeneralDeal(dealId: number): Promise<GeneralDeal | null> {
  const [dict, r] = await Promise.all([
    fieldDictionary(),
    pd<{ data: Record<string, unknown> | null }>(`/deals/${dealId}`).catch((e) => {
      if (String(e).includes(' 404')) return { data: null }
      throw e
    }),
  ])
  const d = r.data
  if (!d) return null
  const slots: DealBankSlot[] = []
  BANK_FIELD_IDS.forEach((key, i) => {
    const optId = Number(d[key])
    const label = optId ? dict.optionLabels.get(optId) : undefined
    if (!label) return
    let bankDealId = num(d[BANK_ID_FIELD_IDS[i]])
    if (!bankDealId) {
      const m = String(d[BANK_LINK_FIELD_IDS[i]] ?? '').match(/\/deal\/(\d+)/)
      bankDealId = m ? Number(m[1]) : null
    }
    const importeKey = dict.importeKeys[i]
    slots.push({ slot: i + 1, bank_name: label, bank_deal_id: bankDealId, importe: importeKey ? num(d[importeKey]) : null })
  })
  const person = d.person_id as { name?: string } | number | null
  const owner = d.user_id as { name?: string } | number | null
  return {
    id: dealId,
    title: String(d.title ?? ''),
    person_name: person && typeof person === 'object' ? person.name ?? null : null,
    owner_name: owner && typeof owner === 'object' ? owner.name ?? null : null,
    slots,
  }
}
