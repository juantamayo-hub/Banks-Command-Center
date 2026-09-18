-- 021_kutxabank_submission_notes.sql
-- Notas persistentes para envíos de Kutxabank.
-- Keyed by kutxabank_submissions.id (UUID), mismo patrón que platform_dispatch_notes.

CREATE TABLE IF NOT EXISTS kutxabank_submission_notes (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kutxabank_submission_id   UUID        NOT NULL REFERENCES kutxabank_submissions(id) ON DELETE CASCADE,
  content                  TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kutxabank_submission_notes_sub_date
  ON kutxabank_submission_notes(kutxabank_submission_id, created_at DESC);

ALTER TABLE kutxabank_submission_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON kutxabank_submission_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_select" ON kutxabank_submission_notes
  FOR SELECT TO anon, authenticated USING (true);
