'use client'

import { useState, useTransition } from 'react'
import { setDispatchEngine } from '@/app/actions/bankConfig'

/** Interruptor "Motor de envío": Hoja (Apps Script) ↔ Command Center. Pide confirmación antes de cambiar. */
export default function DispatchEngineToggle({
  slug,
  engine,
  canEdit,
  ready,
  ccReady,
}: {
  slug: string
  engine: 'sheets' | 'cc'
  canEdit: boolean
  ready: boolean   // tiene webhook n8n y banco asociado
  ccReady: boolean // su línea de prueba ya salió OK por el Command Center (bank_config.cc_ready)
}) {
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = engine === 'cc' ? 'sheets' : 'cc'

  const label = engine === 'cc' ? 'Command Center' : 'Hoja (Apps Script)'
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className={engine === 'cc'
        ? 'rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700'
        : 'rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600'}>
        Motor de envío: {label}
      </span>
      {engine === 'sheets' && ready && !ccReady && (
        <span className="text-gray-500">
          Falta una prueba enviada OK: en Pendientes, busca «test» y pulsa Reenviar en la línea de prueba de este banco
          (el correo te llega a ti, no al banco)
        </span>
      )}
      {engine === 'sheets' && ccReady && (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">Prueba enviada OK</span>
      )}
      {canEdit && ((ready && ccReady) || engine === 'cc') && !confirming && (
        <button
          type="button"
          onClick={() => { setError(null); setConfirming(true) }}
          className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-gray-600 hover:bg-gray-50"
        >
          {next === 'cc' ? 'Pasar a Command Center' : 'Volver a la hoja'}
        </button>
      )}
      {confirming && (
        <span className="flex items-center gap-1.5">
          <span className="text-gray-600">
            {next === 'cc'
              ? 'Los próximos dossiers de este banco se enviarán desde el Command Center (la hoja deja de enviarlo).'
              : 'Los próximos dossiers volverán a enviarse por la hoja.'}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              const r = await setDispatchEngine(slug, next)
              if (!r.ok) setError(r.error)
              setConfirming(false)
            })}
            className="rounded-md bg-indigo-600 px-2 py-0.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {pending ? 'Guardando…' : 'Confirmar'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-gray-500 underline">Cancelar</button>
        </span>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  )
}
