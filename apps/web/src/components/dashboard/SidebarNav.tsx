'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ACTIVE_BANKS } from '@/lib/banks'
import { getBankLogo } from '@/lib/bankLogos'

/**
 * Menú lateral. Solo presentación: cada entrada conserva su href y su criterio de "activo".
 * Iconos: Heroicons (outline, 24px) en línea — sin dependencias.
 */

const ICONS = {
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  send: 'M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5',
  plus: 'M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z',
  platform:
    'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25',
  inbox:
    'M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z',
  chart:
    'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  document:
    'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  chat:
    'M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z',
  upload: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5',
  refresh:
    'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99',
  check: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  bank:
    'M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z',
  sliders:
    'M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75',
  shield:
    'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  search: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
} as const
type IconName = keyof typeof ICONS

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[name]} />
    </svg>
  )
}

function NavLink({ href, label, icon, active }: { href: string; label: string; icon: IconName; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={active ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}>
      <Icon name={icon} />
      <span className="truncate">{label}</span>
    </Link>
  )
}

function SectionTitle({ children, logo }: { children: React.ReactNode; logo?: string | null }) {
  return (
    <p className="mb-1.5 flex items-center gap-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/40">
      {logo && (
        <span className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-white p-[1px]">
          <Image src={logo} alt="" width={14} height={14} className="object-contain" />
        </span>
      )}
      {children}
    </p>
  )
}

function Section({ title, logo, children }: { title: string; logo?: string | null; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <SectionTitle logo={logo}>{title}</SectionTitle>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

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
  const [bancosOpen, setBancosOpen] = useState(false)

  const filteredBanks = bankSearch
    ? ACTIVE_BANKS.filter((b) =>
        b.name.toLowerCase().includes(bankSearch.toLowerCase())
      )
    : ACTIVE_BANKS

  const isOnBankPage = pathname.startsWith('/dashboard/bancos/')
  const top = (href: string) => isActive(href, pathname, tab)

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-5">
      <Section title="Envíos">
        <NavLink href="/dashboard?tab=pendientes" label="Pendientes" icon="clock" active={top('/dashboard?tab=pendientes')} />
        <NavLink href="/dashboard?tab=enviados" label="Enviados" icon="send" active={top('/dashboard?tab=enviados')} />
        <NavLink href="/dashboard/nuevo-envio" label="Nuevo envío" icon="plus" active={top('/dashboard/nuevo-envio')} />
        <NavLink href="/dashboard/envios-plataforma" label="Envíos por plataforma" icon="platform" active={top('/dashboard/envios-plataforma')} />
      </Section>

      <Section title="Seguimiento">
        <NavLink href="/dashboard/ofertas" label="Ofertas recibidas" icon="inbox" active={top('/dashboard/ofertas')} />
        <NavLink href="/dashboard/metricas" label="Métricas" icon="chart" active={top('/dashboard/metricas')} />
      </Section>

      <Section title="CaixaBank" logo={getBankLogo('caixabank')}>
        <NavLink href="/dashboard/caixa/respuestas" label="Dossier" icon="document" active={pathname.startsWith('/dashboard/caixa/respuestas')} />
        <NavLink href="/dashboard/caixa/requests" label="Requests" icon="chat" active={pathname.startsWith('/dashboard/caixa/requests')} />
      </Section>

      <Section title="Kutxabank" logo={getBankLogo('kutxabank')}>
        <NavLink href="/dashboard/kutxabank/envios" label="Procesar envíos" icon="upload" active={pathname === '/dashboard/kutxabank/envios'} />
        <NavLink href="/dashboard/kutxabank/estados" label="Procesar estados" icon="refresh" active={pathname === '/dashboard/kutxabank/estados'} />
      </Section>

      <Section title="Préstamos">
        <NavLink
          href="/dashboard/prestamos"
          label="Pendientes"
          icon="clock"
          active={pathname === '/dashboard/prestamos' && !searchParams.get('vista')}
        />
        <NavLink
          href="/dashboard/prestamos?vista=enviados"
          label="Enviados"
          icon="check"
          active={pathname === '/dashboard/prestamos' && searchParams.get('vista') === 'enviados'}
        />
      </Section>

      <Section title="Configuración">
        <NavLink
          href="/dashboard/configuracion"
          label="Bancos"
          icon="bank"
          active={
            pathname.startsWith('/dashboard/configuracion') &&
            !['/dashboard/configuracion/ajustes', '/dashboard/configuracion/regla-general'].includes(pathname)
          }
        />
        <NavLink href="/dashboard/configuracion/regla-general" label="Regla general" icon="sliders" active={pathname === '/dashboard/configuracion/regla-general'} />
        <NavLink href="/dashboard/configuracion/ajustes" label="Bloqueados y editores" icon="shield" active={pathname === '/dashboard/configuracion/ajustes'} />
      </Section>

      {/* Bancos — plegable con buscador */}
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setBancosOpen(!bancosOpen)}
          aria-expanded={bancosOpen || isOnBankPage}
          className="mb-1.5 flex w-full items-center justify-between rounded-md px-3 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/40 transition-colors hover:text-white/70"
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
            <div className="relative mb-1.5 px-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-white/30">
                <Icon name="search" />
              </span>
              <input
                type="text"
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                placeholder="Buscar banco..."
                className="w-full rounded-md border-0 bg-white/10 py-1.5 pl-8 pr-2.5 text-xs text-white placeholder-white/30 outline-none transition-colors focus:bg-white/15"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              {filteredBanks.map((bank) => {
                const logo = getBankLogo(bank.slug)
                return (
                  <Link
                    key={bank.slug}
                    href={`/dashboard/bancos/${bank.slug}`}
                    className={
                      pathname === `/dashboard/bancos/${bank.slug}`
                        ? 'sidebar-link sidebar-link-active'
                        : 'sidebar-link'
                    }
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-white">
                      {logo ? (
                        <Image src={logo} alt="" width={14} height={14} className="object-contain" />
                      ) : (
                        <span className="text-[9px] font-bold text-bayteca-green">{bank.name.charAt(0)}</span>
                      )}
                    </span>
                    <span className="truncate">{bank.name}</span>
                  </Link>
                )
              })}
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
