'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

interface Bank {
  slug: string
  name: string
}

interface BankFilterProps {
  banks: Bank[]
  currentBank?: string
}

export default function BankFilter({ banks, currentBank }: BankFilterProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const params = new URLSearchParams(searchParams.toString())
      const value = e.target.value

      if (value) {
        params.set('bank', value)
      } else {
        params.delete('bank')
      }

      // Reset to page 1 when changing bank filter
      params.delete('page')

      router.push(`/dashboard?${params.toString()}`)
    },
    [router, searchParams]
  )

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="bank-filter" className="text-sm font-medium text-gray-700">
        Banco
      </label>
      <select
        id="bank-filter"
        value={currentBank ?? ''}
        onChange={handleChange}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">Todos los bancos</option>
        {banks.map((bank) => (
          <option key={bank.slug} value={bank.slug}>
            {bank.name}
          </option>
        ))}
      </select>
    </div>
  )
}
