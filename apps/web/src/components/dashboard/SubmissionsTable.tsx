import StatusBadge from '@/components/ui/StatusBadge'
import RelaunchButton from '@/components/dashboard/RelaunchButton'
import { normalizeRedFlag, CLUSTER_BY_SLUG } from '@/lib/redFlagClusters'

interface BankRef {
  name: string
  slug: string
  has_dispatch?: boolean | null
}

interface SheetRow {
  id: string
  opportunity_id: number | null
  bank_deal_id?: number | null
  nombre_cliente: string | null
  importe: number | null
  status: string | null
  status_raw: string | null
  red_flags: string[] | null
  timestamp_sent: string | null
  timestamp_entry: string | null
  synced_at: string | null
  owner: string | null
  sheet_row_number: number | null
  banks: BankRef | BankRef[] | null
}

interface SubmissionsTableProps {
  rows: SheetRow[]
  totalCount: number
  currentPage: number
  pageSize: number
}

function formatImporte(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

function getBankName(banks: BankRef | BankRef[] | null): string {
  if (!banks) return '—'
  if (Array.isArray(banks)) return banks[0]?.name ?? '—'
  return banks.name ?? '—'
}

function getBankDispatch(banks: BankRef | BankRef[] | null): boolean | null {
  if (!banks) return null
  const b = Array.isArray(banks) ? banks[0] : banks
  return b?.has_dispatch ?? null
}

function getBankSlug(banks: BankRef | BankRef[] | null): string | null {
  if (!banks) return null
  const b = Array.isArray(banks) ? banks[0] : banks
  return b?.slug ?? null
}

function FlagPills({ flags }: { flags: string[] }) {
  // Deduplicate by normalized category, preserving first raw text for tooltip
  const seen = new Map<string, string>()
  for (const flag of flags) {
    const cat = normalizeRedFlag(flag)
    if (!seen.has(cat)) seen.set(cat, flag)
  }

  return (
    <div className="flex flex-wrap gap-1">
      {Array.from(seen.entries()).map(([cat, rawText]) => {
        const cluster = CLUSTER_BY_SLUG[cat]
        const label = cluster?.label ?? cat
        const colorClass = cluster?.color ?? 'bg-gray-100 text-gray-600'
        return (
          <span
            key={cat}
            title={rawText}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

export default function SubmissionsTable({
  rows,
  totalCount,
  currentPage,
  pageSize,
}: SubmissionsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
        No hay envios para mostrar con los filtros actuales.
      </div>
    )
  }

  const rowOffset = (currentPage - 1) * pageSize

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                #
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Banco
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Cliente
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                Importe
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Estado
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Enviado
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Red Flags
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Acción
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map((row, index) => {
              const flags = row.red_flags ?? []
              const hasDispatch = getBankDispatch(row.banks)
              const bankSlug = getBankSlug(row.banks)
              return (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400 tabular-nums">
                    {rowOffset + index + 1}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {getBankName(row.banks)}
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    <p className="text-sm text-gray-700 truncate">{row.nombre_cliente ?? '—'}</p>
                    <p className="text-xs text-gray-400 tabular-nums">
                      {row.opportunity_id ?? '—'}
                      {row.bank_deal_id ? ` · B:${row.bank_deal_id}` : ''}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-right tabular-nums text-gray-900">
                    {formatImporte(row.importe)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={row.status ?? 'unknown'} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {formatDate(row.timestamp_sent)}
                  </td>
                  <td className="px-4 py-3 max-w-[260px]">
                    {flags.length > 0 ? (
                      <FlagPills flags={flags} />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <RelaunchButton
                      rowId={row.id}
                      status={row.status}
                      clientName={row.nombre_cliente}
                      hasDispatch={hasDispatch}
                      bankSlug={bankSlug}
                      sheetRowNumber={row.sheet_row_number}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
