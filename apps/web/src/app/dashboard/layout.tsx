import type { ReactNode } from 'react'
import { Suspense } from 'react'
import SidebarNav from '@/components/dashboard/SidebarNav'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar — Bayteca forest green */}
      <aside className="flex w-60 flex-shrink-0 flex-col bg-bayteca-green border-r border-bayteca-green-dark">
        {/* Wordmark */}
        <div className="flex h-16 items-center px-5 border-b border-bayteca-green-dark">
          <span
            className="text-base font-semibold leading-tight text-white tracking-tight font-serif"
          >
            bayteca<sup className="text-[9px] opacity-60 ml-0.5">™</sup>
          </span>
        </div>

        {/* Navigation — client component for active state */}
        <Suspense fallback={null}>
          <SidebarNav />
        </Suspense>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-bayteca-green-dark">
          <p className="text-xs text-bayteca-green-light">
            Banks Command Center
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-gray-50">
        {children}
      </main>
    </div>
  )
}
