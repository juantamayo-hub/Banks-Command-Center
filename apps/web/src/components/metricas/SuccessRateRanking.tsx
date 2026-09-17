'use client'

import Link from 'next/link'
import Image from 'next/image'
import { getBankLogo, getBankAvatarColor } from '@/lib/bankLogos'

interface BankRate {
  slug: string
  name: string
  rate: number
  total: number
  color: string
}

interface SuccessRateRankingProps {
  title: string
  subtitle: string
  banks: BankRate[]
  metric: string
}

export default function SuccessRateRanking({
  title,
  subtitle,
  banks,
  metric,
}: SuccessRateRankingProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mb-5 text-xs text-gray-400">{subtitle}</p>
      <div className="flex flex-col gap-4">
        {banks.map((b, i) => {
          const logo = getBankLogo(b.slug)
          const avatarColor = getBankAvatarColor(b.slug)
          return (
            <div key={b.slug} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-50 text-[11px] font-bold text-gray-400">
                {i + 1}
              </span>
              {logo ? (
                <Image src={logo} alt="" width={24} height={24} className="shrink-0 rounded object-contain" />
              ) : (
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white ${avatarColor}`}>
                  {b.name.charAt(0)}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <Link
                  href={`/dashboard/bancos/${b.slug}`}
                  className="text-sm font-medium text-gray-800 hover:text-blue-600 transition-colors truncate block"
                >
                  {b.name}
                </Link>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(b.rate, 100)}%`,
                      background: `linear-gradient(90deg, ${b.color}88, ${b.color})`,
                    }}
                  />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-lg font-extrabold tabular-nums" style={{ color: b.color }}>
                  {b.rate}%
                </span>
                <span className="block text-[10px] tabular-nums text-gray-400">
                  {b.total.toLocaleString('es-ES')} {metric}
                </span>
              </div>
            </div>
          )
        })}
        {banks.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-300">Sin datos suficientes</p>
        )}
      </div>
    </div>
  )
}
