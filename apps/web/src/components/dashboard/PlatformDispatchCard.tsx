'use client'

import { useState } from 'react'
import NotesCell from '@/components/dashboard/NotesCell'
import { BANK_COLOR, type PlatformBankName } from '@/lib/platformDispatch'
import type { SantanderInfo } from '@/app/api/platform-dispatches/route'

interface BankItem {
  name: PlatformBankName
  sent: boolean
  bank_deal_id: number | null
  sheet_row_id?: string | null
  notes?: { content: string; created_at: string }[]
}

interface PlatformDispatchCardProps {
  dealId: number
  dealTitle: string
  personName: string | null
  banks: BankItem[]
  onAllSent: () => void  // called when every bank is marked sent → card disappears
  santander_info?: SantanderInfo
}

type BankPhase = 'idle' | 'confirming' | 'loading' | 'done' | 'error' | 'dismiss_confirming' | 'dismissing'

export default function PlatformDispatchCard({
  dealId,
  dealTitle,
  personName,
  banks: initialBanks,
  onAllSent,
  santander_info,
}: PlatformDispatchCardProps) {
  const [banks, setBanks] = useState<(BankItem & { phase: BankPhase; error?: string })[]>(
    initialBanks.map((b) => ({ ...b, phase: b.sent ? 'done' : 'idle' }))
  )
  const [leaving, setLeaving] = useState(false)

  function startConfirm(bankName: PlatformBankName) {
    setBanks((prev) =>
      prev.map((b) => (b.name === bankName ? { ...b, phase: 'confirming' } : b))
    )
  }

  function cancelConfirm(bankName: PlatformBankName) {
    setBanks((prev) =>
      prev.map((b) => (b.name === bankName && b.phase === 'confirming' ? { ...b, phase: 'idle' } : b))
    )
  }

  function startDismissConfirm(bankName: PlatformBankName) {
    setBanks((prev) =>
      prev.map((b) => (b.name === bankName && b.phase === 'idle' ? { ...b, phase: 'dismiss_confirming' } : b))
    )
  }

  function cancelDismiss(bankName: PlatformBankName) {
    setBanks((prev) =>
      prev.map((b) => (b.name === bankName && b.phase === 'dismiss_confirming' ? { ...b, phase: 'idle' } : b))
    )
  }

  async function dismissBank(bankName: PlatformBankName) {
    setBanks((prev) =>
      prev.map((b) => (b.name === bankName ? { ...b, phase: 'dismissing' } : b))
    )
    try {
      await fetch('/api/platform-dispatches/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: dealId, bank_name: bankName }),
      })
    } catch {
      // Fail silently — bank is removed from UI regardless
    }
    // Remove bank from local list; if all gone, card disappears
    const updated = banks.map((b) =>
      b.name === bankName ? { ...b, sent: true, phase: 'done' as BankPhase } : b
    )
    setBanks(updated)
    if (updated.every((b) => b.sent || b.phase === 'done')) {
      setLeaving(true)
      setTimeout(onAllSent, 600)
    }
  }

  async function markSent(bankName: PlatformBankName) {
    setBanks((prev) =>
      prev.map((b) => (b.name === bankName ? { ...b, phase: 'loading' } : b))
    )

    try {
      const res = await fetch('/api/platform-dispatches/mark-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: dealId, bank_name: bankName }),
      })
      const data = await res.json()

      if (!res.ok) {
        setBanks((prev) =>
          prev.map((b) =>
            b.name === bankName ? { ...b, phase: 'error', error: data?.error ?? 'Error' } : b
          )
        )
        return
      }

      // Mark bank as done
      const updated = banks.map((b) =>
        b.name === bankName ? { ...b, sent: true, phase: 'done' as BankPhase } : b
      )
      setBanks(updated)

      // If all banks done → animate out and notify parent
      if (updated.every((b) => b.sent || b.phase === 'done')) {
        setLeaving(true)
        setTimeout(onAllSent, 600)
      }
    } catch {
      setBanks((prev) =>
        prev.map((b) =>
          b.name === bankName ? { ...b, phase: 'error', error: 'Error de red' } : b
        )
      )
    }
  }

  const pendingCount = banks.filter((b) => b.phase !== 'done').length

  return (
    <div
      className={`rounded-xl border bg-white shadow-sm transition-all duration-500 ${
        leaving ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100">
        <div className="min-w-0">
          <a
            href={`https://mdsl.pipedrive.com/deal/${dealId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-semibold text-gray-900 hover:text-indigo-700 truncate underline decoration-dotted"
          >
            {dealTitle}
          </a>
          {personName && (
            <p className="mt-0.5 text-xs text-gray-500 truncate">{personName}</p>
          )}
          <p className="mt-0.5 text-xs text-gray-400 tabular-nums">Deal #{dealId}</p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
          {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Banks checklist */}
      <div className="px-5 py-4 flex flex-col gap-2">
        {banks.map((bank) => (
          <div key={bank.name} className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            {/* Status indicator / trash button */}
            {bank.phase === 'done' ? (
              <div className="h-5 w-5 shrink-0 rounded flex items-center justify-center border bg-green-500 border-green-500">
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : bank.phase === 'loading' || bank.phase === 'dismissing' ? (
              <div className="h-5 w-5 shrink-0 rounded border bg-gray-200 border-gray-300 animate-pulse" />
            ) : (
              <button
                onClick={() => startDismissConfirm(bank.name)}
                title="Descartar este envío"
                className="h-5 w-5 shrink-0 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}

            {/* Bank name badge */}
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${BANK_COLOR[bank.name]} ${
                bank.phase === 'done' ? 'opacity-50' : ''
              }`}
            >
              {bank.name}
            </span>
            {/* Hipoteca Joven badge — only for Santander when conditions are met */}
            {bank.name === 'Santander' && (() => {
              const info = santander_info
              if (!info) return null
              const jovenAge =
                (info.edad_1t !== null && !isNaN(info.edad_1t) && info.edad_1t <= 35) ||
                (info.edad_2t !== null && !isNaN(info.edad_2t) && info.edad_2t <= 35)
              // pct_hipoteca is stored as decimal (e.g. 0.9 = 90%)
              const jovenPct =
                info.pct_hipoteca !== null && !isNaN(info.pct_hipoteca) && info.pct_hipoteca > 0.9
              if (!jovenAge || !jovenPct) return null
              return (
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold bg-yellow-50 text-yellow-700 border-yellow-300">
                  ✦ Hipoteca Joven
                </span>
              )
            })()}

            {/* Action buttons */}
            <div className="ml-auto flex items-center gap-1.5">
              {bank.phase === 'idle' && (
                <button
                  onClick={() => startConfirm(bank.name)}
                  className="rounded px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                  Marcar enviado
                </button>
              )}

              {bank.phase === 'dismiss_confirming' && (
                <>
                  <span className="text-xs text-gray-600">¿Descartar?</span>
                  <button
                    onClick={() => void dismissBank(bank.name)}
                    className="rounded px-2.5 py-1 text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    Sí
                  </button>
                  <button
                    onClick={() => cancelDismiss(bank.name)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    No
                  </button>
                </>
              )}

              {bank.phase === 'confirming' && (
                <>
                  <span className="text-xs text-gray-600">¿Confirmar envío?</span>
                  <button
                    onClick={() => markSent(bank.name)}
                    className="rounded px-2.5 py-1 text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
                  >
                    Sí
                  </button>
                  <button
                    onClick={() => cancelConfirm(bank.name)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    No
                  </button>
                </>
              )}

              {bank.phase === 'loading' && (
                <span className="text-xs text-gray-400">Registrando…</span>
              )}

              {bank.phase === 'done' && (
                <span className="text-xs text-green-600 font-medium">✓ Enviado</span>
              )}

              {bank.phase === 'error' && (
                <>
                  <span className="text-xs text-red-600">{bank.error}</span>
                  <button
                    onClick={() => setBanks((prev) =>
                      prev.map((b) => b.name === bank.name ? { ...b, phase: 'idle' } : b)
                    )}
                    className="text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    Reintentar
                  </button>
                </>
              )}
            </div>
          </div>
          {/* Santander Hipoteca Joven extra fields */}
          {bank.name === 'Santander' && (() => {
            const info = santander_info
            if (!info) return null
            const jovenAge =
              (info.edad_1t !== null && !isNaN(info.edad_1t) && info.edad_1t <= 35) ||
              (info.edad_2t !== null && !isNaN(info.edad_2t) && info.edad_2t <= 35)
            // pct_hipoteca is stored as decimal (e.g. 0.9 = 90%)
            const jovenPct =
              info.pct_hipoteca !== null && !isNaN(info.pct_hipoteca) && info.pct_hipoteca > 0.9
            if (!jovenAge || !jovenPct) return null
            const pctDisplay = info.pct_hipoteca !== null
              ? `${Math.round(info.pct_hipoteca * 100)}%`
              : '—'
            return (
              <div className="pl-8 flex flex-wrap gap-3 mt-0.5">
                <div className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="text-gray-400">Edad 1T</span>
                  <span className="font-semibold text-gray-800">{info.edad_1t ?? '—'}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="text-gray-400">% Hipoteca</span>
                  <span className="font-semibold text-gray-800">{pctDisplay}</span>
                </div>
                {info.edad_2t !== null && (
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <span className="text-gray-400">Edad 2T</span>
                    <span className="font-semibold text-gray-800">{info.edad_2t}</span>
                  </div>
                )}
              </div>
            )
          })()}
          {/* Note cell per bank — always writes to banking deal, never to the general deal */}
          {bank.phase !== 'done' && bank.bank_deal_id && (
            <div className="pl-8">
              <NotesCell
                dealId={bank.bank_deal_id}
                sheetRowId={bank.sheet_row_id ?? ''}
                initialNotes={bank.notes ?? []}
              />
            </div>
          )}
          </div>
        ))}
      </div>

    </div>
  )
}
