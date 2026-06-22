/**
 * GET /api/doc-completed
 *
 * Returns open deals currently in stage 62 (Doc. Completed) from Pipedrive.
 *
 * Response: { deals: { deal_id, deal_title, person_name, add_time }[] }
 */

import { NextResponse } from 'next/server'

const STAGE_ID = 62

export async function GET() {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'PIPEDRIVE_API_TOKEN no configurado' }, { status: 500 })
  }

  try {
    const res = await fetch(
      `https://api.pipedrive.com/v1/deals?stage_id=${STAGE_ID}&status=open&limit=100&api_token=${token}`,
      { next: { revalidate: 0 } }
    )
    if (!res.ok) {
      return NextResponse.json({ error: `Pipedrive ${res.status}` }, { status: 502 })
    }
    const json = await res.json()
    const deals = ((json?.data ?? []) as Record<string, unknown>[]).map((d) => ({
      deal_id:     d.id as number,
      deal_title:  (d.title as string) ?? '',
      person_name: (d.person_name as string) ?? '',
      add_time:    (d.add_time as string) ?? '',
    }))
    return NextResponse.json({ deals })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
