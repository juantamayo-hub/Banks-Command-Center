/**
 * GET /api/platform-dispatches/debug?deal_id=XXX
 * Temporary diagnostic — returns raw Bank 1-5 field values + stage_id for a deal.
 * DELETE after debugging.
 */
import { NextRequest, NextResponse } from 'next/server'
import { BANK_FIELD_IDS, OPTION_ID_TO_BANK, DOC_COMPLETED_STAGE_ID } from '@/lib/platformDispatch'

export async function GET(req: NextRequest) {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return NextResponse.json({ error: 'no token' }, { status: 500 })

  const dealId = req.nextUrl.searchParams.get('deal_id')
  if (!dealId) {
    // Also return all deals in stage 62 for inspection
    const res = await fetch(
      `https://api.pipedrive.com/v1/deals?stage_id=${DOC_COMPLETED_STAGE_ID}&status=open&limit=10&api_token=${token}`
    )
    const body = await res.json()
    return NextResponse.json({
      queried_stage_id: DOC_COMPLETED_STAGE_ID,
      total_found: body.data?.length ?? 0,
      deals: (body.data ?? []).map((d: Record<string, unknown>) => ({
        id: d.id,
        title: d.title,
        stage_id: d.stage_id,
        pipeline_id: d.pipeline_id,
      })),
    })
  }

  const res = await fetch(
    `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`
  )
  const body = await res.json()
  const deal = body.data

  if (!deal) return NextResponse.json({ error: 'Deal no encontrado' }, { status: 404 })

  const bankFields = BANK_FIELD_IDS.map((fieldId, i) => {
    const raw = deal[fieldId]
    return {
      slot: `Bank ${i + 1}`,
      field_id: fieldId,
      raw_value: raw,
      mapped_bank: typeof raw === 'number' ? (OPTION_ID_TO_BANK[raw] ?? `⚠️ ID ${raw} no mapeado`) : null,
    }
  })

  return NextResponse.json({
    deal_id: deal.id,
    title: deal.title,
    stage_id: deal.stage_id,
    pipeline_id: deal.pipeline_id,
    queried_stage_id: DOC_COMPLETED_STAGE_ID,
    stage_matches: deal.stage_id === DOC_COMPLETED_STAGE_ID,
    bank_fields: bankFields,
  })
}
