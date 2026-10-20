'use client'

import { useState, useTransition } from 'react'
import { saveRedFlagRule, type RuleInput } from '@/app/actions/bankConfig'
import { OPERATION_LABEL, OPERATION_TYPES, type OperationType, type RedFlagRule } from '@/lib/bankConfig'
import { BTN_PRIMARY, INPUT } from './ui'

const FIELDS: { key: keyof RuleInput; label: string; hint: string; suffix?: string }[] = [
  { key: 'min_importe', label: 'Importe mínimo', hint: 'Importe de hipoteca por debajo → red flag', suffix: '€' },
  { key: 'max_plazo_anos', label: 'Plazo máximo', hint: 'Años', suffix: 'años' },
  { key: 'max_financiacion_pct', label: '% financiación máx.', hint: 'Vacío = sin límite', suffix: '%' },
  { key: 'max_edad_plazo', label: 'Edad + plazo máx.', hint: 'Edad del titular mayor + plazo', suffix: 'años' },
  { key: 'min_ingresos_1t', label: 'Ingresos mín. 1T', hint: 'Mensuales', suffix: '€' },
  { key: 'min_ingresos_2t', label: 'Ingresos mín. 2T', hint: 'Se suma al 1T si hay 2º titular', suffix: '€' },
  { key: 'max_dti_pct', label: 'DTI máximo', hint: 'Solo si "Validar DTI" está activo', suffix: '%' },
  { key: 'max_bancos', label: 'Máx. bancos', hint: 'Envío único = 1' },
  { key: 'min_antiguedad_anos', label: 'Antigüedad laboral mín.', hint: 'Vacío = no se comprueba', suffix: 'años' },
]

type Draft = Record<string, string | boolean>

function toDraft(r: RedFlagRule | null): Draft {
  const d: Draft = { validate_dti: r?.validate_dti ?? false, notes: r?.notes ?? '' }
  for (const f of FIELDS) {
    const v = r?.[f.key as keyof RedFlagRule]
    d[f.key] = v === null || v === undefined ? '' : String(v)
  }
  return d
}

function RuleCard({ slug, op, rule, canEdit }: { slug: string; op: OperationType; rule: RedFlagRule | null; canEdit: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(rule))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const original = JSON.stringify(toDraft(rule))
  const dirty = JSON.stringify(draft) !== original

  function save() {
    setMsg(null)
    start(async () => {
      const r = await saveRedFlagRule(slug, op, draft as unknown as RuleInput)
      setMsg(r.ok ? { ok: true, text: 'Guardado' } : { ok: false, text: r.error })
    })
  }

  return (
    <div className="rounded-lg border border-gray-100 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{OPERATION_LABEL[op]}</h3>
        {!rule && <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">Sin regla: se usan los valores por defecto del flujo</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {FIELDS.map((f) => (
          <label key={f.key} className="block" title={f.hint}>
            <span className="mb-1 block text-[11px] font-medium text-gray-500">{f.label}</span>
            <div className="relative">
              <input
                inputMode="decimal"
                value={draft[f.key] as string}
                disabled={!canEdit}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                className={`${INPUT} tabular-nums ${f.suffix ? 'pr-9' : ''}`}
              />
              {f.suffix && (
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-gray-400">{f.suffix}</span>
              )}
            </div>
          </label>
        ))}
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            checked={draft.validate_dti as boolean}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, validate_dti: e.target.checked })}
            className="h-4 w-4 accent-[var(--bayteca-green)]"
          />
          <span className="text-xs text-gray-700">Validar DTI</span>
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] font-medium text-gray-500">Notas</span>
        <input
          value={draft.notes as string}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className={INPUT}
        />
      </label>
      {canEdit && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || pending} className={BTN_PRIMARY}>
            {pending ? 'Guardando…' : rule ? 'Guardar' : 'Crear regla'}
          </button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  )
}

export default function RedFlagRulesEditor({ slug, rules, canEdit }: { slug: string; rules: RedFlagRule[]; canEdit: boolean }) {
  return (
    <div className="space-y-3">
      {OPERATION_TYPES.map((op) => (
        <RuleCard key={op} slug={slug} op={op} rule={rules.find((r) => r.operation_type === op) ?? null} canEdit={canEdit} />
      ))}
    </div>
  )
}
