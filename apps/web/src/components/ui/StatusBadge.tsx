type Status =
  | 'sent'
  | 'offer_received'
  | 'blocked_red_flag'
  | 'blocked_missing_docs'
  | 'blocked_validation'
  | 'pending_ready'
  | 'sending'
  | 'failed'
  | 'relaunch_requested'
  | 'rejected'
  | 'more_info_requested'
  | 'unknown'

const STATUS_STYLES: Record<Status, string> = {
  sent: 'bg-green-100 text-green-800',
  offer_received: 'bg-emerald-100 text-emerald-800',
  blocked_red_flag: 'bg-red-100 text-red-800',
  blocked_missing_docs: 'bg-orange-100 text-orange-800',
  blocked_validation: 'bg-orange-100 text-orange-800',
  pending_ready: 'bg-blue-100 text-blue-800',
  sending: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-200 text-red-900',
  relaunch_requested: 'bg-purple-100 text-purple-800',
  rejected: 'bg-gray-200 text-gray-800',
  more_info_requested: 'bg-yellow-100 text-yellow-800',
  unknown: 'bg-gray-100 text-gray-600',
}

const STATUS_LABELS: Record<Status, string> = {
  sent: 'Enviado',
  offer_received: 'Oferta recibida',
  blocked_red_flag: 'Red Flag',
  blocked_missing_docs: 'Docs faltantes',
  blocked_validation: 'Bloqueado',
  pending_ready: 'Pendiente',
  sending: 'Enviando',
  failed: 'Fallido',
  relaunch_requested: 'Relanzar',
  rejected: 'Denegado',
  more_info_requested: 'Mas info',
  unknown: 'Desconocido',
}

interface StatusBadgeProps {
  status: string
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const knownStatus = status as Status
  const styles = STATUS_STYLES[knownStatus] ?? 'bg-gray-100 text-gray-600'
  const label = STATUS_LABELS[knownStatus] ?? status

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}
    >
      {label}
    </span>
  )
}
