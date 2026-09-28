'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/** Buscador por cliente (nombre/apellido) o deal ID. Actualiza ?q= sin mover el scroll. */
export default function OfertasSearch({ initial }: { initial: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function navigate(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    const q = next.trim()
    if (q) params.set('q', q)
    else params.delete('q')
    if ((params.get('q') ?? '') === (searchParams.get('q') ?? '')) return
    const main = document.querySelector('main')
    if (main) sessionStorage.setItem('ofertas-scroll', String(main.scrollTop))
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  function onChange(next: string) {
    setValue(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => navigate(next), 450)
  }

  return (
    <div className="relative w-full sm:w-80">
      <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.47 9.77l3.63 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.63A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (timer.current) clearTimeout(timer.current)
            navigate(value)
          }
        }}
        placeholder="Buscar cliente, apellido o deal ID"
        className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
      />
    </div>
  )
}
