import StatusBadge from '@/components/ui/StatusBadge'
import RelaunchButton from '@/components/dashboard/RelaunchButton'
import NoteBox from '@/components/dashboard/NoteBox'
import NoteHistory from '@/components/dashboard/NoteHistory'

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
  notas?: string | null
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
  mode?: 'pendientes' | 'enviados'
  gDriveLinks?: Record<number, string | null>
  notesMap?: Record<string, Array<{ content: string; created_at: string }>>
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
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700"
        >
          {flag}
        </span>
      ))}
    </div>
  )
}

/** Pipedrive deal deep-link */
function PipedriveLink({ id, label }: { id: number; label?: string }) {
  return (
    <a
      href={`https://mdsl.pipedrive.com/deal/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-indigo-600 underline decoration-dotted"
    >
      {label ?? id}
    </a>
  )
}

export default function SubmissionsTable({
  rows,
  totalCount: _totalCount,
  currentPage,
  pageSize,
  mode = 'pendientes',
  gDriveLinks,
  notesMap = {},
}: SubmissionsTableProps) {
  void _totalCount

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
        No hay envíos para mostrar con los filtros actuales.
      </div>
    )
  }

  const rowOffset = (currentPage - 1) * pageSize

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {mode === 'pendientes' ? (
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Banco</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Importe</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Red Flags</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 w-56">Notas</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 w-52">Acción</th>
              </tr>
            ) : (
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Banco</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Importe</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Enviado</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map((row, index) => {
              const flags = row.red_flags ?? []
              const hasDispatch = getBankDispatch(row.banks)
              const bankSlug = getBankSlug(row.banks)
              const rowNotes = notesMap[row.id] ?? []

              // Shared cells
              const indexCell = (
                <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400 tabular-nums">
                  {rowOffset + index + 1}
                </td>
              )
              const bankCell = (
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                  {getBankName(row.banks)}
                </td>
              )
              const gDriveUrl = row.opportunity_id ? (gDriveLinks?.[row.opportunity_id] ?? null) : null
              const clientCell = (
                <td className="px-4 py-3 max-w-[200px]">
                  <p className="text-sm text-gray-700 truncate">{row.nombre_cliente ?? '—'}</p>
                  <p className="text-xs text-gray-400 tabular-nums flex flex-wrap gap-x-1 items-center">
                    {row.opportunity_id ? (
                      <PipedriveLink id={row.opportunity_id} />
                    ) : (
                      <span>—</span>
                    )}
                    {row.bank_deal_id ? (
                      <>
                        <span>·</span>
                        <PipedriveLink id={row.bank_deal_id} label={`B:${row.bank_deal_id}`} />
                      </>
                    ) : null}
                    {gDriveUrl ? (
                      <>
                        <span>·</span>
                        <a
                          href={gDriveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Dossier Google Drive"
                          className="hover:text-indigo-600"
                        >
                          📁
                        </a>
                      </>
                    ) : null}
                  </p>
                </td>
              )
              const importeCell = (
                <td className="whitespace-nowrap px-4 py-3 text-sm text-right tabular-nums text-gray-900">
                  {formatImporte(row.importe)}
                </td>
              )
              const estadoCell = (
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge status={row.status ?? 'unknown'} />
                </td>
              )

              if (mode === 'pendientes') {
                return (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    {indexCell}
                    {bankCell}
                    {clientCell}
                    {importeCell}
                    {estadoCell}
                    {/* Red Flags */}
                    <td className="px-4 py-3 max-w-[220px]">
                      {flags.length > 0 ? (
                        <FlagPills flags={flags} />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    {/* Notas — plataforma (+ sheet como fallback) */}
                    <td className="px-4 py-3 w-56 align-top">
                      <NoteHistory notes={rowNotes} sheetNote={row.notas} />
                    </td>
                    {/* Acción: relaunch + NoteBox */}
                    <td className="px-4 py-3 align-top min-w-[180px]">
                      <RelaunchButton
                        rowId={row.id}
                        status={row.status}
                        clientName={row.nombre_cliente}
                        hasDispatch={hasDispatch}
                        bankSlug={bankSlug}
                        sheetRowNumber={row.sheet_row_number}
                      />
                      {row.bank_deal_id ? (
                        <NoteBox
                          dealId={row.bank_deal_id}
                          sheetRowId={row.id}
                        />
                      ) : null}
                    </td>
                  </tr>
                )
              }

              // Enviados mode
              return (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  {indexCell}
                  {bankCell}
                  {clientCell}
                  {importeCell}
                  {estadoCell}
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {formatDate(row.timestamp_sent)}
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
