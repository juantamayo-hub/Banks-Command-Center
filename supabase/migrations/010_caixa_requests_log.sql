-- =============================================================================
-- Migration 010: caixa_requests dedup tables
--
-- Two tables, one per Caixa Requests flow:
--
--   caixa_requests_responses — "Procesar respuestas"
--     UNIQUE on oportunidad_caixa (col A — CaixaBank external ID).
--     Prevents adding the same Pipedrive note twice for the same response.
--
--   caixa_requests_fills — "Rellenar formulario"
--     UNIQUE on ticket_id (Supabase tickets.id).
--     Prevents including the same ticket in multiple generated Excels.
-- =============================================================================

-- ── Procesar respuestas ───────────────────────────────────────────────────────

CREATE TABLE caixa_requests_responses (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  oportunidad_caixa TEXT          UNIQUE NOT NULL,   -- col A (CaixaBank external ID)
  id_bayteca        TEXT          NOT NULL,           -- col G (Pipedrive deal ID)
  processed_at      TIMESTAMPTZ   DEFAULT NOW(),
  note_added        BOOLEAN       DEFAULT FALSE,
  pipedrive_note_id TEXT,
  error_message     TEXT
);

ALTER TABLE caixa_requests_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON caixa_requests_responses
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX caixa_req_resp_id_bayteca_idx
  ON caixa_requests_responses (id_bayteca);

CREATE INDEX caixa_req_resp_processed_at_idx
  ON caixa_requests_responses (processed_at DESC);

-- ── Rellenar formulario ───────────────────────────────────────────────────────

CREATE TABLE caixa_requests_fills (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id         UUID          UNIQUE NOT NULL,   -- tickets.id from Supabase
  pipedrive_deal_id TEXT          NOT NULL,
  generated_at      TIMESTAMPTZ   DEFAULT NOW(),
  for_date          DATE          NOT NULL,          -- date the Excel was generated for
  external_id_caixa TEXT                             -- value fetched from Pipedrive
);

ALTER TABLE caixa_requests_fills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON caixa_requests_fills
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX caixa_req_fills_for_date_idx
  ON caixa_requests_fills (for_date DESC);
