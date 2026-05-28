import Link from 'next/link'

export default function CaixaRequestsPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Caixa — Requests</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gestión de consultas y solicitudes con CaixaBank.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 max-w-2xl">
        {/* Procesar respuestas */}
        <Link
          href="/dashboard/caixa/requests/respuestas"
          className="group block rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-blue-400 hover:shadow-md transition-all"
        >
          <div className="mb-3 text-3xl">📨</div>
          <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">
            Procesar respuestas
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Sube el CSV/Excel de consultas con las respuestas de CaixaBank para
            añadirlas como notas en los deals de Pipedrive.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-blue-600 group-hover:underline">
            Subir archivo →
          </span>
        </Link>

        {/* Rellenar formulario */}
        <Link
          href="/dashboard/caixa/requests/fill"
          className="group block rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-blue-400 hover:shadow-md transition-all"
        >
          <div className="mb-3 text-3xl">📝</div>
          <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">
            Rellenar formulario
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Genera el Excel de consultas para CaixaBank con los tickets abiertos
            del día y sus External IDs de Pipedrive.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-blue-600 group-hover:underline">
            Generar Excel →
          </span>
        </Link>
      </div>
    </div>
  )
}
