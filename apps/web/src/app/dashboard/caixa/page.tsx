import Link from 'next/link'
import Image from 'next/image'
import PageHeader from '@/components/ui/PageHeader'

export default function CaixaPage() {
  return (
    <div className="p-6">
      <div className="mb-8 flex items-center gap-4">
        <Image src="/caixabank.png" alt="CaixaBank" width={160} height={48} className="object-contain" />
        <PageHeader
          title="CaixaBank"
          subtitle="Módulos específicos para la gestión de operaciones Caixa."
          breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
        {/* Respuestas */}
        <Link
          href="/dashboard/caixa/respuestas"
          className="group block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 hover:shadow-sm transition-all"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
            <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">
            Dossier CaixaBank
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Sube el Excel diario de CaixaBank para añadir notas en Pipedrive y
            marcar deals cerrados con el motivo correcto.
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-blue-600 group-hover:underline">
            Subir Excel →
          </span>
        </Link>

        {/* Requests */}
        <Link
          href="/dashboard/caixa/requests"
          className="group block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 hover:shadow-sm transition-all"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
            <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-emerald-700">
            Requests
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Gestión de consultas y solicitudes salientes a CaixaBank.
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:underline">
            Gestionar →
          </span>
        </Link>
      </div>
    </div>
  )
}
