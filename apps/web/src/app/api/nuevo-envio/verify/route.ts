/**
 * GET /api/nuevo-envio/verify?deal_id=&importe=
 *
 * Fetches the Pipedrive deal and checks if the entered importe matches
 * any of the 5 Importe Banco custom fields.
 *
 * Response (no match):  { match: false, importes_found: (number|null)[] }
 * Response (match):     { match: true, nombre_cliente: string, deal_title: string }
 */

import { NextRequest, NextResponse } from 'next/server'

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
  const dealIdStr = searchParams.get('deal_id') ?? ''
  const importeStr = searchParams.get('importe') ?? ''

  const dealId = parseInt(dealIdStr, 10)
  if (!Number.isInteger(dealId) || dealId <= 0) {
    return NextResponse.json({ error: 'deal_id inválido' }, { status: 400 })
  }

  const importeEntered = parseFloat(importeStr.replace(',', '.'))
  if (!isFinite(importeEntered) || importeEntered <= 0) {
    return NextResponse.json({ error: 'importe inválido' }, { status: 400 })
  }

  // Fetch deal from Pipedrive
  const res = await fetch(
    `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${token}`,
    { next: { revalidate: 0 } }
  )
  if (res.status === 404) {
    return NextResponse.json({ error: `Deal #${dealId} no encontrado en Pipedrive` }, { status: 404 })
  }
  if (!res.ok) {
    return NextResponse.json({ error: `Error Pipedrive: ${res.status}` }, { status: 502 })
  }

  const json = await res.json()
  const deal = json?.data
  if (!deal) {
    return NextResponse.json({ error: 'Respuesta inesperada de Pipedrive' }, { status: 502 })
  }

  // Extract Importe Banco 1-5 values
  const importesFound: (number | null)[] = IMPORTE_FIELD_IDS.map((fieldId) => {
    const raw = deal[fieldId]
    if (raw === null || raw === undefined || raw === '') return null
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'))
    return isFinite(n) ? n : null
  })

  // Check if entered importe matches any (tolerance 0.01)
  const match = importesFound.some(
    (v) => v !== null && Math.abs(v - importeEntered) < 0.01
  )

  const nombreCliente: string =
    deal.person_name ?? deal.org_name ?? deal.title ?? ''

  return NextResponse.json(
    match
      ? { match: true, nombre_cliente: nombreCliente, deal_title: deal.title ?? '' }
      : { match: false, importes_found: importesFound }
  )
}
