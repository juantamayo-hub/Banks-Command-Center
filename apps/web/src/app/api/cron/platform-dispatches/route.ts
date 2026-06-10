/**
 * GET /api/cron/platform-dispatches
 *
 * Vercel Cron Job — runs every 5 minutes to discover deals in stage 62
 * and upsert them into platform_dispatches (pending state).
 * Ensures no deal is missed even if nobody has the page open.
 *
 * Secured by CRON_SECRET (set in Vercel env vars).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  BANK_FIELD_IDS,
  OPTION_ID_TO_BANK,
  DOC_COMPLETED_STAGE_ID,
  type PlatformBankName,
} from '@/lib/platformDispatch'

export async function GET(req: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return NextResponse.json({ error: 'PIPEDRIVE_API_TOKEN no configurado' }, { status: 500 })

  // Fetch all deals in stage 62
  const allDeals: Record<string, unknown>[] = []
  let start = 0

  while (true) {
    const res = await fetch(
      `https://api.pipedrive.com/v1/deals?stage_id=${DOC_COMPLETED_STAGE_ID}&status=open&limit=200&start=${start}&api_token=${token}`
    )
    if (!res.ok) {
      console.error('[cron/platform-dispatches] Pipedrive HTTP', res.status)
      return NextResponse.json({ error: `Pipedrive devolvió ${res.status}` }, { status: 502 })
    }
    const body = await res.json()
    const deals: Record<string, unknown>[] = body.data ?? []
    allDeals.push(...deals)
    if (!body.additional_data?.pagination?.more_items_in_collection || deals.length === 0) break
    start += 200
  }

  // Extract platform banks per deal
  const discovered: { deal_id: number; bank_name: PlatformBankName; deal_title: string; person_name: string | null }[] = []

  for (const deal of allDeals) {
    const seenBanks = new Set<PlatformBankName>()
    for (const fieldId of BANK_FIELD_IDS) {
      const raw = deal[fieldId]
      const val = raw !== null && raw !== undefined ? parseInt(String(raw), 10) : NaN
      if (!isNaN(val) && OPTION_ID_TO_BANK[val]) {
        seenBanks.add(OPTION_ID_TO_BANK[val])
      }
    }
    for (const bankName of seenBanks) {
      discovered.push({
        deal_id:     deal.id as number,
        bank_name:   bankName,
        deal_title:  (deal.title as string) ?? `Deal ${deal.id}`,
        person_name: (deal.person_name as string) ?? null,
      })
    }
  }

  // Upsert into Supabase (ignore duplicates)
  const supabase = await createAdminClient()
  let upserted = 0

  if (discovered.length > 0) {
    const { error } = await supabase
      .from('platform_dispatches')
      .upsert(
        discovered.map((d) => ({
          deal_id:     d.deal_id,
          bank_name:   d.bank_name,
          deal_title:  d.deal_title,
          person_name: d.person_name,
        })),
        { onConflict: 'deal_id,bank_name', ignoreDuplicates: true }
      )
    if (error) console.error('[cron/platform-dispatches] Supabase upsert error:', error)
    else upserted = discovered.length
  }

  console.log(`[cron/platform-dispatches] deals=${allDeals.length} discovered=${discovered.length} upserted=${upserted}`)
  return NextResponse.json({ ok: true, deals_in_stage: allDeals.length, discovered: discovered.length })
}
