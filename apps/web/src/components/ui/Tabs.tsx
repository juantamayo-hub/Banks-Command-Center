import Link from 'next/link'

interface Tab {
  label: string
  href: string
  count?: number
  active?: boolean
}

interface TabsProps {
  tabs: Tab[]
}

export default function Tabs({ tabs }: TabsProps) {
  return (
    <div className="flex border-b border-gray-200">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            tab.active
              ? 'border-b-2 border-gray-900 text-gray-900'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <>
              &nbsp;
              <span className="text-xs tabular-nums">
                ({tab.count.toLocaleString('es-ES')})
              </span>
            </>
          )}
        </Link>
      ))}
    </div>
  )
}
