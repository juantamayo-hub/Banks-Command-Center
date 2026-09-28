'use client'

import { useEffect } from 'react'

const KEY = 'ofertas-scroll'

/**
 * Mantiene la posición del scroll al cambiar filtros en Ofertas recibidas.
 * El esqueleto de carga del dashboard encoge la página y el <main> vuelve arriba;
 * guardamos la posición al pulsar un filtro y la restauramos al renderizar el resultado.
 */
export default function PreserveScroll({ token }: { token: string }) {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const a = (e.target as HTMLElement | null)?.closest('a[data-keep-scroll]')
      const main = document.querySelector('main')
      if (a && main) sessionStorage.setItem(KEY, String(main.scrollTop))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    let saved: string | null = null
    try { saved = sessionStorage.getItem(KEY) } catch { return }
    if (saved === null) return
    sessionStorage.removeItem(KEY)
    const main = document.querySelector('main')
    if (main) main.scrollTop = Number(saved)
  }, [token])

  return null
}
