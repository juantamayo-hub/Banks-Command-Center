import Link from 'next/link'
import type { ReactNode } from 'react'
import { ACTIVE_BANKS } from '@/lib/banks'

interface NavItem {
  label: string
  href: string
}

const TOP_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Pendientes', href: '/dashboard?status=pending_ready' },
  { label: 'Enviados', href: '/dashboard?status=sent' },
  { label: 'Bloqueados', href: '/dashboard?status=blocked_red_flag,blocked_missing_docs,blocked_validation' },
  { label: 'Fallidos', href: '/dashboard?status=failed' },
  { label: 'Ofertas recibidas', href: '/dashboard?status=offer_received' },
  { label: 'Metricas', href: '/dashboard/metricas' },
]

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      {/* Sidebar */}
      <aside className="flex w-60 flex-shrink-0 flex-col bg-gray-900">
        {/* Logo */}
        <div className="flex h-16 items-center border-b border-gray-700 px-5">
          <span className="text-sm font-semibold leading-tight text-white">
            Banks Command Center
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
          {/* Top-level links */}
          <div className="flex flex-col gap-0.5">
            {TOP_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Bancos section */}
          <div className="mt-6">
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Bancos
            </p>
            <div className="flex flex-col gap-0.5">
              {ACTIVE_BANKS.map((bank) => (
                <Link
                  key={bank.slug}
                  href={`/dashboard/bancos/${bank.slug}`}
                  className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                >
                  {bank.name}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-700 px-5 py-3">
          <p className="text-xs text-gray-500">Migracion Bancos</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
