'use client'

import { useEffect, useState, useCallback } from 'react'

interface Insight {
  text: string
  type: 'info' | 'success' | 'warning'
}

const INTERVAL_MS = 3 * 60 * 1000   // fetch new insight every 3 min
const DISPLAY_MS  = 10 * 1000       // show toast for 10 sec
const INITIAL_DELAY_MS = 15 * 1000  // first toast after 15 sec

const ICONS: Record<string, string> = {
  info:    '💡',
  success: '✅',
  warning: '⚡',
}

const BG: Record<string, string> = {
  info:    'from-gray-800 to-gray-900',
  success: 'from-emerald-800 to-emerald-900',
  warning: 'from-amber-800 to-amber-900',
}

export default function SmartInsights() {
  const [insight, setInsight] = useState<Insight | null>(null)
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const fetchInsight = useCallback(async () => {
    try {
      const res = await fetch('/api/insights')
      if (!res.ok) return
      const data = await res.json()
      if (data.insight) {
        setInsight(data.insight)
        setDismissed(false)
        // Small delay before showing (allows animation)
        setTimeout(() => setVisible(true), 50)
        // Auto-hide after DISPLAY_MS
        setTimeout(() => setVisible(false), DISPLAY_MS)
      }
    } catch {
      // silently ignore
    }
  }, [])

  useEffect(() => {
    // First insight after initial delay
    const initialTimer = setTimeout(fetchInsight, INITIAL_DELAY_MS)
    // Then every INTERVAL_MS
    const interval = setInterval(fetchInsight, INTERVAL_MS)
    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [fetchInsight])

  function dismiss() {
    setVisible(false)
    setDismissed(true)
  }

  if (!insight || dismissed) return null

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 max-w-sm transition-all duration-500 ease-out ${
        visible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-4 opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`flex items-start gap-3 rounded-xl bg-gradient-to-br ${BG[insight.type]} px-4 py-3.5 shadow-2xl shadow-black/20 ring-1 ring-white/10 backdrop-blur`}
      >
        <span className="text-lg leading-none mt-0.5">{ICONS[insight.type]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium leading-snug text-white/90">
            {insight.text}
          </p>
          <p className="mt-1 text-[10px] text-white/40">Banks Command Center</p>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-full p-0.5 text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors"
          aria-label="Cerrar"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
