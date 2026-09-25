/**
 * Respuestas de bancos (ofertas, más info, rechazos) — tabla bank_responses.
 * Escritas por los workflows n8n *_Offers_Received vía POST /api/bank-responses.
 */

export type ResponseSource = 'email' | 'api' | 'platform' | 'sheet' | 'manual'
export type ResponseClassification = 'offer' | 'more_info' | 'rejection' | 'approval' | 'other'
export type MatchStatus = 'matched' | 'unmatched' | 'ambiguous'
export type ResponseStatus = 'processed' | 'error' | 'manual_review' | 'resolved'

/** Oferta normalizada: mismo formato para todos los bancos (null = no informado). */
export interface OfferData {
  mortgage_amount?: number | null
  property_value?: number | null
  term_years?: number | null
  fija?: {
    tin_bonificado?: number | null
    tae_bonificado?: number | null
    cuota_bonificada?: number | null
    tin_sin_bonificar?: number | null
    tae_sin_bonificar?: number | null
    cuota_sin_bonificar?: number | null
  } | null
  mixta?: {
    tramo_fijo_meses?: number | null
    tin_fijo_bonificado?: number | null
    euribor_diferencial_bonificado?: number | null
    tae_bonificada?: number | null
    cuota_primer_periodo_bonificada?: number | null
    cuota_resto_bonificada?: number | null
  } | null
  variable?: {
    euribor_diferencial_bonificado?: number | null
    tae_bonificada?: number | null
    cuota_bonificada?: number | null
  } | null
  vinculaciones?: string[] | null
  comisiones?: string | null
  valid_until?: string | null
}

export interface BankResponse {
  id: string
  bank_slug: string
  source: ResponseSource
  external_id: string
  thread_id: string | null
  received_at: string
  subject: string | null
  from_email: string | null
  general_deal_id: number | null
  bank_deal_id: number | null
  client_name: string | null
  resolved_by: string | null
  match_status: MatchStatus
  classification: ResponseClassification
  summary: string | null
  required_action: string | null
  lost_reason: string | null
  offer: OfferData | null
  status: ResponseStatus
  error_step: string | null
  error_message: string | null
  pipedrive_actions: unknown[]
  workflow_id: string | null
  execution_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

/** Los workflows usan etiquetas en español y en mayúsculas (OFERTA, MAS_INFO, RECHAZO...). */
const CLASSIFICATION_ALIASES: Record<string, ResponseClassification> = {
  offer: 'offer', oferta: 'offer',
  more_info: 'more_info', mas_info: 'more_info', info: 'more_info', documentacion: 'more_info',
  rejection: 'rejection', rechazo: 'rejection', denegado: 'rejection', denegada: 'rejection', reject: 'rejection',
  approval: 'approval', aprobado: 'approval', aprobada: 'approval', preaprobado: 'approval', preaprobada: 'approval',
  other: 'other', otro: 'other',
}

export function normalizeClassification(raw: unknown): ResponseClassification {
  const key = String(raw ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return CLASSIFICATION_ALIASES[key] ?? 'other'
}

export const CLASSIFICATION_LABEL: Record<ResponseClassification, string> = {
  offer: 'Oferta',
  more_info: 'Más info',
  rejection: 'Rechazo',
  approval: 'Aprobación',
  other: 'Otro',
}

export const CLASSIFICATION_STYLE: Record<ResponseClassification, string> = {
  offer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  more_info: 'bg-amber-50 text-amber-700 border-amber-200',
  rejection: 'bg-red-50 text-red-700 border-red-200',
  approval: 'bg-sky-50 text-sky-700 border-sky-200',
  other: 'bg-gray-50 text-gray-600 border-gray-200',
}

/** Necesita intervención humana: error, revisión manual o deal no encontrado. */
export function needsAttention(r: Pick<BankResponse, 'status' | 'match_status'>): boolean {
  return (r.status === 'error' || r.status === 'manual_review' || r.match_status !== 'matched') && r.status !== 'resolved'
}

export function pipedriveDealUrl(dealId: number | null): string | null {
  return dealId ? `https://mdsl.pipedrive.com/deal/${dealId}` : null
}
