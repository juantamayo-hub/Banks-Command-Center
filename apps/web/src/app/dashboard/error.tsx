'use client'

import { useEffect } from 'react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[dashboard] Error boundary:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
      <div className="text-center">
        <p className="text-base font-medium text-gray-700">
          Algo salió mal al cargar el dashboard.
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {error.message ?? 'Error desconocido'}
        </p>
      </div>
      <button
        onClick={reset}
        className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
      >
        Reintentar
      </button>
    </div>
  )
}
