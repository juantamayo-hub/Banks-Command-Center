-- Migration 020: Kutxabank Envíos + Estados processing tables
-- 1. Add dismissed_at to kutxabank_submissions (soft-delete)
-- 2. Create kutxabank_estados_processed for dedup on stage updates

-- ── 1. Add dismissed_at to kutxabank_submissions ────────────────────────────
ALTER TABLE kutxabank_submissions
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kutxabank_submissions_dismissed
  ON kutxabank_submissions(dismissed_at)
  WHERE dismissed_at IS NOT NULL;

-- ── 2. kutxabank_estados_processed — dedup for Procesar Estados ─────────────
CREATE TABLE IF NOT EXISTS kutxabank_estados_processed (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           INTEGER     NOT NULL,
  bank_deal_id      INTEGER,
  estado_rastreator TEXT        NOT NULL,
  stage_updated_to  INTEGER,
  marked_won        BOOLEAN     DEFAULT false,
  otros_comentarios TEXT,
  processed_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(deal_id, estado_rastreator)
);

CREATE INDEX IF NOT EXISTS idx_kutxabank_estados_deal_id
  ON kutxabank_estados_processed(deal_id);

-- RLS
ALTER TABLE kutxabank_estados_processed ENABLE ROW LEVEL SECURITY;

CREATE POLICY kutxabank_estados_anon_select
  ON kutxabank_estados_processed FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY kutxabank_estados_service_all
  ON kutxabank_estados_processed FOR ALL
  TO service_role
  USING (true);
