import Link from 'next/link'
import type { ReactNode } from 'react'

interface Crumb {
  label: string
  href: string
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  breadcrumbs?: Crumb[]
  actions?: ReactNode
}

export default function PageHeader({ title, subtitle, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="mb-1 flex items-center gap-1 text-xs text-gray-400">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <Link href={crumb.href} className="hover:text-gray-600 transition-colors">
                  {crumb.label}
                </Link>
              </span>
            ))}
            <span>/</span>
            <span className="text-gray-500">{title}</span>
          </nav>
        )}
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}
