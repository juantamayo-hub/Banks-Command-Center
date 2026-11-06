/**
 * Deals de prueba (Pipedrive) para probar los envíos por banco. Solo una línea de estos deals con test_mode = true
 * se trata como prueba: sale en modo prueba aunque el banco siga en "Hoja", su correo va a quien pulsa y su envío OK
 * desbloquea el interruptor del banco. Nunca un deal real: así ningún dossier de cliente puede desviarse ni saltarse
 * el anti-duplicado con test_mode.
 *   394078  "TEST Front Dispatcher 3" (bank deal 416235)
 *   348293  deal de prueba de staging (bank deal 415828)
 */
export const TEST_DEAL_IDS: ReadonlySet<number> = new Set([394078, 348293])

export function isTestDeal(opportunityId: unknown): boolean {
  return TEST_DEAL_IDS.has(Number(opportunityId))
}
