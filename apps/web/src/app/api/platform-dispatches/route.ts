/**
 * GET /api/platform-dispatches
 *
 * 1. Fetches open deals in Pipedrive stage 62 (Doc. Completed).
 * 2. For each deal, detects target banks (CaixaBank, Abanca, Bankinter, Santander)
 *    from Bank 1–5 custom fields.
 * 3. Upserts discovered (deal_id, bank_name) into platform_dispatches (pending state).
 * 4. Returns all pending dispatches (sent_at IS NULL) with cached deal info.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  BANK_FIELD_IDS,
  BANK_ID_FIELD_IDS,
  OPTION_ID_TO_BANK,
  DOC_COMPLETED_STAGE_ID,
  type PlatformBankName,
} from '@/lib/platformDispatch'

interface PipedriveDeal {
  id: number
  title: string
  person_name: string | null
  [key: string]: unknown
}

export interface PlatformDealItem {
  deal_id: number
  deal_title: string
  person_name: string | null
  banks: { name: PlatformBankName; sent: boolean; bank_deal_id: number | null }[]
}

export async function GET(req: Request) {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return NextResponse.json({ error: 'PIPEDRIVE_API_TOKEN no configurado' }, { status: 500 })

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('date_from') // ISO date string, e.g. "2026-06-01"
  const dateTo = searchParams.get('date_to')     // ISO date string, inclusive

  // ── 1. Fetch deals from Pipedrive stage 62 ────────────────────────────────
  const allDeals: PipedriveDeal[] = []
  let start = 0
  const limit = 200

  while (true) {
    let res: Response
    try {
      res = await fetch(
        `https://api.pipedrive.com/v1/deals?stage_id=${DOC_COMPLETED_STAGE_ID}&status=open&limit=${limit}&start=${start}&api_token=${token}`
      )
    } catch (err) {
      console.error('[platform-dispatches] Pipedrive network error:', err)
      return NextResponse.json({ error: 'Error de red con Pipedrive' }, { status: 502 })
    }

    if (!res.ok) {
      console.error('[platform-dispatches] Pipedrive HTTP', res.status)
      return NextResponse.json({ error: `Pipedrive devolvió ${res.status}` }, { status: 502 })
    }

    const body = await res.json()
    const deals: PipedriveDeal[] = body.data ?? []
    allDeals.push(...deals)

    if (!body.additional_data?.pagination?.more_items_in_collection || deals.length === 0) break
    start += limit
  }

  // ── 2. Extract target banks per deal ──────────────────────────────────────
  const discovered: {
    deal_id: number
    bank_name: PlatformBankName
    deal_title: string
    person_name: string | null
    bank_deal_id: number | null
  }[] = []

  for (const deal of allDeals) {
    // Map bank name → banking deal ID (from Bank N ID field on the same slot)
    const bankMap = new Map<PlatformBankName, number | null>()
    for (let i = 0; i < BANK_FIELD_IDS.length; i++) {
      const raw = deal[BANK_FIELD_IDS[i]]
      const val = raw !== null && raw !== undefined ? parseInt(String(raw), 10) : NaN
      if (!isNaN(val) && OPTION_ID_TO_BANK[val]) {
        const bankName = OPTION_ID_TO_BANK[val]
        if (!bankMap.has(bankName)) {
          // Read the banking deal ID from the corresponding Bank N ID field
          const idRaw = deal[BANK_ID_FIELD_IDS[i]]
          const bankDealId = idRaw !== null && idRaw !== undefined ? parseInt(String(idRaw), 10) : NaN
          bankMap.set(bankName, !isNaN(bankDealId) && bankDealId > 0 ? bankDealId : null)
        }
      }
    }
    for (const [bankName, bankDealId] of bankMap.entries()) {
      discovered.push({
        deal_id: deal.id,
        bank_name: bankName,
        deal_title: deal.title ?? `Deal ${deal.id}`,
        person_name: deal.person_name ?? null,
        bank_deal_id: bankDealId,
      })
    }
  }

  // ── 3. Upsert discovered entries (ON CONFLICT DO NOTHING) ─────────────────
  const supabase = await createAdminClient()

  if (discovered.length > 0) {
    const { error: upsertError } = await supabase
      .from('platform_dispatches')
      .upsert(
        discovered.map((d) => ({
          deal_id: d.deal_id,
          bank_name: d.bank_name,
          deal_title: d.deal_title,
          person_name: d.person_name,
          bank_deal_id: d.bank_deal_id,
        })),
        { onConflict: 'deal_id,bank_name', ignoreDuplicates: false }
      )

    if (upsertError) {
      console.error('[platform-dispatches] Supabase upsert error:', upsertError)
      // Non-fatal: continue to return pending data even if upsert failed
    }
  }

  // ── 4. Fetch all pending dispatches from Supabase ─────────────────────────
  let pendingQuery = supabase
    .from('platform_dispatches')
    .select('deal_id, bank_name, deal_title, person_name, sent_at, bank_deal_id, created_at')
    .is('sent_at', null)
    .is('dismissed_at', null)
    .order('created_at', { ascending: true })

  if (dateFrom) pendingQuery = pendingQuery.gte('created_at', dateFrom)
  if (dateTo) {
    // Make dateTo inclusive by using the end of that day
    const endOfDay = new Date(dateTo)
    endOfDay.setDate(endOfDay.getDate() + 1)
    pendingQuery = pendingQuery.lt('created_at', endOfDay.toISOString())
  }

  const { data: pending, error: fetchError } = await pendingQuery

  if (fetchError) {
    console.error('[platform-dispatches] Supabase fetch error:', fetchError)
    return NextResponse.json({ error: 'Error al leer base de datos' }, { status: 500 })
  }

  // ── 5. Group by deal ───────────────────────────────────────────────────────
  const byDeal = new Map<
    number,
    { deal_title: string; person_name: string | null; banks: { name: PlatformBankName; bank_deal_id: number | null }[] }
  >()

  for (const row of pending ?? []) {
    const existing = byDeal.get(row.deal_id)
    const bankEntry = { name: row.bank_name as PlatformBankName, bank_deal_id: row.bank_deal_id ?? null }
    if (existing) {
      existing.banks.push(bankEntry)
    } else {
      byDeal.set(row.deal_id, {
        deal_title: row.deal_title ?? `Deal ${row.deal_id}`,
        person_name: row.person_name ?? null,
        banks: [bankEntry],
      })
    }
  }

  const deals: PlatformDealItem[] = Array.from(byDeal.entries()).map(
    ([deal_id, { deal_title, person_name, banks }]) => ({
      deal_id,
      deal_title,
      person_name,
      banks: banks.map((b) => ({ name: b.name, sent: false, bank_deal_id: b.bank_deal_id })),
    })
  )

  return NextResponse.json({ deals })
}
