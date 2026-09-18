import Link from 'next/link'
import Image from 'next/image'
import PageHeader from '@/components/ui/PageHeader'

export default function CaixaRequestsPage() {
  return (
    <div className="p-6 md:p-8 min-h-full flex flex-col items-center max-w-3xl mx-auto w-full">
      {/* Header with CaixaBank branding */}
      <div className="mb-8 w-full">
        <PageHeader
          title="Caixa Requests"
          subtitle="Gestión de consultas y solicitudes con CaixaBank."
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'CaixaBank', href: '/dashboard/caixa/respuestas' },
          ]}
        />
        <div className="mt-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-100 bg-white shadow-sm">
            <Image
              src="/banks/caixabank.png"
              alt="CaixaBank"
              width={28}
              height={28}
              className="object-contain"
            />
          </div>
          <div className="text-sm text-gray-500">
            Flujo de consultas: genera el formulario con los deals del dia, envia a CaixaBank, y procesa las respuestas recibidas.
          </div>
        </div>
      </div>

      {/* Workflow steps indicator */}
      <div className="mb-6 flex items-center gap-2 text-xs text-gray-400">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">1</span>
        <span className="text-gray-500">Generar formulario</span>
        <svg className="h-4 w-4 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">2</span>
        <span className="text-gray-500">Procesar respuestas</span>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 w-full">
        {/* Procesar respuestas */}
        <Link
          href="/dashboard/caixa/requests/respuestas"
          className="group relative block overflow-hidden rounded-xl border border-sky-100 bg-white transition-all duration-200 hover:border-sky-200 hover:shadow-md hover:shadow-sky-50"
        >
          <div className="absolute inset-y-0 left-0 w-1 bg-sky-500" />
          <div className="p-6 pl-7">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 ring-1 ring-sky-100">
                <svg className="h-6 w-6 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.981l7.5-4.039a2.25 2.25 0 012.134 0l7.5 4.039a2.25 2.25 0 011.183 1.98V19.5z" />
                </svg>
              </div>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-50 text-[10px] font-bold text-sky-600 ring-1 ring-sky-100">
                2
              </span>
            </div>
            <h2 className="text-base font-semibold text-gray-900 group-hover:text-sky-700 transition-colors">
              Procesar respuestas
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              Sube el CSV/Excel de consultas con las respuestas de CaixaBank para
              añadirlas como notas en los deals de Pipedrive.
            </p>
            <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-sky-600 group-hover:text-sky-700 transition-colors">
              <span>Subir archivo</span>
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </div>
        </Link>

        {/* Rellenar formulario */}
        <Link
          href="/dashboard/caixa/requests/fill"
          className="group relative block overflow-hidden rounded-xl border border-emerald-100 bg-white transition-all duration-200 hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-50"
        >
          <div className="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
          <div className="p-6 pl-7">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
                <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-600 ring-1 ring-emerald-100">
                1
              </span>
            </div>
            <h2 className="text-base font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">
              Rellenar formulario
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              Genera el Excel de consultas para CaixaBank con los tickets abiertos
              del día y sus External IDs de Pipedrive.
            </p>
            <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-emerald-600 group-hover:text-emerald-700 transition-colors">
              <span>Generar Excel</span>
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}
