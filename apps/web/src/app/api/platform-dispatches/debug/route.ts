/**
 * GET /api/platform-dispatches/debug?mode=options   → real option IDs from Pipedrive field definitions
 * GET /api/platform-dispatches/debug?deal_id=XXX    → raw Bank 1-5 values for a specific deal
 * Temporary diagnostic. DELETE after debugging.
 */
import { NextRequest, NextResponse } from 'next/server'
import { BANK_FIELD_IDS, OPTION_ID_TO_BANK, DOC_COMPLETED_STAGE_ID } from '@/lib/platformDispatch'

export async function GET(req: NextRequest) {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return NextResponse.json({ error: 'no token' }, { status: 500 })

  const mode   = req.nextUrl.searchParams.get('mode')
  const dealId = req.nextUrl.searchParams.get('deal_id')

  // ── mode=options: fetch real option labels from Pipedrive field definitions ──
  if (mode === 'options') {
    const targetIds = new Set<string>(BANK_FIELD_IDS)
    let start = 0
    const allFields: Record<string, unknown>[] = []

    while (true) {
      const res  = await fetch(`https://api.pipedrive.com/v1/dealFields?limit=500&start=${start}&api_token=${token}`)
      const body = await res.json()
      const fields: Record<string, unknown>[] = body.data ?? []
      allFields.push(...fields)
      if (!body.additional_data?.pagination?.more_items_in_collection || fields.length === 0) break
      start += 500
    }

    const matched = allFields
      .filter((f) => targetIds.has(f.key as string))
      .map((f) => ({
        name:    f.name,
        key:     f.key,
        options: ((f.options as {id:number,label:string}[]) ?? []).map((o) => ({ id: o.id, label: o.label })),
      }))

    return NextResponse.json({ fields: matched })
  }

  // ── deal_id: inspect a specific deal ──────────────────────────────────────
  if (dealId) {
    const res  = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`)
    const body = await res.json()
    const deal = body.data
    if (!deal) return NextResponse.json({ error: 'Deal no encontrado' }, { status: 404 })

    const bankFields = BANK_FIELD_IDS.map((fieldId, i) => {
      const raw    = deal[fieldId]
      const numVal = raw !== null && raw !== undefined ? parseInt(String(raw), 10) : NaN
      return {
        slot:        `Bank ${i + 1}`,
        raw_value:   raw,
        raw_type:    typeof raw,
        parsed_id:   isNaN(numVal) ? null : numVal,
        mapped_bank: !isNaN(numVal) ? (OPTION_ID_TO_BANK[numVal] ?? `⚠️ ID ${numVal} no mapeado`) : null,
      }
    })

    return NextResponse.json({
      deal_id: deal.id, title: deal.title,
      stage_id: deal.stage_id, pipeline_id: deal.pipeline_id,
      stage_matches: deal.stage_id === DOC_COMPLETED_STAGE_ID,
      bank_fields: bankFields,
    })
  }

  return NextResponse.json({ error: 'Usa ?deal_id=XXX o ?mode=options' }, { status: 400 })
}
