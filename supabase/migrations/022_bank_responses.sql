-- =============================================================================
-- Migration 022: bank_responses — respuestas y ofertas recibidas de los bancos
--
-- Una fila por respuesta recibida (email, API o plataforma), escrita por los
-- workflows n8n *_Offers_Received vía POST /api/bank-responses.
--
-- Idempotencia: UNIQUE (source, external_id)
--   email → Gmail message id
--   api   → id de la respuesta en la API del banco (Santander)
--   sheet → id de fila (Kutxabank / Rastreator)
-- Reprocesar el mismo correo actualiza la fila, nunca la duplica.
--
-- Enlace con envíos: bank_deal_id (= platform_dispatches.bank_deal_id,
-- kutxabank_submissions.bank_deal_id, bankDealId del asunto del dossier).
-- =============================================================================

CREATE TABLE IF NOT EXISTS bank_responses (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Origen
  bank_slug         TEXT          NOT NULL,                 -- = banks.slug / ACTIVE_BANKS
  source            TEXT          NOT NULL DEFAULT 'email'
                    CHECK (source IN ('email', 'api', 'platform', 'sheet', 'manual')),
  external_id       TEXT          NOT NULL,                 -- Gmail message id, id API, etc.
  thread_id         TEXT,
  received_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  subject           TEXT,
  from_email        TEXT,

  -- Resolución del deal
  general_deal_id   BIGINT,                                 -- pipeline 6/9
  bank_deal_id      BIGINT,                                 -- pipeline 7/10
  client_name       TEXT,
  resolved_by       TEXT,                                   -- asunto | mdref | email | dni | nombre | manual
  match_status      TEXT          NOT NULL DEFAULT 'matched'
                    CHECK (match_status IN ('matched', 'unmatched', 'ambiguous')),

  -- Clasificación
  classification    TEXT          NOT NULL DEFAULT 'other'
                    CHECK (classification IN ('offer', 'more_info', 'rejection', 'approval', 'other')),
  summary           TEXT,
  required_action   TEXT,
  lost_reason       TEXT,

  -- Oferta normalizada (ver OfferData en packages/shared/types.ts)
  offer             JSONB,
  raw_extraction    JSONB,

  -- Proceso
  status            TEXT          NOT NULL DEFAULT 'processed'
                    CHECK (status IN ('processed', 'error', 'manual_review', 'resolved')),
  error_step        TEXT,
  error_message     TEXT,
  pipedrive_actions JSONB         NOT NULL DEFAULT '[]'::jsonb, -- [{action:'stage',deal_id,value}, ...]
  workflow_id       TEXT,
  execution_id      TEXT,

  -- Revisión manual desde el Command Center
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT bank_responses_source_external_uniq UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_responses_received     ON bank_responses (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_responses_bank         ON bank_responses (bank_slug, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_responses_general_deal ON bank_responses (general_deal_id);
CREATE INDEX IF NOT EXISTS idx_bank_responses_bank_deal    ON bank_responses (bank_deal_id);
CREATE INDEX IF NOT EXISTS idx_bank_responses_attention    ON bank_responses (status, match_status)
  WHERE status IN ('error', 'manual_review') OR match_status <> 'matched';

CREATE OR REPLACE FUNCTION bank_responses_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_responses_updated_at ON bank_responses;
CREATE TRIGGER trg_bank_responses_updated_at
  BEFORE UPDATE ON bank_responses
  FOR EACH ROW EXECUTE FUNCTION bank_responses_set_updated_at();

-- RLS: lectura para usuarios logueados del Command Center, escritura solo service_role
ALTER TABLE bank_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_responses_authenticated_select ON bank_responses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY bank_responses_service_all ON bank_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE bank_responses IS
  'Respuestas de bancos (ofertas, más info, rechazos) registradas por n8n. Idempotente por (source, external_id).';
