'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface BankRow {
  slug: string
  name: string
  total: number
  sent: number
  blocked: number
  pending: number
  failed: number
  offers: number
  successRate: number
}

interface BankPerformanceChartProps {
  banks: BankRow[]
}

const COLORS = {
  sent: '#22c55e',
  blocked: '#f97316',
  pending: '#3b82f6',
  failed: '#ef4444',
  offers: '#10b981',
}

export default function BankPerformanceChart({ banks }: BankPerformanceChartProps) {
  // Sort by total descending, take top 15 to avoid overcrowding
  const chartData = banks.slice(0, 15).map((b) => ({
    name: b.name.length > 18 ? b.name.slice(0, 16) + '...' : b.name,
    fullName: b.name,
    Enviados: b.sent,
    Bloqueados: b.blocked,
    Pendientes: b.pending,
    Fallidos: b.failed,
    total: b.total,
    successRate: b.successRate,
  }))

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
          barCategoryGap="20%"
        >
          <XAxis type="number" tick={{ fontSize: 12, fill: '#6b7280' }} />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tick={{ fontSize: 12, fill: '#374151' }}
          />
          <Tooltip
            contentStyle={{
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              fontSize: '13px',
            }}
            formatter={(value, name) => [
              Number(value).toLocaleString('es-ES'),
              String(name),
            ]}
            labelFormatter={(label, payload) => {
              const item = payload?.[0]?.payload as Record<string, unknown> | undefined
              if (!item) return String(label)
              return `${item.fullName} — ${Number(item.total).toLocaleString('es-ES')} total (${item.successRate}% éxito)`
            }}
          />
          <Bar dataKey="Enviados" stackId="a" fill={COLORS.sent} radius={[0, 0, 0, 0]} />
          <Bar dataKey="Bloqueados" stackId="a" fill={COLORS.blocked} />
          <Bar dataKey="Pendientes" stackId="a" fill={COLORS.pending} />
          <Bar dataKey="Fallidos" stackId="a" fill={COLORS.failed} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
