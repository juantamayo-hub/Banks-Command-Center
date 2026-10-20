'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { setUsesGeneralRules, updateBankSettings } from '@/app/actions/bankConfig'
import { OPERATION_TYPES, effectiveRule, type BankConfig, type GeneralRule, type OperationType, type RedFlagRule, type RuleValues } from '@/lib/bankConfig'
import RulesMatrix from './RulesMatrix'
import { CARD } from './ui'

interface Props {
  config: BankConfig
  rules: RedFlagRule[]
  general: GeneralRule[]
  canEdit: boolean
}

/** Pestaña Red flags de un banco: bloqueo, regla general vs propia y tabla de criterios. */
export default function RedFlagsPanel({ config, rules, general, canEdit }: Props) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmBlock, setConfirmBlock] = useState(false)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    start(async () => {
      const r = await fn()
      if (!r.ok) setError(r.error ?? 'Error')
      setConfirmBlock(false)
    })
  }

  if (!config.redflags_apply) {
    return (
      <div className={`${CARD} text-sm text-gray-600`}>
        <p className="font-medium text-gray-800">Las red flags no aplican a {config.display_name}</p>
        <p className="mt-1 text-gray-500">{config.channel_note ?? 'Su flujo de envío no pasa por el control de red flags.'}</p>
      </div>
    )
  }

  const usesGeneral = config.uses_general_rules
  const eff = Object.fromEntries(OPERATION_TYPES.map((op) => [op, effectiveRule(config, rules, general, op)])) as
    Record<OperationType, ReturnType<typeof effectiveRule>>
  const matrixRules = Object.fromEntries(OPERATION_TYPES.map((op) => [op, eff[op].rule])) as Record<OperationType, RuleValues | null>
  const notes: Partial<Record<OperationType, string>> = {}
  for (const op of OPERATION_TYPES) {
    if (!usesGeneral && eff[op].source === 'own_primera') notes[op] = 'Sin regla propia: usa la de primera residencia'
    if (!usesGeneral && eff[op].source === 'general') notes[op] = 'Sin regla propia: usa la regla general'
  }

  return (
    <div className="space-y-4">
      {/* Bloqueo */}
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-4`}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {config.block_on_red_flags ? 'Las red flags bloquean el envío' : 'Las red flags solo se informan'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {config.block_on_red_flags
              ? 'Si un expediente incumple algún criterio, el dossier no sale y queda como bloqueado.'
              : 'El dossier sale igualmente; las red flags quedan anotadas (comportamiento actual).'}
          </p>
        </div>
        {canEdit && !confirmBlock && (
          <button
            type="button"
            role="switch"
            aria-checked={config.block_on_red_flags}
            disabled={pending}
            onClick={() =>
              config.block_on_red_flags
                ? run(() => updateBankSettings(config.bank_slug, { block_on_red_flags: false }))
                : setConfirmBlock(true)
            }
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${config.block_on_red_flags ? 'bg-red-600' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${config.block_on_red_flags ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        )}
        {confirmBlock && (
          <div className="flex w-full flex-wrap items-center justify-end gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 sm:w-auto">
            ¿Bloquear los envíos a {config.display_name} con red flags?
            <button type="button" disabled={pending} onClick={() => run(() => updateBankSettings(config.bank_slug, { block_on_red_flags: true }))}
              className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700">Sí, bloquear</button>
            <button type="button" onClick={() => setConfirmBlock(false)} className="rounded-md px-2 py-1 hover:bg-red-100">Cancelar</button>
          </div>
        )}
      </div>

      {/* Regla general vs propia */}
      <div className={CARD}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {usesGeneral ? 'Usa la regla general' : 'Reglas propias de ' + config.display_name}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {usesGeneral ? (
                <>Los criterios son los de la <Link href="/dashboard/configuracion/regla-general" className="underline">regla general</Link>; si la cambias, cambia para todos los bancos que la usan.</>
              ) : (
                'Estos criterios solo afectan a este banco.'
              )}
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setUsesGeneralRules(config.bank_slug, !usesGeneral))}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {usesGeneral ? 'Usar reglas propias' : 'Pasar a la regla general'}
            </button>
          )}
        </div>
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
        <RulesMatrix
          key={`${usesGeneral}-${rules.map((r) => r.updated_at).join()}-${general.map((g) => g.updated_at).join()}`}
          bankSlug={config.bank_slug}
          rules={matrixRules}
          columnNotes={notes}
          canEdit={canEdit && !usesGeneral}
        />
      </div>
    </div>
  )
}
