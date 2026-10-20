/**
 * Interruptores por entorno (solo servidor).
 * Por defecto, lo que aún está en revisión se ve en staging/local y se oculta en producción (main).
 */

/**
 * Sección Configuración de bancos: visible en todos los entornos desde el 20-oct-2026 (revisada por Juanjo;
 * Flor mantiene ahí los gestores de Santander). BANK_CONFIG_ENABLED=false la vuelve a ocultar.
 */
export function bankConfigEnabled(): boolean {
  const override = (process.env.BANK_CONFIG_ENABLED || '').trim().toLowerCase()
  return override !== 'false'
}
