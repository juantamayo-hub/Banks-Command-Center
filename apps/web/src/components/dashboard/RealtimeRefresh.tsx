'use client'

/**
 * Refresca la página cuando cambia una línea de envío del Command Center (Supabase Realtime sobre sheet_rows,
 * solo engine = 'cc'). Así lo que sale desaparece solo de Pendientes y lo que se bloquea aparece al momento.
 * Las líneas de la hoja no se escuchan: el sync de Apps Script las reescribe cada minuto y refrescaría sin parar.
 * Se pausa mientras se escribe en un campo de texto (no se pierde la nota a medias).
 */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const DEBOUNCE_MS = 1500

export default function RealtimeRefresh() {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const el = document.activeElement
        if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
          refresh()   // el usuario está escribiendo: se reintenta después
          return
        }
        router.refresh()
      }, DEBOUNCE_MS)
    }
    const channel = supabase
      .channel('cc-dispatch-rows')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sheet_rows', filter: 'engine=eq.cc' }, refresh)
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [router])

  return null
}
