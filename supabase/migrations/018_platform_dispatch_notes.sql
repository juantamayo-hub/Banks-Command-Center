-- 018_platform_dispatch_notes.sql
-- Notas persistentes para envíos por plataforma (CaixaBank, Abanca, Bankinter, Santander).
-- Keyed by platform_dispatches.id (UUID), separado de submission_notes que es para sheet_rows.

CREATE TABLE IF NOT EXISTS platform_dispatch_notes (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_dispatch_id UUID        NOT NULL REFERENCES platform_dispatches(id) ON DELETE CASCADE,
  content              TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_dispatch_notes_dispatch_date
  ON platform_dispatch_notes(platform_dispatch_id, created_at DESC);

ALTER TABLE platform_dispatch_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON platform_dispatch_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_select" ON platform_dispatch_notes
  FOR SELECT TO anon, authenticated USING (true);
