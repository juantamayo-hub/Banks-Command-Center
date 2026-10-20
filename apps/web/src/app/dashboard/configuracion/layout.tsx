import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { bankConfigEnabled } from '@/lib/featureFlags'

// Configuración de bancos: solo visible en staging hasta su revisión
export default function ConfiguracionLayout({ children }: { children: ReactNode }) {
  if (!bankConfigEnabled()) notFound()
  return children
}
