/**
 * Traduce lo que un flujo "Send Dossier" escribía en la hoja (columnas de la pestaña del banco) al estado del
 * Command Center. Los 19 flujos mandan exactamente esos valores a /api/dispatch/report y la decisión vive aquí,
 * en un único sitio, en vez de repartida por cada flujo.
 *
 * Orden de prioridad (primera regla que encaja):
 *   1. Enviado (Status "Enviado…" o Timestamp Sent)            → sent
 *   2. Red Flag con texto                                       → blocked_red_flag
 *   3. Dossier / Auto Bayteca / Auto Banco = NO                 → blocked_missing_docs
 *   4. Status con error ("Error", "no ha salido", "no se ha enviado") o "Lo ingresaste manualmente" → failed
 *   5. Solo Process Status de trabajo en curso (Procesando, Esperando, Comprimiendo, Enviando) → sending
 *   6. Cualquier otro Status o NOTAS (p. ej. "Ver notas", motivo de bloqueo, falta email) → blocked_validation
 *   7. Nada útil (solo "Completado")                            → null (no se cambia el estado)
 */

export type ClassifiedStatus = 'sending' | 'sent' | 'blocked_red_flag' | 'blocked_missing_docs' | 'blocked_validation' | 'failed'

export interface SheetValues {
  Status?: unknown
  NOTAS?: unknown
  'Red Flag'?: unknown
  'Process Status'?: unknown
  Dossier?: unknown
  'Auto Bayteca'?: unknown
  'Auto Banco'?: unknown
  'Timestamp Sent'?: unknown
}

const t = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const low = (v: unknown) => t(v).toLowerCase()
const isNo = (v: unknown) => /^no$/i.test(t(v))

export function classifySheetValues(s: SheetValues): { status: ClassifiedStatus; reason: string | null } | null {
  const status = low(s.Status)
  const proc = low(s['Process Status'])
  const notas = t(s.NOTAS)
  const redFlag = t(s['Red Flag'])

  if ((status.includes('enviado') && !/no\s+enviad/.test(status)) || t(s['Timestamp Sent'])) {
    return { status: 'sent', reason: null }
  }
  if (redFlag) return { status: 'blocked_red_flag', reason: `Red flag: ${redFlag}` }

  const missing = [
    isNo(s.Dossier) && 'el dossier en Drive',
    isNo(s['Auto Bayteca']) && 'la autorización de Bayteca',
    isNo(s['Auto Banco']) && 'la autorización del banco',
  ].filter(Boolean)
  if (missing.length) return { status: 'blocked_missing_docs', reason: `Falta ${missing.join(' y ')}` }

  if (/error|no ha salido|no se ha enviado|no salió/.test(status) || proc.includes('lo ingresaste manualmente')) {
    return { status: 'failed', reason: t(s.Status) || 'La línea llegó incompleta a n8n' }
  }
  if (!status && /procesando|esperando|comprimiendo|enviando/.test(proc)) {
    return { status: 'sending', reason: null }
  }
  if (status || notas) {
    const r = [t(s.Status), notas].filter(Boolean).join(' · ')
    return { status: 'blocked_validation', reason: r.slice(0, 500) }
  }
  return null
}
