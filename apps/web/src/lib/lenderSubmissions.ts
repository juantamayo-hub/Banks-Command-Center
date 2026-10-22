/**
 * Envíos a entidades de préstamo (Cofidis; preparado para Inversiones Griffs y PrimeTeca).
 * Tablas lender_submissions / lender_submission_events (migración 027), escritas por n8n vía
 * POST /api/lender-submissions y por las acciones del Command Center.
 */

export type LenderStatus = 'pending_docs' | 'sent' | 'error' | 'dismissed'
export type LenderSource = 'loans_pipeline' | 'no_bank_fee'
export type LenderProduct = 'personal_loan' | 'debt_consolidation'

export interface LenderSubmission {
  id: string
  lender: string
  source: LenderSource
  product: LenderProduct
  deal_id: number
  bank_deal_id: number | null
  client_name: string | null
  dni: string | null
  holders: number | null
  owner_email: string | null
  status: LenderStatus
  missing_docs: string[]
  sent_at: string | null
  sent_to: string | null
  error_message: string | null
  attempts: number
  created_at: string
  updated_at: string
}

export interface LenderSubmissionEvent {
  id: string
  submission_id: string | null
  status: LenderStatus
  missing_docs: string[]
  detail: string | null
  created_at: string
}

export const LENDER_NAME: Record<string, string> = {
  cofidis: 'Cofidis',
  inversiones_griffs: 'Inversiones Griffs',
  primeteca: 'PrimeTeca',
}

export const PRODUCT_LABEL: Record<LenderProduct, string> = {
  personal_loan: 'Préstamo personal',
  debt_consolidation: 'Reunificación de deudas',
}

export const SOURCE_LABEL: Record<LenderSource, string> = {
  loans_pipeline: 'Pipeline Préstamos',
  no_bank_fee: 'No Bank Fee',
}

export const STATUS_LABEL: Record<LenderStatus, string> = {
  pending_docs: 'Falta documentación',
  error: 'Error de envío',
  sent: 'Enviado',
  dismissed: 'Descartado',
}

export const STATUS_STYLE: Record<LenderStatus, string> = {
  pending_docs: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dismissed: 'bg-gray-50 text-gray-500 border-gray-200',
}

/** Requiere acción del equipo: no salió por documentación o por fallo técnico. */
export function needsAction(s: Pick<LenderSubmission, 'status'>): boolean {
  return s.status === 'pending_docs' || s.status === 'error'
}

/**
 * Motivo de bloqueo por banco incompatible (no es un documento): los flujos n8n lo guardan en missing_docs con este
 * prefijo cuando el deal general tiene en Bank 1..5 un banco con el que Cofidis no se envía.
 */
export function isBankBlock(reason: string): boolean {
  return reason.startsWith('Banco incompatible')
}

/** Etiqueta del estado; un pendiente bloqueado por banco se distingue de uno al que solo le faltan documentos. */
export function statusLabel(s: Pick<LenderSubmission, 'status' | 'missing_docs'>): string {
  if (s.status === 'pending_docs' && (s.missing_docs ?? []).some(isBankBlock)) return 'Bloqueado por banco'
  return STATUS_LABEL[s.status]
}
