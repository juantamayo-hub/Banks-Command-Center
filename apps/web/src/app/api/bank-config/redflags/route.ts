/**
 * GET /api/bank-config/redflags?bank=<slug o nombre del deal bancario>&op=<primera_residencia|segunda_residencia|cambio_hipoteca>
 *
 * Reglas de red flags del banco para el subflujo n8n "Red Flag Check IRPF" (sustituye a la hoja "Reglas Red Flag").
 * Solo lectura. Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 *
 * Regla devuelta = regla efectiva (lib/bankConfig.effectiveRule): propia del banco, o la regla general si el banco
 * la usa o no tiene regla para ese tipo. configFound=false solo si el banco no existe (el subflujo usa sus defaults).
 * blockOnRedFlags=false → las red flags son informativas (comportamiento actual).
 */

import { NextResponse } from 'next/server'
import { hasOffersSecret } from '@/lib/auth/offersSecret'
import { loadBankConfig } from '@/lib/bankConfigData'
import { OPERATION_TYPES, effectiveRule, resolveBank, type OperationType } from '@/lib/bankConfig'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!hasOffersSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const p = new URL(req.url).searchParams
  const bankInput = p.get('bank') ?? ''
  const op = (p.get('op') ?? '') as OperationType
  if (!OPERATION_TYPES.includes(op)) {
    return NextResponse.json({ error: `op debe ser uno de: ${OPERATION_TYPES.join(', ')}` }, { status: 400 })
  }

  try {
    const data = await loadBankConfig()
    const bank = resolveBank(data.configs, bankInput)
    const eff = bank ? effectiveRule(bank, data.rules, data.general, op) : null
    const rule = eff?.rule ?? null
    const docs = bank ? data.docs.filter((d) => d.bank_slug === bank.bank_slug) : []
    return NextResponse.json({
      bank: bank?.bank_slug ?? null,
      operationType: op,
      configFound: !!rule,
      ruleSource: eff?.source ?? null,
      redFlagsApply: bank?.redflags_apply ?? false,
      blockOnRedFlags: bank?.block_on_red_flags ?? false,
      rule: rule && {
        minImporte: rule.min_importe,
        maxPlazoAnos: rule.max_plazo_anos,
        maxFinanciacionPct: rule.max_financiacion_pct,
        maxEdadPlazo: rule.max_edad_plazo,
        minIngresos1T: rule.min_ingresos_1t,
        maxDtiPct: rule.max_dti_pct,
        minIngresos2T: rule.min_ingresos_2t,
        maxBancos: rule.max_bancos,
        minAntiguedadAnos: rule.min_antiguedad_anos,
        validateDti: rule.validate_dti,
      },
      requiredDocuments: docs.map((d) => ({
        code: d.drive_code,
        label: d.label,
        required: d.required,
        ocr: d.ocr,
        extractField: d.extract_field,
      })),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[bank-config/redflags]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
