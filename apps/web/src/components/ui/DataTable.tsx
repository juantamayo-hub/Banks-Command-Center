import type { ReactNode } from 'react'

interface Column {
  label: string
  align?: 'left' | 'right'
}

interface DataTableProps {
  columns: Column[]
  children: ReactNode
}

export default function DataTable({ columns, children }: DataTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.label}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {children}
          </tbody>
        </table>
      </div>
    </div>
  )
}
