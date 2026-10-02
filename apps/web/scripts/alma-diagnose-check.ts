/**
 * Pruebas del motor de diagnóstico con casos sintéticos (basados en casos reales del 1-oct-2026).
 * Uso: cd apps/web && npx tsx --tsconfig tsconfig.json scripts/alma-diagnose-check.ts
 */

import { diagnose, type DiagnoseInput } from '../src/lib/alma/diagnose'

const base: DiagnoseInput = { filas_hoja: [], envios_plataforma: [], kutxabank: [], reservas_envio: [], eventos_flujo: [], red_flags: [] }
const row = (r: Record<string, unknown>) => ({ banco: 'EuroCajaRural', bank_slug: 'eurocajarural', send_trigger: true, ...r })

const CASES: Array<{ name: string; input: DiagnoseInput; motivo: string; tecnico: boolean }> = [
  {
    name: 'Jorge (antes): dossier de 87,6 MB y Gmail falló',
    input: { ...base, filas_hoja: [row({ status_raw: 'Error envío ❌', notas: 'Gmail no pudo enviar el correo: Internal error.' })], dossieres: [{ nombre: '200.000€MD22038340.pdf', mb: 87.6, creado: null }] },
    motivo: 'dossier_too_big', tecnico: false,
  },
  {
    name: 'Lorena (antes): webhook de n8n desactivado (404)',
    input: { ...base, filas_hoja: [row({ banco: 'No Bank Fee', bank_slug: 'no_bank_fee', process_status: 'Error n8n (ENVIAR) - HTTP 404 - {"code":404,"message":"The requested webhook \\"POST send-dossier-nobankfee\\" is not registered."}' })] },
    motivo: 'n8n_flow_inactive', tecnico: true,
  },
  {
    name: 'Bloqueo anti-duplicado',
    input: { ...base, filas_hoja: [row({ process_status: 'Enviado a n8n (ENVIAR) - HTTP 200' })], eventos_flujo: [{ kind: 'antidup_blocked', bank_slug: 'eurocajarural', message: 'bloqueado', detail: { release_at: '2026-10-02T15:00:00Z' } }] },
    motivo: 'antidup_blocked', tecnico: false,
  },
  {
    name: 'Apps Script: sin ITEM ID',
    input: { ...base, filas_hoja: [row({ process_status: 'Bloqueado - No hay ITEM ID - 2026-10-02 10:00' })] },
    motivo: 'sheet_blocked', tecnico: false,
  },
  {
    name: 'Red flag sin autorizar',
    input: { ...base, filas_hoja: [row({ status: 'blocked_red_flag', status_raw: 'Red Flag', red_flags_raw: 'Ingresos IRPF insuficientes' })] },
    motivo: 'red_flag', tecnico: false,
  },
  {
    name: 'Ibercaja: falta documento de datos básicos',
    input: { ...base, filas_hoja: [row({ banco: 'Ibercaja', bank_slug: 'ibercaja', notas: 'Falta Nuevo_Documento', process_status: 'Completado' })] },
    motivo: 'missing_docs', tecnico: true,
  },
  {
    name: 'Aún sin Enviar=Yes',
    input: { ...base, filas_hoja: [row({ send_trigger: null })] },
    motivo: 'not_requested', tecnico: false,
  },
  {
    name: 'Enviado',
    input: { ...base, filas_hoja: [row({ status: 'sent', status_raw: 'Enviado ✅', timestamp_sent: '2026-09-30T22:00:00+00:00' })] },
    motivo: 'sent', tecnico: false,
  },
  {
    name: 'Plataforma pendiente (Santander)',
    input: { ...base, envios_plataforma: [{ bank_name: 'Santander', sent_at: null }] },
    motivo: 'platform_pending', tecnico: false,
  },
]

let ok = 0
for (const c of CASES) {
  const [d] = diagnose(c.input)
  const pass = d && d.motivo === c.motivo && d.es_tecnico === c.tecnico
  if (pass) ok++
  console.log(`${pass ? '✅' : '❌'} ${c.name}${pass ? '' : ` → ${d?.motivo} (técnico=${d?.es_tecnico})`}`)
  if (process.env.VERBOSE) console.log('   ', d?.explicacion, '|', d?.que_hacer)
}
console.log(`\n${ok}/${CASES.length} correctas`)
process.exit(ok === CASES.length ? 0 : 1)
