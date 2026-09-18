'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ACTIVE_BANKS } from '@/lib/banks'

interface NavItem {
  label: string
  href: string
}

const TOP_NAV: NavItem[] = [
  { label: 'Pendientes', href: '/dashboard?tab=pendientes' },
  { label: 'Enviados', href: '/dashboard?tab=enviados' },
  { label: 'Envíos por plataforma', href: '/dashboard/envios-plataforma' },
  { label: 'Nuevo envío', href: '/dashboard/nuevo-envio' },
  { label: 'Métricas', href: '/dashboard/metricas' },
]

const SECTION_LABEL = 'mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-white/45'

function isActive(href: string, pathname: string, tab: string | null): boolean {
  if (href.startsWith('/dashboard/') && !href.includes('?')) {
    return pathname === href || pathname.startsWith(href + '/')
  }
  if (href === '/dashboard?tab=pendientes') {
    return pathname === '/dashboard' && (tab === 'pendientes' || tab === null)
  }
  if (href === '/dashboard?tab=enviados') {
    return pathname === '/dashboard' && tab === 'enviados'
  }
  return false
}

export default function SidebarNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const [bankSearch, setBankSearch] = useState('')
  const [bancosOpen, setBancosOpen] = useState(true)

  const filteredBanks = bankSearch
    ? ACTIVE_BANKS.filter((b) =>
        b.name.toLowerCase().includes(bankSearch.toLowerCase())
      )
    : ACTIVE_BANKS

  const isOnBankPage = pathname.startsWith('/dashboard/bancos/')

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
      {/* Top-level links */}
      <div className="flex flex-col gap-0.5">
        {TOP_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={
              isActive(item.href, pathname, tab)
                ? 'sidebar-link sidebar-link-active'
                : 'sidebar-link'
            }
          >
            {item.label}
          </Link>
        ))}
      </div>

      {/* CaixaBank section */}
      <div className="mt-6">
        <p className={SECTION_LABEL}>CaixaBank</p>
        <div className="flex flex-col gap-0.5">
          <Link
            href="/dashboard/caixa/respuestas"
            className={
              pathname.startsWith('/dashboard/caixa/respuestas')
                ? 'sidebar-link sidebar-link-sm sidebar-link-active'
                : 'sidebar-link sidebar-link-sm'
            }
          >
            Dossier
          </Link>
          <Link
            href="/dashboard/caixa/requests"
            className={
              pathname.startsWith('/dashboard/caixa/requests')
                ? 'sidebar-link sidebar-link-sm sidebar-link-active'
                : 'sidebar-link sidebar-link-sm'
            }
          >
            Requests
          </Link>
        </div>
      </div>

      {/* Kutxabank section */}
      <div className="mt-6">
        <p className={SECTION_LABEL}>Kutxabank</p>
        <div className="flex flex-col gap-0.5">
          <Link
            href="/dashboard/kutxabank/envios"
            className={
              pathname === '/dashboard/kutxabank/envios'
                ? 'sidebar-link sidebar-link-sm sidebar-link-active'
                : 'sidebar-link sidebar-link-sm'
            }
          >
            Procesar Envíos
          </Link>
          <Link
            href="/dashboard/kutxabank/estados"
            className={
              pathname === '/dashboard/kutxabank/estados'
                ? 'sidebar-link sidebar-link-sm sidebar-link-active'
                : 'sidebar-link sidebar-link-sm'
            }
          >
            Procesar Estados
          </Link>
        </div>
      </div>

      {/* Bancos section — collapsible with search */}
      <div className="mt-6">
        <button
          onClick={() => setBancosOpen(!bancosOpen)}
          className={`${SECTION_LABEL} flex w-full items-center justify-between`}
        >
          <span>Bancos</span>
          <svg
            className={`h-3 w-3 transition-transform ${bancosOpen || isOnBankPage ? 'rotate-0' : '-rotate-90'}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {(bancosOpen || isOnBankPage) && (
          <>
            {/* Bank search */}
            <div className="px-1 mb-1.5">
              <input
                type="text"
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                placeholder="Buscar banco..."
                className="w-full rounded-md border-0 bg-white/10 px-2.5 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:bg-white/15 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              {filteredBanks.map((bank) => (
                <Link
                  key={bank.slug}
                  href={`/dashboard/bancos/${bank.slug}`}
                  className={
                    pathname === `/dashboard/bancos/${bank.slug}`
                      ? 'sidebar-link sidebar-link-sm sidebar-link-active'
                      : 'sidebar-link sidebar-link-sm'
                  }
                >
                  {bank.name}
                </Link>
              ))}
              {filteredBanks.length === 0 && (
                <p className="px-3 py-2 text-xs text-white/30">
                  Sin resultados
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </nav>
  )
}
