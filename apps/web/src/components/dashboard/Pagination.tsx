'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

interface PaginationProps {
  totalCount: number
  currentPage: number
  pageSize: number
}

export default function Pagination({ totalCount, currentPage, pageSize }: PaginationProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const totalPages = Math.ceil(totalCount / pageSize)

  const navigate = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (page <= 1) {
        params.delete('page')
      } else {
        params.set('page', String(page))
      }
      router.push(`/dashboard?${params.toString()}`)
    },
    [router, searchParams]
  )

  if (totalPages <= 1) return null

  const from = (currentPage - 1) * pageSize + 1
  const to = Math.min(currentPage * pageSize, totalCount)

  return (
    <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3">
      <p className="text-sm text-gray-700">
        Mostrando{' '}
        <span className="font-medium">{from}</span>
        {' '}a{' '}
        <span className="font-medium">{to}</span>
        {' '}de{' '}
        <span className="font-medium">{totalCount.toLocaleString('es-ES')}</span>
        {' '}resultados
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => navigate(currentPage - 1)}
          disabled={currentPage <= 1}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Anterior
        </button>
        <span className="flex items-center px-2 text-sm text-gray-700">
          Pagina {currentPage} de {totalPages}
        </span>
        <button
          onClick={() => navigate(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>
    </div>
  )
}
