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

interface ClusterEntry {
  label: string
  count: number
  color: string
  pct: number
}

interface RedFlagBarChartProps {
  clusters: ClusterEntry[]
}

// Extract tailwind class to hex for recharts
function tailwindToHex(cls: string): string {
  const map: Record<string, string> = {
    'bg-orange-100': '#fed7aa',
    'bg-red-100': '#fee2e2',
    'bg-red-200': '#fecaca',
    'bg-yellow-100': '#fef9c3',
    'bg-amber-100': '#fef3c7',
    'bg-purple-100': '#f3e8ff',
    'bg-blue-100': '#dbeafe',
    'bg-indigo-100': '#e0e7ff',
    'bg-teal-100': '#ccfbf1',
    'bg-cyan-100': '#cffafe',
    'bg-slate-100': '#f1f5f9',
    'bg-zinc-100': '#f4f4f5',
    'bg-rose-100': '#ffe4e6',
    'bg-fuchsia-100': '#fae8ff',
    'bg-gray-100': '#f3f4f6',
  }
  // Extract the bg-xxx-100 part
  const bgClass = cls.split(' ').find((c) => c.startsWith('bg-'))
  // Use a darker variant for the bar
  const darkerMap: Record<string, string> = {
    'bg-orange-100': '#f97316',
    'bg-red-100': '#ef4444',
    'bg-red-200': '#dc2626',
    'bg-yellow-100': '#eab308',
    'bg-amber-100': '#f59e0b',
    'bg-purple-100': '#a855f7',
    'bg-blue-100': '#3b82f6',
    'bg-indigo-100': '#6366f1',
    'bg-teal-100': '#14b8a6',
    'bg-cyan-100': '#06b6d4',
    'bg-slate-100': '#64748b',
    'bg-zinc-100': '#71717a',
    'bg-rose-100': '#f43f5e',
    'bg-fuchsia-100': '#d946ef',
    'bg-lime-100': '#84cc16',
    'bg-emerald-100': '#10b981',
    'bg-gray-100': '#6b7280',
  }
  return darkerMap[bgClass ?? ''] ?? '#6b7280'
}

export default function RedFlagBarChart({ clusters }: RedFlagBarChartProps) {
  const chartData = clusters.slice(0, 12).map((c) => ({
    name: c.label.length > 22 ? c.label.slice(0, 20) + '...' : c.label,
    fullName: c.label,
    count: c.count,
    pct: c.pct,
    fill: tailwindToHex(c.color),
  }))

  return (
    <div className="h-[380px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
          barCategoryGap="18%"
        >
          <XAxis type="number" tick={{ fontSize: 12, fill: '#6b7280' }} />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            tick={{ fontSize: 12, fill: '#374151' }}
          />
          <Tooltip
            contentStyle={{
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              fontSize: '13px',
            }}
            formatter={(value) => [
              Number(value).toLocaleString('es-ES'),
              'Eventos',
            ]}
            labelFormatter={(label, payload) => {
              const item = payload?.[0]?.payload as Record<string, unknown> | undefined
              return item ? `${item.fullName} (${item.pct}%)` : String(label)
            }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
