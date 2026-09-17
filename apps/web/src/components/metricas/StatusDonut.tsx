'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

interface StatusDonutProps {
  data: { name: string; value: number; color: string }[]
  total: number
}

const STATUS_LABELS: Record<string, string> = {
  sent: 'Enviados',
  blocked: 'Bloqueados',
  pending: 'Pendientes',
  failed: 'Fallidos',
  offers: 'Ofertas',
  other: 'Otros',
}

export default function StatusDonut({ data, total }: StatusDonutProps) {
  return (
    <div className="flex items-center gap-8">
      <div className="relative h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={88}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
              cornerRadius={4}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => {
                const v = Number(value)
                const n = String(name)
                return [
                  `${v.toLocaleString('es-ES')} (${total > 0 ? Math.round((v / total) * 100) : 0}%)`,
                  STATUS_LABELS[n] ?? n,
                ]
              }}
              contentStyle={{
                borderRadius: '12px',
                border: 'none',
                boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                fontSize: '13px',
                padding: '8px 14px',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold tabular-nums text-gray-900">
            {total.toLocaleString('es-ES')}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-widest text-gray-400">total</span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {data.filter((d) => d.value > 0).map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0
          return (
            <div key={d.name} className="flex items-center gap-2.5">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="min-w-[80px] text-sm text-gray-500">
                {STATUS_LABELS[d.name] ?? d.name}
              </span>
              <span className="text-sm font-bold tabular-nums text-gray-900">
                {d.value.toLocaleString('es-ES')}
              </span>
              <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-gray-400">
                {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
