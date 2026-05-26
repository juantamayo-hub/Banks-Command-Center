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
  { label: 'Métricas', href: '/dashboard/metricas' },
]

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bayteca-cream)' }}>
      {/* Sidebar — Bayteca forest green */}
      <aside
        className="flex w-60 flex-shrink-0 flex-col"
        style={{ background: 'var(--bayteca-green)', borderRight: '1px solid var(--bayteca-green-dark)' }}
      >
        {/* Wordmark */}
        <div
          className="flex h-16 items-center px-5"
          style={{ borderBottom: '1px solid var(--bayteca-green-dark)' }}
        >
          <span
            className="text-base font-semibold leading-tight text-white tracking-tight"
            style={{ fontFamily: 'var(--font-fraunces)' }}
          >
            bayteca<sup className="text-[9px] opacity-60 ml-0.5">™</sup>
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
          {/* Top-level links */}
          <div className="flex flex-col gap-0.5">
            {TOP_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="sidebar-link">
                {item.label}
              </Link>
            ))}
          </div>

          {/* Caixa section */}
          <div className="mt-6">
            <p
              className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--bayteca-green-light)' }}
            >
              Caixa
            </p>
            <div className="flex flex-col gap-0.5">
              <Link href="/dashboard/caixa/respuestas" className="sidebar-link sidebar-link-sm">
                📥 Respuestas
              </Link>
              <Link href="/dashboard/caixa/requests" className="sidebar-link sidebar-link-sm">
                📤 Requests
              </Link>
            </div>
          </div>

          {/* Bancos section */}
          <div className="mt-6">
            <p
              className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--bayteca-green-light)' }}
            >
              Bancos
            </p>
            <div className="flex flex-col gap-0.5">
              {ACTIVE_BANKS.map((bank) => (
                <Link
                  key={bank.slug}
                  href={`/dashboard/bancos/${bank.slug}`}
                  className="sidebar-link sidebar-link-sm"
                >
                  {bank.name}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div
          className="px-5 py-3"
          style={{ borderTop: '1px solid var(--bayteca-green-dark)' }}
        >
          <p className="text-xs" style={{ color: 'var(--bayteca-green-light)' }}>
            Banks Command Center
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main
        className="flex flex-1 flex-col overflow-y-auto"
        style={{ background: 'var(--bayteca-cream)' }}
      >
        {children}
      </main>
    </div>
  )
}
