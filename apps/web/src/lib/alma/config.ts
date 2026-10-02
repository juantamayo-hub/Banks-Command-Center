/**
 * Activación de Alma por entorno.
 *  - ALMA_ENABLED=true            → Alma disponible (en producción no se define hasta que Juanjo lo apruebe)
 *  - ALMA_ALLOWED_EMAILS=a@x,b@y  → si está definido, solo esos emails pueden usarla (staging)
 *  - ALMA_ENV=staging|production  → etiqueta para auditoría y para los reportes de Slack
 *  - ALMA_SHARED_SECRET           → secreto para las llamadas servidor-a-servidor desde Request Hub
 */

export const ALMA_MODEL = 'claude-opus-5'

export function almaEnabled(): boolean {
  return process.env.ALMA_ENABLED === 'true'
}

export function almaEnv(): string {
  return process.env.ALMA_ENV || (process.env.VERCEL_ENV === 'production' ? 'production' : 'staging')
}

export function almaAllowedFor(email: string | null | undefined): boolean {
  if (!almaEnabled() || !email) return false
  const list = (process.env.ALMA_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.length === 0 || list.includes(email.toLowerCase())
}

/** Límite de mensajes por usuario y día (protege el coste). */
// En staging el límite es alto: ahí solo prueba Juanjo y se lanzan las evaluaciones (decenas de preguntas por pasada)
export const ALMA_DAILY_MESSAGE_LIMIT = Number(process.env.ALMA_DAILY_MESSAGE_LIMIT || (process.env.ALMA_ENV && process.env.ALMA_ENV !== 'production' ? 1000 : 150))

/** Juanjo en Slack (destinatario de los reportes técnicos). */
export const JUANJO_SLACK_ID = 'U0A6ZSLGC1Y'
