-- =============================================================================
-- Migration: 006_cluster_red_flags.sql
--
-- Adds rule-based clustering for red_flag_events.normalized_reason.
--
-- 1. Enables unaccent extension (removes diacritics for regex matching).
-- 2. Creates normalize_red_flag(text) IMMUTABLE function.
-- 3. Back-fills normalized_reason on all existing red_flag_events rows.
-- 4. Adds index for fast GROUP BY on normalized_reason.
--
-- To re-run clustering after new data arrives, call:
--   UPDATE red_flag_events SET normalized_reason = normalize_red_flag(raw_text);
-- Or POST /api/cluster-flags from the dashboard.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;


-- ---------------------------------------------------------------------------
-- normalize_red_flag(text) → category slug
--
-- Input : raw red flag string from the Google Sheet (may have accents/mixed case)
-- Output: one of the category slugs defined in lib/redFlagClusters.ts
--
-- Order matters: more specific patterns first, 'otro' is the fallback.
-- Keep in sync with normalizeRedFlag() in apps/web/src/lib/redFlagClusters.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_red_flag(raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  s text;
BEGIN
  IF raw IS NULL OR trim(raw) = '' THEN
    RETURN 'otro';
  END IF;

  -- Normalize: strip accents, lowercase, collapse whitespace
  s := regexp_replace(lower(unaccent(trim(raw))), '\s+', ' ', 'g');

  -- ── Simultaneidad / múltiples bancos ──────────────────────────────────────
  -- Must be before other checks because "ya enviado" could match other rules
  IF s ~ '(simultan|multiple.*banco|ya (enviado|cursado|tramitad).*(otro|otro banco)|varios banco)' THEN
    RETURN 'simultaneidad';
  END IF;

  -- ── Edad / Plazo ─────────────────────────────────────────────────────────
  IF s ~ '(edad|plazo.*(excede|supera|limite|edad)|anos.*(maxim|limite)|jubilaci)' THEN
    RETURN 'edad_plazo';
  END IF;

  -- ── CIRBE / Endeudamiento ─────────────────────────────────────────────────
  IF s ~ '(cirbe|ratio.*(endeud|deuda)|endeudamiento|deuda.*(elevad|alta|alto|superior|excesiv)|nivel.*deuda)' THEN
    RETURN 'deuda_cirbe';
  END IF;

  -- ── Importe límite ────────────────────────────────────────────────────────
  IF s ~ '(importe.*(minim|maxim|inferior|bajo|limite|supera)|minimo.*(importe|capital)|cantidad.*(minim|maxim)|por debajo.*minim|capital.*minim)' THEN
    RETURN 'importe_limite';
  END IF;

  -- ── Historial crediticio (ASNEF, RAI, incidencias) ───────────────────────
  IF s ~ '(asnef|rai|morosidad|impagad|fichero.*(morosos?|impago|deudores?)|incidencia.*(credito|pago)|deuda.*(pendiente|impagad)|siniestralidad)' THEN
    RETURN 'historial_credito';
  END IF;

  -- ── Ingresos ─────────────────────────────────────────────────────────────
  IF s ~ '(ingreso.*(insufic|bajo|minim|no justif)|sueldo.*(bajo|insufic)|sin (nomina|ingresos)|nomina.*(no|insufic)|renta.*(insufic|baj))' THEN
    RETURN 'ingresos';
  END IF;

  -- ── Tasación / LTV / Financiación máxima ────────────────────────────────
  IF s ~ '(ltv|loan.to.value|tasacion|valoracion|porcentaje.*(finan|hipotec)|financiacion.*(maxim|superior|limite)|superacion.*financiacion|excede.*financiacion)' THEN
    RETURN 'tasacion_ltv';
  END IF;

  -- ── Documentos faltantes ──────────────────────────────────────────────────
  IF s ~ '(document|falta.*(irpf|informe|certif|doc|declar)|sin document|documentacion.*(incomplet|faltante|pendiente)|pendiente.*document)' THEN
    RETURN 'documentos';
  END IF;

  -- ── Residencia fiscal ─────────────────────────────────────────────────────
  IF s ~ '(no residente|residente.*fiscal|residencia.*(extranjero|fuera|fiscal)|fiscalmente.*extranjero|no.*reside en)' THEN
    RETURN 'residencia';
  END IF;

  -- ── Actividad laboral (autónomo, empresario) ──────────────────────────────
  IF s ~ '(autonomo|reta|cuenta propia|actividad.*(empresa|profesional|irregul)|empresari|trabajador.*independiente)' THEN
    RETURN 'actividad_laboral';
  END IF;

  -- ── Tipo de vivienda (segunda vivienda, no habitual) ─────────────────────
  IF s ~ '(segunda vivienda|no habitual|vacacional|no.*primera vivienda|vivienda.*(no.*habitual|segunda|vacacional))' THEN
    RETURN 'tipo_vivienda';
  END IF;

  -- ── Garantías / Avalista ──────────────────────────────────────────────────
  IF s ~ '(avalista|garantia|fiador|aval )' THEN
    RETURN 'garantias';
  END IF;

  -- ── Nacionalidad / Documentación de identidad ────────────────────────────
  IF s ~ '(nie |nif.*(no valid|extran|incorr)|nacionalidad|pasaporte|sin nie|sin nif)' THEN
    RETURN 'nacionalidad';
  END IF;

  -- ── Tipo de operación (reunificación, suelo, obra nueva) ─────────────────
  IF s ~ '(reunificacion|subrogacion|no aplica.*(operacion|tipo)|solo obra nueva|no.*suelo|tipo.*operacion)' THEN
    RETURN 'tipo_operacion';
  END IF;

  RETURN 'otro';
END;
$$;


-- ---------------------------------------------------------------------------
-- Back-fill: assign normalized_reason to all existing rows where it is NULL.
-- This runs once at migration time; future rows are updated via /api/cluster-flags.
-- ---------------------------------------------------------------------------
UPDATE red_flag_events
SET normalized_reason = normalize_red_flag(raw_text)
WHERE normalized_reason IS NULL;


-- ---------------------------------------------------------------------------
-- Index for fast GROUP BY normalized_reason queries used in the metrics page.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_red_flag_events_normalized
    ON red_flag_events (normalized_reason);
