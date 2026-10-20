import Link from 'next/link'

/** Botón "← Volver a bancos" de las páginas de Configuración. */
export default function BackLink() {
  return (
    <Link
      href="/dashboard/configuracion"
      className="inline-flex w-fit items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900"
    >
      <span aria-hidden>←</span> Volver a bancos
    </Link>
  )
}
