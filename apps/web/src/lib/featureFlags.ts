/**
 * Interruptores por entorno (solo servidor).
 * Por defecto, lo que aún está en revisión se ve en staging/local y se oculta en producción (main).
 */

/** Sección Configuración de bancos. BANK_CONFIG_ENABLED=true|false fuerza el valor. */
export function bankConfigEnabled(): boolean {
  const override = (process.env.BANK_CONFIG_ENABLED || '').trim().toLowerCase()
  if (override === 'true') return true
  if (override === 'false') return false
  return process.env.VERCEL_ENV !== 'production'
}
