-- Migration 009: caixa_processed table
-- Tracks Excel rows from Caixa's daily response file.
-- numero_peticion is UNIQUE to guarantee idempotent processing (dedup).

CREATE TABLE caixa_processed (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  numero_peticion   TEXT          UNIQUE NOT NULL,   -- full petition number e.g. "324199002"
  deal_id           TEXT          NOT NULL,           -- first 6 digits e.g. "324199"
  processed_at      TIMESTAMPTZ   DEFAULT NOW(),
  note_added        BOOLEAN       DEFAULT FALSE,
  pipedrive_note_id TEXT,
  marked_lost       BOOLEAN       DEFAULT FALSE,
  lost_reason_id    INTEGER,
  resolution_text   TEXT,
  estado_del_lead   TEXT,
  error_message     TEXT
);

ALTER TABLE caixa_processed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON caixa_processed
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX caixa_processed_deal_id_idx ON caixa_processed (deal_id);
CREATE INDEX caixa_processed_processed_at_idx ON caixa_processed (processed_at DESC);
