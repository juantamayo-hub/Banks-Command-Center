'use client'

import { useState, useTransition } from 'react'
import { saveGeneralRule, saveRedFlagRule, type RuleInput } from '@/app/actions/bankConfig'
import { OPERATION_LABEL, OPERATION_TYPES, type OperationType, type RuleValues } from '@/lib/bankConfig'
import { BTN_PRIMARY, BTN_SECONDARY } from './ui'

const NUM_FIELDS: { key: keyof RuleValues; label: string; hint: string; suffix?: string }[] = [
  { key: 'min_importe', label: 'Importe mínimo de hipoteca', hint: 'Por debajo → red flag', suffix: '€' },
  { key: 'max_plazo_anos', label: 'Plazo máximo', hint: 'En años', suffix: 'años' },
  { key: 'max_financiacion_pct', label: 'Financiación máxima', hint: 'Vacío = sin límite', suffix: '%' },
  { key: 'max_edad_plazo', label: 'Edad + plazo máximo', hint: 'Edad del titular mayor + plazo', suffix: 'años' },
  { key: 'min_ingresos_1t', label: 'Ingresos mínimos 1er titular', hint: 'Mensuales', suffix: '€' },
  { key: 'min_ingresos_2t', label: 'Ingresos mínimos 2º titular', hint: 'Se suma al 1er titular si hay 2º', suffix: '€' },
  { key: 'max_dti_pct', label: 'DTI máximo', hint: 'Solo si "Validar DTI" está activo', suffix: '%' },
  { key: 'min_antiguedad_anos', label: 'Antigüedad laboral mínima', hint: 'Vacío = no se comprueba', suffix: 'años' },
  { key: 'max_bancos', label: 'Máximo de bancos a la vez', hint: '1 = envío único' },
]

type Cell = Record<string, string | boolean>
type Grid = Record<OperationType, Cell>

function toCell(r: RuleValues | null): Cell {
  const c: Cell = { validate_dti: r?.validate_dti ?? false, notes: r?.notes ?? '' }
  for (const f of NUM_FIELDS) {
    const v = r?.[f.key]
    c[f.key] = v === null || v === undefined ? '' : String(v)
  }
  return c
}

interface Props {
  /** null = regla general */
  bankSlug: string | null
  rules: Record<OperationType, RuleValues | null>
  /** Etiqueta por columna (p. ej. "usa la de primera residencia") */
  columnNotes?: Partial<Record<OperationType, string>>
  canEdit: boolean
}

export default function RulesMatrix({ bankSlug, rules, columnNotes, canEdit }: Props) {
  const initial = Object.fromEntries(OPERATION_TYPES.map((op) => [op, toCell(rules[op])])) as Grid
  const [grid, setGrid] = useState<Grid>(initial)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const changed = OPERATION_TYPES.filter((op) => JSON.stringify(grid[op]) !== JSON.stringify(initial[op]))

  function set(op: OperationType, key: string, value: string | boolean) {
    setGrid((g) => ({ ...g, [op]: { ...g[op], [key]: value } }))
    setMsg(null)
  }

  function save() {
    start(async () => {
      for (const op of changed) {
        const input = grid[op] as unknown as RuleInput
        const r = bankSlug ? await saveRedFlagRule(bankSlug, op, input) : await saveGeneralRule(op, input)
        if (!r.ok) {
          setMsg({ ok: false, text: `${OPERATION_LABEL[op]}: ${r.error}` })
          return
        }
      }
      setMsg({ ok: true, text: 'Cambios guardados' })
    })
  }

  const cellInput =
    'w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right text-sm tabular-nums text-gray-900 ' +
    'hover:border-gray-200 focus:border-gray-400 focus:bg-white focus:outline-none disabled:hover:border-transparent'

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white pb-3 pr-4 text-left text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Criterio
              </th>
              {OPERATION_TYPES.map((op) => (
                <th key={op} className="pb-3 px-2 text-right align-bottom">
                  <span className="block text-xs font-semibold text-gray-800">{OPERATION_LABEL[op]}</span>
                  {columnNotes?.[op] && <span className="block text-[10px] font-normal text-amber-700">{columnNotes[op]}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NUM_FIELDS.map((f) => (
              <tr key={f.key} className="group">
                <td className="sticky left-0 border-t border-gray-100 bg-white py-1.5 pr-4">
                  <span className="block text-sm text-gray-800">{f.label}</span>
                  <span className="block text-[11px] text-gray-400">{f.hint}</span>
                </td>
                {OPERATION_TYPES.map((op) => {
                  const dirty = grid[op][f.key] !== initial[op][f.key]
                  return (
                    <td key={op} className={`border-t border-gray-100 px-1 py-1 ${dirty ? 'bg-amber-50' : ''}`}>
                      <div className="relative">
                        <input
                          inputMode="decimal"
                          aria-label={`${f.label} — ${OPERATION_LABEL[op]}`}
                          value={grid[op][f.key] as string}
                          disabled={!canEdit}
                          placeholder="—"
                          onChange={(e) => set(op, f.key, e.target.value)}
                          className={`${cellInput} ${f.suffix ? 'pr-10' : ''}`}
                        />
                        {f.suffix && (
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-gray-400">
                            {f.suffix}
                          </span>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr>
              <td className="sticky left-0 border-t border-gray-100 bg-white py-2 pr-4">
                <span className="block text-sm text-gray-800">Validar DTI</span>
                <span className="block text-[11px] text-gray-400">Calcula la cuota y la compara con el DTI máximo</span>
              </td>
              {OPERATION_TYPES.map((op) => (
                <td key={op} className={`border-t border-gray-100 px-2 py-2 text-right ${grid[op].validate_dti !== initial[op].validate_dti ? 'bg-amber-50' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`Validar DTI — ${OPERATION_LABEL[op]}`}
                    checked={grid[op].validate_dti as boolean}
                    disabled={!canEdit}
                    onChange={(e) => set(op, 'validate_dti', e.target.checked)}
                    className="h-4 w-4 accent-[var(--bayteca-green)]"
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          <button type="button" onClick={save} disabled={!changed.length || pending} className={BTN_PRIMARY}>
            {pending ? 'Guardando…' : changed.length ? `Guardar cambios (${changed.length})` : 'Sin cambios'}
          </button>
          {changed.length > 0 && !pending && (
            <button type="button" className={BTN_SECONDARY} onClick={() => { setGrid(initial); setMsg(null) }}>
              Descartar
            </button>
          )}
          {msg && <span className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  )
}
