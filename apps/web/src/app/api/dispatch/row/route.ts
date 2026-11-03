/**
 * GET /api/dispatch/row?item_id=<ITEM ID> — una línea del CC con las mismas claves que la fila de la hoja.
 * Para ING_DOSSIER, el único Send Dossier que relee la hoja tras el Wait (usa "Autorización").
 * Requiere cabecera x-offers-secret.
 */

import { NextResponse } from 'next/server'
import { hasOffersSecret } from '@/lib/auth/offersSecret'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!hasOffersSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const itemId = new URL(req.url).searchParams.get('item_id')?.trim()
  if (!itemId || itemId.length > 64) return NextResponse.json({ error: 'item_id obligatorio' }, { status: 400 })

  const db = await createAdminClient()
  const { data: r, error } = await db
    .from('sheet_rows')
    .select('id, uid, opportunity_id, bank_deal_id, nombre_cliente, importe, link_dossier, autorizacion, autorizacion_red_flag, status, status_raw, red_flags_raw, notas, process_status, owner, timestamp_sent')
    .eq('engine', 'cc')
    .eq('uid', itemId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  if (!r) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })

  return NextResponse.json({
    'ITEM ID': r.uid,
    'Opportunity ID': r.opportunity_id,
    'Bank Deal ID': r.bank_deal_id ?? '',
    'Nombre Cliente': r.nombre_cliente ?? '',
    'Importe': r.importe ?? '',
    'Link Dossier': r.link_dossier ?? '',
    'Enviar': 'Yes',
    'Autorización': r.autorizacion ?? '',
    'Autorización Red Flag': r.autorizacion_red_flag ?? '',
    'Timestamp Sent': r.timestamp_sent ?? '',
    'Status': r.status_raw ?? '',
    'Red Flag': r.red_flags_raw ?? '',
    'NOTAS': r.notas ?? '',
    'Process Status': r.process_status ?? '',
    'Owner': r.owner ?? '',
    cc_row_id: r.id,
    cc_status: r.status,
  })
}
