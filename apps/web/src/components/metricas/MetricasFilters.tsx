'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import Image from 'next/image'
import { getBankLogo } from '@/lib/bankLogos'

interface Bank {
  slug: string
  name: string
}

interface MetricasFiltersProps {
  banks: Bank[]
  currentBank?: string
  dateFrom?: string
  dateTo?: string
}

export default function MetricasFilters({
  banks,
  currentBank,
  dateFrom,
  dateTo,
}: MetricasFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, searchParams, pathname]
  )

  const clearAll = useCallback(() => {
    router.push(pathname)
  }, [router, pathname])

  const hasFilters = currentBank || dateFrom || dateTo

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Bank filter */}
      <div className="flex items-center gap-1.5">
        <select
          value={currentBank ?? ''}
          onChange={(e) => updateParam('bank', e.target.value || null)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all"
        >
          <option value="">Todos los bancos</option>
          {banks.map((bank) => (
            <option key={bank.slug} value={bank.slug}>
              {bank.name}
            </option>
          ))}
        </select>
        {currentBank && (
          (() => {
            const logo = getBankLogo(currentBank)
            return logo ? (
              <Image src={logo} alt="" width={20} height={20} className="rounded object-contain" />
            ) : null
          })()
        )}
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={dateFrom ?? ''}
          onChange={(e) => updateParam('date_from', e.target.value || null)}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all"
          placeholder="Desde"
        />
        <span className="text-xs text-gray-400">—</span>
        <input
          type="date"
          value={dateTo ?? ''}
          onChange={(e) => updateParam('date_to', e.target.value || null)}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all"
          placeholder="Hasta"
        />
      </div>

      {/* Clear button */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  )
}
