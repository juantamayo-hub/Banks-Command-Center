import Link from 'next/link'
import Image from 'next/image'

export default function CaixaPage() {
  return (
    <div className="p-8">
      <div className="mb-8 flex items-center gap-4">
        <Image src="/caixabank.png" alt="CaixaBank" width={160} height={48} className="object-contain" />
        <p className="text-sm text-gray-500">
          Módulos específicos para la gestión de operaciones Caixa.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 max-w-2xl">
        {/* Respuestas */}
        <Link
          href="/dashboard/caixa/respuestas"
          className="group block rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-blue-400 hover:shadow-md transition-all"
        >
          <div className="mb-3 text-3xl">📥</div>
          <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">
            Dossier CaixaBank
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Sube el Excel diario de CaixaBank para añadir notas en Pipedrive y
            marcar deals cerrados con el motivo correcto.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-blue-600 group-hover:underline">
            Subir Excel →
          </span>
        </Link>

        {/* Requests — placeholder */}
        <div className="relative block rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6">
          <div className="mb-3 text-3xl opacity-40">📤</div>
          <h2 className="text-lg font-semibold text-gray-400">Requests</h2>
          <p className="mt-2 text-sm text-gray-400">
            Módulo para gestionar solicitudes salientes a Caixa.
          </p>
          <span className="mt-4 inline-block rounded-full bg-gray-200 px-3 py-0.5 text-xs font-medium text-gray-500">
            Próximamente
          </span>
        </div>
      </div>
    </div>
  )
}
