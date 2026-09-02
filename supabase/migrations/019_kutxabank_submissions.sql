-- Migration 019: Kutxabank submissions table
-- Tracks the lifecycle of Kutxabank dossier dispatches:
--   pending     → ZIP created, waiting for Rastreator approval
--   approved    → Rastreator says "Enviar", ready to send
--   rejected    → Rastreator says "No enviar"
--   sent        → Email sent to Kutxabank

CREATE TABLE IF NOT EXISTS kutxabank_submissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         INTEGER     NOT NULL UNIQUE,      -- general deal ID (pipeline 6)
  bank_deal_id    INTEGER,                           -- bank deal ID (pipeline 7)
  nombre_cliente  TEXT,
  dni             TEXT,
  plan            TEXT,
  drive_folder_id TEXT,                              -- Google Drive folder ID (from c2ea08... field)
  zip_file_id     TEXT,                              -- Google Drive file ID of the created ZIP
  zip_drive_link  TEXT,                              -- Shareable Google Drive link to the ZIP
  missing_docs    TEXT[]      DEFAULT '{}',          -- e.g. ['C003', 'D006']
  rastreator_row  INTEGER,                           -- row number in Rastreator "1º Filtro" sheet
  rastreator_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (rastreator_status IN ('pending', 'approved', 'rejected', 'sent')),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kutxabank_submissions_status
  ON kutxabank_submissions(rastreator_status);

CREATE INDEX IF NOT EXISTS idx_kutxabank_submissions_created
  ON kutxabank_submissions(created_at DESC);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION kutxabank_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER kutxabank_submissions_updated_at
  BEFORE UPDATE ON kutxabank_submissions
  FOR EACH ROW EXECUTE FUNCTION kutxabank_set_updated_at();

-- RLS
ALTER TABLE kutxabank_submissions ENABLE ROW LEVEL SECURITY;

-- anon / authenticated can SELECT (read from dashboard)
CREATE POLICY kutxabank_anon_select
  ON kutxabank_submissions FOR SELECT
  TO anon, authenticated
  USING (true);

-- service_role has full access (n8n writes via REST API, our API writes via admin client)
CREATE POLICY kutxabank_service_all
  ON kutxabank_submissions FOR ALL
  TO service_role
  USING (true);
