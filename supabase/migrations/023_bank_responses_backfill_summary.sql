-- =============================================================================
-- Migration 023: bank_responses — origen 'backfill' + resumen agregado
--
-- 1. source admite 'backfill' (histórico importado desde Pipedrive).
-- 2. bank_responses_summary(since): totales por banco calculados en SQL, para que
--    la página /dashboard/ofertas no dependa del límite de filas de PostgREST.
-- =============================================================================

ALTER TABLE bank_responses DROP CONSTRAINT IF EXISTS bank_responses_source_check;
ALTER TABLE bank_responses ADD CONSTRAINT bank_responses_source_check
  CHECK (source IN ('email', 'api', 'platform', 'sheet', 'manual', 'backfill'));

CREATE OR REPLACE FUNCTION bank_responses_summary(p_since TIMESTAMPTZ)
RETURNS TABLE (
  bank_slug   TEXT,
  total       BIGINT,
  offers      BIGINT,
  more_info   BIGINT,
  rejections  BIGINT,
  attention   BIGINT,
  last_at     TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    bank_slug,
    count(*)                                                      AS total,
    count(*) FILTER (WHERE classification = 'offer')              AS offers,
    count(*) FILTER (WHERE classification = 'more_info')          AS more_info,
    count(*) FILTER (WHERE classification = 'rejection')          AS rejections,
    count(*) FILTER (WHERE status <> 'resolved'
                       AND (status IN ('error', 'manual_review') OR match_status <> 'matched')) AS attention,
    max(received_at)                                              AS last_at
  FROM bank_responses
  WHERE received_at >= p_since
  GROUP BY bank_slug
  ORDER BY total DESC;
$$;

GRANT EXECUTE ON FUNCTION bank_responses_summary(TIMESTAMPTZ) TO authenticated, service_role;
