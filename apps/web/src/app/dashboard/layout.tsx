import type { ReactNode } from 'react'
import { Suspense } from 'react'
import SidebarNav from '@/components/dashboard/SidebarNav'
import SmartInsights from '@/components/dashboard/SmartInsights'
import UserMenu from '@/components/auth/UserMenu'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar — Bayteca forest green */}
      <aside className="flex w-60 flex-shrink-0 flex-col bg-bayteca-green border-r border-bayteca-green-dark">
        {/* Wordmark */}
        <div className="flex h-16 items-center px-5 border-b border-bayteca-green-dark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bayteca-logo.svg" alt="Bayteca" className="h-5" />
        </div>

        {/* Navigation — client component for active state */}
        <Suspense fallback={null}>
          <SidebarNav />
        </Suspense>

        {/* Footer — user info + sign out */}
        <div className="px-4 py-3 border-t border-bayteca-green-dark">
          <UserMenu />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-gray-50">
        {children}
      </main>

      {/* Non-intrusive insight toasts */}
      <SmartInsights />
    </div>
  )
}
