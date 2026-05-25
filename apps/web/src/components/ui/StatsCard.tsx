import Link from 'next/link'

interface StatsCardProps {
  label: string
  value: number
  href?: string
  color?: string
}

export default function StatsCard({ label, value, href, color = 'text-gray-900' }: StatsCardProps) {
  const content = (
    <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col gap-1 hover:shadow-sm transition-shadow">
      <span className={`text-3xl font-bold tabular-nums ${color}`}>
        {value.toLocaleString('es-ES')}
      </span>
      <span className="text-sm text-gray-500">{label}</span>
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    )
  }

  return content
}
