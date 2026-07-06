/**
 * GET /api/nuevo-envio/verify?bank_deal_id=
 *
 * Fetches the banking deal (pipeline 7) from Pipedrive and auto-detects:
 *   - Bank name → mapped to our bank slug
 *   - Importe from the hipoteca amount field
 *   - Client name from the linked general deal
 *   - General deal ID (linked via field 71edfe...)
 *
 * No manual importe entry needed — everything is pulled from Pipedrive.
 *
 * Response (success): { ok: true, bank_slug, bank_name, importe, nombre_cliente, deal_title, general_deal_id }
 * Response (no bank match): { ok: false, code: 'BANK_NOT_FOUND', bank_name_detected: string }
 * Response (error):   { error: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { ACTIVE_BANKS } from '@/lib/banks'

// Field on banking deal (pipeline 7) that holds the bank name
const BANK_NAME_FIELD    = 'c3a445b9bf0422b9db09abc776cf2dc281b7e975'
// Field on banking deal that holds the mortgage amount (himporte de hipoteca)
const IMPORTE_FIELD      = 'b80d8ee37cc14ecdd7d8a640a57d6bd85308d5b9'
// Field on banking deal that links to the general deal
const GENERAL_DEAL_FIELD = '71edfe1562e9e19d4c7d96d38548dd009d4b3601'

// Build a normalized lookup: slug ← various forms of the bank name
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]/g, '')       // keep only alphanumeric
}

const SLUG_BY_NORMALIZED: Record<string, string> = {}
for (const bank of ACTIVE_BANKS) {
  SLUG_BY_NORMALIZED[normalizeName(bank.name)] = bank.slug
  SLUG_BY_NORMALIZED[normalizeName(bank.slug)] = bank.slug
}
// Extra aliases for common Pipedrive values
const EXTRA_ALIASES: Record<string, string> = {
  'sabadellnoresidentes': 'sabadell',
  'msf360sabadellresidentes': 'banca_360',
  'banca360': 'banca_360',
  'msf360': 'banca_360',
  'nobankfee': 'no_bank_fee',
  'laboralkutxa': 'laboral_kutxa',
  'deutschebank': 'deutsche_bank',
  'eurocajarural': 'eurocajarural',
  'caixapopular': 'caixa_popular',
  'crdelsur': 'cr_del_sur',
  'crteruel': 'cr_teruel',
  'crgranada': 'cr_granada',
  'crasturias': 'cr_asturias',
  'craragon': 'cr_aragon',
  'crextremadura': 'cr_extremadura',
  'ruralnostra': 'ruralnostra',
  'uci': 'uci',
  'hipotecascom': 'uci',
  'hipotecas': 'uci',
  'ing': 'ing',
}
Object.assign(SLUG_BY_NORMALIZED, EXTRA_ALIASES)

function resolveBankSlug(pdBankName: string): string | null {
  const key = normalizeName(pdBankName)
  return SLUG_BY_NORMALIZED[key] ?? null
}

export async function GET(req: NextRequest) {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return NextResponse.json({ error: 'PIPEDRIVE_API_TOKEN no configurado' }, { status: 500 })

  const { searchParams } = req.nextUrl
  const bankDealIdStr = searchParams.get('bank_deal_id') ?? ''

  const bankDealId = parseInt(bankDealIdStr, 10)
  if (!Number.isInteger(bankDealId) || bankDealId <= 0) {
    return NextResponse.json({ error: 'bank_deal_id inválido' }, { status: 400 })
  }

  // 1. Fetch the banking deal (pipeline 7)
  const bankingRes = await fetch(
    `https://api.pipedrive.com/v1/deals/${bankDealId}?api_token=${token}`,
    { next: { revalidate: 0 } }
  )
  if (bankingRes.status === 404) {
    return NextResponse.json(
      { error: `Deal bancario #${bankDealId} no encontrado en Pipedrive` },
      { status: 404 }
    )
  }
  if (!bankingRes.ok) {
    return NextResponse.json({ error: `Error Pipedrive: ${bankingRes.status}` }, { status: 502 })
  }
  const bankingJson = await bankingRes.json()
  const bankingDeal = bankingJson?.data
  if (!bankingDeal) {
    return NextResponse.json({ error: 'Respuesta inesperada de Pipedrive' }, { status: 502 })
  }

  // 2. Extract bank name
  const pdBankName: string = bankingDeal[BANK_NAME_FIELD]
    ? String(bankingDeal[BANK_NAME_FIELD]).trim()
    : ''

  // 3. Extract importe from banking deal
  const importeRaw = bankingDeal[IMPORTE_FIELD]
  const importe: number | null =
    importeRaw !== null && importeRaw !== undefined && importeRaw !== ''
      ? parseFloat(String(importeRaw).replace(',', '.'))
      : null

  // 4. Resolve general deal ID
  const rawField = bankingDeal[GENERAL_DEAL_FIELD]
  const generalDealId: number | null =
    typeof rawField === 'number'
      ? rawField
      : typeof rawField === 'object' && rawField !== null
      ? (rawField as { value?: number }).value ?? null
      : null

  if (!generalDealId || generalDealId <= 0) {
    return NextResponse.json(
      { error: `El deal bancario #${bankDealId} no tiene un deal general vinculado. ¿Ingresaste el deal general en lugar del bancario?` },
      { status: 422 }
    )
  }

  // 5. Fetch general deal for client name
  const generalRes = await fetch(
    `https://api.pipedrive.com/v1/deals/${generalDealId}?api_token=${token}`,
    { next: { revalidate: 0 } }
  )
  let nombreCliente = ''
  let dealTitle = ''
  if (generalRes.ok) {
    const generalJson = await generalRes.json()
    const deal = generalJson?.data
    nombreCliente = deal?.person_name ?? deal?.org_name ?? deal?.title ?? ''
    dealTitle = deal?.title ?? ''
  }

  // 6. Map bank name to slug
  const bankSlug = pdBankName ? resolveBankSlug(pdBankName) : null

  if (!bankSlug) {
    return NextResponse.json({
      ok: false,
      code: 'BANK_NOT_FOUND',
      bank_name_detected: pdBankName || '(vacío)',
      importe: isFinite(importe ?? NaN) ? importe : null,
      nombre_cliente: nombreCliente,
      general_deal_id: generalDealId,
    })
  }

  return NextResponse.json({
    ok: true,
    bank_slug: bankSlug,
    bank_name: ACTIVE_BANKS.find((b) => b.slug === bankSlug)?.name ?? pdBankName,
    importe: isFinite(importe ?? NaN) ? importe : null,
    nombre_cliente: nombreCliente,
    deal_title: dealTitle,
    general_deal_id: generalDealId,
  })
}
