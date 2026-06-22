'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

export default function DateRangeFilter({
  dateFrom,
  dateTo,
}: {
  dateFrom?: string
  dateTo?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      params.delete('page')
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Desde</span>
      <input
        type="date"
        defaultValue={dateFrom ?? ''}
        onChange={(e) => update('date_from', e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <span className="text-xs text-gray-500">Hasta</span>
      <input
        type="date"
        defaultValue={dateTo ?? ''}
        onChange={(e) => update('date_to', e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  )
}
