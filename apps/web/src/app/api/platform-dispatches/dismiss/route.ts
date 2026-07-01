/**
 * POST /api/platform-dispatches/dismiss
 *
 * Discards a pending dispatch so it no longer appears in the queue.
 * Sets dismissed_at = NOW() for (deal_id, bank_name).
 *
 * Body: { deal_id: number, bank_name: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { PLATFORM_BANKS, type PlatformBankName } from '@/lib/platformDispatch'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body debe ser objeto JSON' }, { status: 400 })
  }

  const { deal_id, bank_name } = body as Record<string, unknown>

  if (typeof deal_id !== 'number' || !Number.isInteger(deal_id) || deal_id <= 0) {
    return NextResponse.json({ error: '`deal_id` debe ser entero positivo' }, { status: 400 })
  }

  if (typeof bank_name !== 'string' || !(PLATFORM_BANKS as readonly string[]).includes(bank_name)) {
    return NextResponse.json(
      { error: `\`bank_name\` debe ser uno de: ${PLATFORM_BANKS.join(', ')}` },
      { status: 400 }
    )
  }

  const supabase = await createAdminClient()

  const { error } = await supabase
    .from('platform_dispatches')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('deal_id', deal_id)
    .eq('bank_name', bank_name as PlatformBankName)
    .is('sent_at', null) // never dismiss something already sent

  if (error) {
    console.error('[dismiss] Supabase update error:', error)
    return NextResponse.json({ error: 'Error al actualizar base de datos' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
