/**
 * GET /api/bank-config/recipients?bank=<slug o nombre>&province=<id opción Pipedrive o nombre>
 *                                 &dealEmail=<"Email bancario" del deal>&ownerEmail=<owner>
 *
 * Destinatarios del correo de envío de dossier, para los flujos "Send Dossier" de n8n.
 * Solo lectura. Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 * Si falla la lectura devuelve 500: el flujo debe pararse y NO enviar.
 */

import { NextResponse } from 'next/server'
import { hasOffersSecret } from '@/lib/auth/offersSecret'
import { loadBankConfig } from '@/lib/bankConfigData'
import { resolveBank, resolveRecipients } from '@/lib/bankConfig'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!hasOffersSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const p = new URL(req.url).searchParams
  const bankInput = p.get('bank') ?? ''
  if (!bankInput.trim()) {
    return NextResponse.json({ error: 'Falta el parámetro bank' }, { status: 400 })
  }

  try {
    const data = await loadBankConfig()
    const bank = resolveBank(data.configs, bankInput)
    if (!bank) {
      return NextResponse.json({ error: `Banco no configurado: ${bankInput}` }, { status: 404 })
    }
    const result = resolveRecipients(bank, data.contacts, data.provinces, data.blocked, {
      province: p.get('province'),
      dealEmail: p.get('dealEmail'),
      ownerEmail: p.get('ownerEmail'),
    })
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[bank-config/recipients]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
