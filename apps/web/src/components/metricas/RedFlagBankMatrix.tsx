'use client'

import Link from 'next/link'
import Image from 'next/image'

interface MatrixCell {
  count: number
  intensity: number // 0-1 for heat color
}

interface BankInfo {
  slug: string
  name: string
  logo: string | null
  avatarColor: string
}

interface RedFlagBankMatrixProps {
  clusters: string[] // top cluster labels
  banks: BankInfo[]
  matrix: MatrixCell[][] // [cluster][bank]
}

function heatColor(intensity: number): string {
  if (intensity === 0) return '#f9fafb'
  if (intensity < 0.15) return '#fef2f2'
  if (intensity < 0.3) return '#fee2e2'
  if (intensity < 0.5) return '#fecaca'
  if (intensity < 0.7) return '#fca5a5'
  if (intensity < 0.85) return '#f87171'
  return '#ef4444'
}

function textColor(intensity: number): string {
  return intensity >= 0.5 ? '#ffffff' : '#374151'
}

export default function RedFlagBankMatrix({
  clusters,
  banks,
  matrix,
}: RedFlagBankMatrixProps) {
  if (clusters.length === 0 || banks.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500" />
            {banks.map((bank) => (
              <th key={bank.slug} className="px-1.5 py-2 text-center">
                <Link
                  href={`/dashboard/bancos/${bank.slug}`}
                  className="inline-flex flex-col items-center gap-1 group"
                  title={bank.name}
                >
                  {bank.logo ? (
                    <Image
                      src={bank.logo}
                      alt={bank.name}
                      width={28}
                      height={28}
                      className="rounded-md object-contain group-hover:ring-2 group-hover:ring-blue-300 transition-all"
                    />
                  ) : (
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white group-hover:ring-2 group-hover:ring-blue-300 transition-all ${bank.avatarColor}`}
                    >
                      {bank.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="text-[10px] leading-tight text-gray-500 group-hover:text-blue-600 max-w-[48px] truncate">
                    {bank.name.length > 8 ? bank.name.slice(0, 7) + '.' : bank.name}
                  </span>
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clusters.map((cluster, i) => (
            <tr key={i} className="border-t border-gray-50">
              <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-gray-700">
                {cluster}
              </td>
              {banks.map((bank, j) => {
                const cell = matrix[i]?.[j]
                if (!cell || cell.count === 0) {
                  return (
                    <td key={j} className="px-1.5 py-2 text-center">
                      <span className="text-[10px] text-gray-200">&middot;</span>
                    </td>
                  )
                }
                return (
                  <td key={j} className="px-1.5 py-2 text-center">
                    <span
                      className="inline-flex h-7 min-w-[28px] items-center justify-center rounded text-xs font-semibold tabular-nums"
                      style={{
                        backgroundColor: heatColor(cell.intensity),
                        color: textColor(cell.intensity),
                      }}
                    >
                      {cell.count}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
