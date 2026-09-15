import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'

export default function CaixaRequestsPage() {
  return (
    <div className="p-6">
      <div className="mb-8">
        <PageHeader
          title="Caixa Requests"
          subtitle="Gestión de consultas y solicitudes con CaixaBank."
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'CaixaBank', href: '/dashboard/caixa/respuestas' },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
        {/* Procesar respuestas */}
        <Link
          href="/dashboard/caixa/requests/respuestas"
          className="group block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 hover:shadow-sm transition-all"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
            <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.981l7.5-4.039a2.25 2.25 0 012.134 0l7.5 4.039a2.25 2.25 0 011.183 1.98V19.5z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">
            Procesar respuestas
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Sube el CSV/Excel de consultas con las respuestas de CaixaBank para
            añadirlas como notas en los deals de Pipedrive.
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-blue-600 group-hover:underline">
            Subir archivo →
          </span>
        </Link>

        {/* Rellenar formulario */}
        <Link
          href="/dashboard/caixa/requests/fill"
          className="group block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 hover:shadow-sm transition-all"
        >
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
            <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-emerald-700">
            Rellenar formulario
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Genera el Excel de consultas para CaixaBank con los tickets abiertos
            del día y sus External IDs de Pipedrive.
          </p>
          <span className="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:underline">
            Generar Excel →
          </span>
        </Link>
      </div>
    </div>
  )
}
