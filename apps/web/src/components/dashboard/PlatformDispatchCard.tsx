'use client'

import { useState } from 'react'
import NoteBox from '@/components/dashboard/NoteBox'
import { BANK_COLOR, type PlatformBankName } from '@/lib/platformDispatch'

interface BankItem {
  name: PlatformBankName
  sent: boolean
  bank_deal_id: number | null
}

interface PlatformDispatchCardProps {
  dealId: number
  dealTitle: string
  personName: string | null
  banks: BankItem[]
  onAllSent: () => void  // called when every bank is marked sent → card disappears
}

type BankPhase = 'idle' | 'confirming' | 'loading' | 'done' | 'error'

export default function PlatformDispatchCard({
  dealId,
  dealTitle,
  personName,
  banks: initialBanks,
  onAllSent,
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
            {/* Status indicator */}
            <div
              className={`h-5 w-5 shrink-0 rounded flex items-center justify-center border transition-colors ${
                bank.phase === 'done'
                  ? 'bg-green-500 border-green-500'
                  : bank.phase === 'loading'
                  ? 'bg-gray-200 border-gray-300 animate-pulse'
                  : 'bg-white border-gray-300'
              }`}
            >
              {bank.phase === 'done' && (
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>

            {/* Bank name badge */}
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${BANK_COLOR[bank.name]} ${
                bank.phase === 'done' ? 'opacity-50' : ''
              }`}
            >
              {bank.name}
            </span>

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
          {/* Note box per bank — writes to the banking deal, not the general deal */}
          {bank.bank_deal_id && bank.phase !== 'done' && (
            <div className="pl-8">
              <NoteBox dealId={bank.bank_deal_id} />
            </div>
          )}
          </div>
        ))}
      </div>

    </div>
  )
}
