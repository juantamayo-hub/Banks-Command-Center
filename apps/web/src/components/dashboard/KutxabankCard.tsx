'use client'

import { useState } from 'react'

interface KutxabankSubmission {
  id: string
  deal_id: number
  bank_deal_id: number | null
  nombre_cliente: string | null
  dni: string | null
  plan: string | null
  zip_file_id: string | null
  zip_drive_link: string | null
  missing_docs: string[]
  rastreator_status: 'pending' | 'approved' | 'rejected' | 'sent'
  sent_at: string | null
  created_at: string
}

interface Props {
  submission: KutxabankSubmission
  onSent: (id: string) => void
}

const DOC_LABELS: Record<string, string> = {
  C003: 'DNI/NIE 1er Titular',
  C004: 'Vida Laboral 1er Titular',
  C005: 'Mov. Cuenta 1er Titular',
  C006: 'Nómina 1er Titular',
  C007: 'Contrato 1er Titular',
  C008: 'Renta 1er Titular',
  D003: 'DNI/NIE 2do Titular',
  D004: 'Vida Laboral 2do Titular',
  D005: 'Mov. Cuenta 2do Titular',
  D006: 'Nómina 2do Titular',
  D007: 'Contrato 2do Titular',
  D008: 'Renta 2do Titular',
}

type SendPhase = 'idle' | 'confirming' | 'loading' | 'done' | 'error'

export default function KutxabankCard({ submission: sub, onSent }: Props) {
  const [phase, setPhase]     = useState<SendPhase>('idle')
  const [errMsg, setErrMsg]   = useState('')
  const [leaving, setLeaving] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  const canSend = sub.rastreator_status === 'approved'

  async function doDismiss() {
    if (!confirm('¿Eliminar esta tarjeta? Se ocultará de la lista.')) return
    setDismissing(true)
    try {
      const res = await fetch('/api/kutxabank/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: sub.id }),
      })
      if (res.ok) {
        setLeaving(true)
        setTimeout(() => onSent(sub.id), 500)
      } else {
        const data = await res.json()
        alert(data?.error ?? 'Error al eliminar')
      }
    } catch {
      alert('Error de red')
    } finally {
      setDismissing(false)
    }
  }

  async function doSend() {
    setPhase('loading')
    setErrMsg('')
    try {
      const res = await fetch('/api/kutxabank/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: sub.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPhase('error')
        setErrMsg(data?.error ?? 'Error al enviar')
        return
      }
      setPhase('done')
      setLeaving(true)
      setTimeout(() => onSent(sub.id), 600)
    } catch {
      setPhase('error')
      setErrMsg('Error de red')
    }
  }

  const statusConfig = {
    pending:  { label: 'Pendiente Rastreator', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    approved: { label: 'Listo para enviar',    cls: 'bg-green-50 text-green-700 border-green-200' },
    rejected: { label: 'Rechazado',             cls: 'bg-red-50 text-red-700 border-red-200' },
    sent:     { label: 'Enviado',               cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  }[sub.rastreator_status]

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm transition-all duration-500 ${
        leaving ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-wider text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-0.5">
              Kutxabank
            </span>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-gray-900 truncate">
            {sub.nombre_cliente || `Deal #${sub.deal_id}`}
          </p>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-400">
            <a
              href={`https://mdsl.pipedrive.com/deal/${sub.deal_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-indigo-600 underline"
            >
              Deal #{sub.deal_id}
            </a>
            {sub.bank_deal_id && (
              <a
                href={`https://mdsl.pipedrive.com/deal/${sub.bank_deal_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-indigo-600 underline"
              >
                Bank #{sub.bank_deal_id}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusConfig.cls}`}>
            {statusConfig.label}
          </span>
          <button
            onClick={doDismiss}
            disabled={dismissing}
            title="Eliminar tarjeta"
            className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 flex flex-col gap-3">

        {/* ZIP link */}
        {sub.zip_drive_link ? (
          <a
            href={sub.zip_drive_link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Abrir ZIP encriptado en Drive
          </a>
        ) : (
          <p className="text-xs text-gray-400 italic">ZIP pendiente de creación…</p>
        )}

        {/* Missing docs */}
        {sub.missing_docs.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-red-700 mb-1.5">
              ⚠️ Documentos faltantes ({sub.missing_docs.length})
            </p>
            <ul className="flex flex-col gap-0.5">
              {sub.missing_docs.map((code) => (
                <li key={code} className="text-xs text-red-600 flex items-center gap-1.5">
                  <span className="font-mono font-medium">{code}</span>
                  <span className="text-red-400">—</span>
                  <span>{DOC_LABELS[code] ?? code}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sub.missing_docs.length === 0 && sub.zip_drive_link && (
          <p className="text-xs text-green-600">✓ Todos los documentos encontrados</p>
        )}

        {/* Send action */}
        <div className="flex items-center gap-2 mt-1">
          {phase === 'idle' && (
            <>
              {canSend ? (
                <button
                  onClick={() => setPhase('confirming')}
                  className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
                >
                  Enviar a Kutxabank
                </button>
              ) : sub.rastreator_status === 'pending' ? (
                <p className="text-xs text-amber-600">
                  Esperando aprobación Rastreator para habilitar envío
                </p>
              ) : sub.rastreator_status === 'rejected' ? (
                <p className="text-xs text-red-600">Rastreator no aprobó este envío</p>
              ) : null}
            </>
          )}

          {phase === 'confirming' && (
            <>
              <span className="text-sm text-gray-700">¿Confirmar envío a Kutxabank?</span>
              <button
                onClick={doSend}
                className="rounded-lg bg-teal-600 px-3 py-1 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
              >
                Sí, enviar
              </button>
              <button
                onClick={() => setPhase('idle')}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                Cancelar
              </button>
            </>
          )}

          {phase === 'loading' && (
            <span className="text-sm text-gray-400">Enviando…</span>
          )}

          {phase === 'done' && (
            <span className="text-sm text-green-600 font-medium">✓ Enviado</span>
          )}

          {phase === 'error' && (
            <>
              <span className="text-sm text-red-600">{errMsg}</span>
              <button
                onClick={() => setPhase('idle')}
                className="text-sm text-gray-400 hover:text-gray-600 underline"
              >
                Reintentar
              </button>
            </>
          )}
        </div>

        {/* Meta */}
        <p className="text-xs text-gray-300 tabular-nums">
          Registrado {new Date(sub.created_at).toLocaleDateString('es-ES')}
          {sub.plan && <> · {sub.plan}</>}
        </p>
      </div>
    </div>
  )
}
