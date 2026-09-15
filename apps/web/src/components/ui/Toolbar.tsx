import type { ReactNode } from 'react'

interface ToolbarProps {
  children: ReactNode
}

export default function Toolbar({ children }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
      {children}
    </div>
  )
}
