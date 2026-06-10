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
  banks: { name: PlatformBankName; sent: boolean }[]
}

export async function GET() {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return NextResponse.json({ error: 'PIPEDRIVE_API_TOKEN no configurado' }, { status: 500 })

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
  }[] = []

  for (const deal of allDeals) {
    const seenBanks = new Set<PlatformBankName>()
    for (const fieldId of BANK_FIELD_IDS) {
      const val = deal[fieldId]
      if (typeof val === 'number' && OPTION_ID_TO_BANK[val]) {
        seenBanks.add(OPTION_ID_TO_BANK[val])
      }
    }
    for (const bankName of seenBanks) {
      discovered.push({
        deal_id: deal.id,
        bank_name: bankName,
        deal_title: deal.title ?? `Deal ${deal.id}`,
        person_name: deal.person_name ?? null,
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
        })),
        { onConflict: 'deal_id,bank_name', ignoreDuplicates: true }
      )

    if (upsertError) {
      console.error('[platform-dispatches] Supabase upsert error:', upsertError)
      // Non-fatal: continue to return pending data even if upsert failed
    }
  }

  // ── 4. Fetch all pending dispatches from Supabase ─────────────────────────
  const { data: pending, error: fetchError } = await supabase
    .from('platform_dispatches')
    .select('deal_id, bank_name, deal_title, person_name, sent_at')
    .is('sent_at', null)
    .order('created_at', { ascending: true })

  if (fetchError) {
    console.error('[platform-dispatches] Supabase fetch error:', fetchError)
    return NextResponse.json({ error: 'Error al leer base de datos' }, { status: 500 })
  }

  // ── 5. Group by deal ───────────────────────────────────────────────────────
  const byDeal = new Map<
    number,
    { deal_title: string; person_name: string | null; banks: PlatformBankName[] }
  >()

  for (const row of pending ?? []) {
    const existing = byDeal.get(row.deal_id)
    if (existing) {
      existing.banks.push(row.bank_name as PlatformBankName)
    } else {
      byDeal.set(row.deal_id, {
        deal_title: row.deal_title ?? `Deal ${row.deal_id}`,
        person_name: row.person_name ?? null,
        banks: [row.bank_name as PlatformBankName],
      })
    }
  }

  const deals: PlatformDealItem[] = Array.from(byDeal.entries()).map(
    ([deal_id, { deal_title, person_name, banks }]) => ({
      deal_id,
      deal_title,
      person_name,
      banks: banks.map((name) => ({ name, sent: false })),
    })
  )

  return NextResponse.json({ deals })
}
