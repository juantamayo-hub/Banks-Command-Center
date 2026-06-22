/**
 * GET /api/nuevo-envio/verify?bank_deal_id=&importe=
 *
 * Fetches the banking deal (pipeline 7) from Pipedrive, resolves the linked
 * general deal via field 71edfe1562e9e19d4c7d96d38548dd009d4b3601, then checks
 * whether the entered importe matches any of the 5 Importe Banco custom fields.
 *
 * Response (no match):  { match: false, importes_found: (number|null)[] }
 * Response (match):     { match: true, nombre_cliente: string, deal_title: string, general_deal_id: number }
 */

import { NextRequest, NextResponse } from 'next/server'

const GENERAL_DEAL_FIELD = '71edfe1562e9e19d4c7d96d38548dd009d4b3601'

const IMPORTE_FIELD_IDS = [
  '745c37d4e2ebe1c8c3c9330f40d48925ef7ee32e', // Importe Banco 1
  '92522216e8423e9e022677eae0f1f82d02d88667', // Importe Banco 2
  'f985577ff66941b29905cb34a659a30cb3663fe4', // Importe Banco 3
  'fe8f74d3f422f4b0ae4d3b86b24c4450284a4a10', // Importe Banco 4
  'c20d814f4b7621590b2fac264dd4e5f90c54cb9b', // Importe Banco 5
]

export async function GET(req: NextRequest) {
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (!token) return NextResponse.json({ error: 'PIPEDRIVE_API_TOKEN no configurado' }, { status: 500 })

  const { searchParams } = req.nextUrl
  const bankDealIdStr = searchParams.get('bank_deal_id') ?? ''
  const importeStr    = searchParams.get('importe') ?? ''

  const bankDealId = parseInt(bankDealIdStr, 10)
  if (!Number.isInteger(bankDealId) || bankDealId <= 0) {
    return NextResponse.json({ error: 'bank_deal_id inválido' }, { status: 400 })
  }

  const importeEntered = parseFloat(importeStr.replace(',', '.'))
  if (!isFinite(importeEntered) || importeEntered <= 0) {
    return NextResponse.json({ error: 'importe inválido' }, { status: 400 })
  }

  // 1. Fetch the banking deal
  const bankingRes = await fetch(
    `https://api.pipedrive.com/v1/deals/${bankDealId}?api_token=${token}`,
    { next: { revalidate: 0 } }
  )
  if (bankingRes.status === 404) {
    return NextResponse.json({ error: `Deal bancario #${bankDealId} no encontrado en Pipedrive` }, { status: 404 })
  }
  if (!bankingRes.ok) {
    return NextResponse.json({ error: `Error Pipedrive: ${bankingRes.status}` }, { status: 502 })
  }
  const bankingJson = await bankingRes.json()
  const bankingDeal = bankingJson?.data
  if (!bankingDeal) {
    return NextResponse.json({ error: 'Respuesta inesperada de Pipedrive' }, { status: 502 })
  }

  // 2. Resolve general deal ID from the banking deal's custom field
  const rawField = bankingDeal[GENERAL_DEAL_FIELD]
  const generalDealId: number | null =
    typeof rawField === 'number'
      ? rawField
      : typeof rawField === 'object' && rawField !== null
      ? (rawField as { value?: number }).value ?? null
      : null

  if (!generalDealId || generalDealId <= 0) {
    return NextResponse.json(
      { error: `El deal bancario #${bankDealId} no tiene un deal general vinculado` },
      { status: 422 }
    )
  }

  // 3. Fetch the general deal and check importes
  const generalRes = await fetch(
    `https://api.pipedrive.com/v1/deals/${generalDealId}?api_token=${token}`,
    { next: { revalidate: 0 } }
  )
  if (!generalRes.ok) {
    return NextResponse.json({ error: `Error al obtener deal general #${generalDealId}` }, { status: 502 })
  }
  const generalJson = await generalRes.json()
  const deal = generalJson?.data
  if (!deal) {
    return NextResponse.json({ error: 'Respuesta inesperada al obtener deal general' }, { status: 502 })
  }

  // Extract Importe Banco 1-5 values
  const importesFound: (number | null)[] = IMPORTE_FIELD_IDS.map((fieldId) => {
    const raw = deal[fieldId]
    if (raw === null || raw === undefined || raw === '') return null
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'))
    return isFinite(n) ? n : null
  })

  const match = importesFound.some(
    (v) => v !== null && Math.abs(v - importeEntered) < 0.01
  )

  const nombreCliente: string =
    deal.person_name ?? deal.org_name ?? deal.title ?? ''

  return NextResponse.json(
    match
      ? {
          match: true,
          nombre_cliente: nombreCliente,
          deal_title: deal.title ?? '',
          general_deal_id: generalDealId,
        }
      : { match: false, importes_found: importesFound }
  )
}
