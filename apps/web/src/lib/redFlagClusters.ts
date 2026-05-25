/**
 * Red flag cluster definitions.
 * Keep in sync with normalize_red_flag() in supabase/migrations/006_cluster_red_flags.sql.
 */

export interface ClusterDef {
  slug: string
  label: string
  description: string
  color: string // Tailwind bg + text classes
}

export const CLUSTERS: ClusterDef[] = [
  {
    slug: 'edad_plazo',
    label: 'Edad / Plazo',
    description: 'Edad máxima excedida o plazo hipotecario fuera de límite.',
    color: 'bg-orange-100 text-orange-800',
  },
  {
    slug: 'deuda_cirbe',
    label: 'Deuda / CIRBE',
    description: 'Ratio de endeudamiento o CIRBE elevado.',
    color: 'bg-red-100 text-red-800',
  },
  {
    slug: 'importe_limite',
    label: 'Importe límite',
    description: 'Importe inferior al mínimo o superior al máximo del banco.',
    color: 'bg-yellow-100 text-yellow-800',
  },
  {
    slug: 'historial_credito',
    label: 'Historial crediticio',
    description: 'ASNEF, RAI, morosidad u otras incidencias de crédito.',
    color: 'bg-red-200 text-red-900',
  },
  {
    slug: 'ingresos',
    label: 'Ingresos insuficientes',
    description: 'Ingresos o nómina por debajo del umbral exigido.',
    color: 'bg-amber-100 text-amber-800',
  },
  {
    slug: 'tasacion_ltv',
    label: 'Tasación / LTV',
    description: 'Porcentaje de financiación o LTV por encima del límite.',
    color: 'bg-purple-100 text-purple-800',
  },
  {
    slug: 'documentos',
    label: 'Documentos faltantes',
    description: 'Documentación incompleta o pendiente de entregar.',
    color: 'bg-blue-100 text-blue-800',
  },
  {
    slug: 'residencia',
    label: 'Residencia fiscal',
    description: 'Titular no es residente fiscal en España.',
    color: 'bg-indigo-100 text-indigo-800',
  },
  {
    slug: 'actividad_laboral',
    label: 'Actividad laboral',
    description: 'Autónomo, RETA o actividad empresarial no aceptada.',
    color: 'bg-teal-100 text-teal-800',
  },
  {
    slug: 'tipo_vivienda',
    label: 'Tipo de vivienda',
    description: 'Segunda vivienda, no habitual o vacacional.',
    color: 'bg-cyan-100 text-cyan-800',
  },
  {
    slug: 'simultaneidad',
    label: 'Simultaneidad',
    description: 'Operación ya enviada a otro banco o cursada simultáneamente.',
    color: 'bg-slate-100 text-slate-700',
  },
  {
    slug: 'garantias',
    label: 'Garantías',
    description: 'Se requiere avalista o garantía adicional.',
    color: 'bg-zinc-100 text-zinc-700',
  },
  {
    slug: 'nacionalidad',
    label: 'Nacionalidad / NIE',
    description: 'Documentación de identidad o nacionalidad no admitida.',
    color: 'bg-rose-100 text-rose-800',
  },
  {
    slug: 'tipo_operacion',
    label: 'Tipo de operación',
    description: 'Reunificación, subrogación u otro tipo no aceptado.',
    color: 'bg-fuchsia-100 text-fuchsia-800',
  },
  {
    slug: 'otro',
    label: 'Otros',
    description: 'Red flags que no encajan en ninguna categoría conocida.',
    color: 'bg-gray-100 text-gray-600',
  },
]

export const CLUSTER_BY_SLUG: Record<string, ClusterDef> = Object.fromEntries(
  CLUSTERS.map((c) => [c.slug, c])
)

/** JS-side normalization — mirrors normalize_red_flag() SQL function. */
export function normalizeRedFlag(raw: string): string {
  if (!raw || !raw.trim()) return 'otro'

  // Normalize: remove accents (basic), lowercase
  const s = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/\s+/g, ' ')
    .trim()

  if (/(simultan|multiple.*banco|ya (enviado|cursado|tramitad).*(otro|otro banco)|varios banco)/.test(s))
    return 'simultaneidad'
  if (/(edad|plazo.*(excede|supera|limite|edad)|anos.*(maxim|limite)|jubilaci)/.test(s))
    return 'edad_plazo'
  if (/(cirbe|ratio.*(endeud|deuda)|endeudamiento|deuda.*(elevad|alta|alto|superior|excesiv)|nivel.*deuda)/.test(s))
    return 'deuda_cirbe'
  if (/(importe.*(minim|maxim|inferior|bajo|limite|supera)|minimo.*(importe|capital)|cantidad.*(minim|maxim)|por debajo.*minim|capital.*minim)/.test(s))
    return 'importe_limite'
  if (/(asnef|rai|morosidad|impagad|fichero.*(morosos?|impago|deudores?)|incidencia.*(credito|pago)|deuda.*(pendiente|impagad)|siniestralidad)/.test(s))
    return 'historial_credito'
  if (/(ingreso.*(insufic|bajo|minim|no justif)|sueldo.*(bajo|insufic)|sin (nomina|ingresos)|nomina.*(no|insufic)|renta.*(insufic|baj))/.test(s))
    return 'ingresos'
  if (/(ltv|loan.to.value|tasacion|valoracion|porcentaje.*(finan|hipotec)|financiacion.*(maxim|superior|limite)|superacion.*financiacion|excede.*financiacion)/.test(s))
    return 'tasacion_ltv'
  if (/(document|falta.*(irpf|informe|certif|doc|declar)|sin document|documentacion.*(incomplet|faltante|pendiente)|pendiente.*document)/.test(s))
    return 'documentos'
  if (/(no residente|residente.*fiscal|residencia.*(extranjero|fuera|fiscal)|fiscalmente.*extranjero|no.*reside en)/.test(s))
    return 'residencia'
  if (/(autonomo|reta|cuenta propia|actividad.*(empresa|profesional|irregul)|empresari|trabajador.*independiente)/.test(s))
    return 'actividad_laboral'
  if (/(segunda vivienda|no habitual|vacacional|no.*primera vivienda|vivienda.*(no.*habitual|segunda|vacacional))/.test(s))
    return 'tipo_vivienda'
  if (/(avalista|garantia|fiador|aval )/.test(s))
    return 'garantias'
  if (/(nie |nif.*(no valid|extran|incorr)|nacionalidad|pasaporte|sin nie|sin nif)/.test(s))
    return 'nacionalidad'
  if (/(reunificacion|subrogacion|no aplica.*(operacion|tipo)|solo obra nueva|no.*suelo|tipo.*operacion)/.test(s))
    return 'tipo_operacion'

  return 'otro'
}
