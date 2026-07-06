-- 016_pipedrive_lost_notes.sql
-- Agrega:
--   1. pipedrive_lost BOOLEAN en sheet_rows — filtrar deals perdidos en PD
--   2. submission_notes — notas enviadas desde la plataforma (persistentes)

-- ── 1. pipedrive_lost ──────────────────────────────────────────────────────────
ALTER TABLE sheet_rows
  ADD COLUMN IF NOT EXISTS pipedrive_lost BOOLEAN NOT NULL DEFAULT false;

-- Índice parcial: solo las filas marcadas como lost (minoría)
CREATE INDEX IF NOT EXISTS idx_sheet_rows_pipedrive_lost
  ON sheet_rows(pipedrive_lost) WHERE pipedrive_lost = true;

-- ── 2. submission_notes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submission_notes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_row_id UUID        NOT NULL REFERENCES sheet_rows(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice compuesto: buscar notas de una fila ordenadas por fecha (más reciente primero)
CREATE INDEX IF NOT EXISTS idx_submission_notes_row_date
  ON submission_notes(sheet_row_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE submission_notes ENABLE ROW LEVEL SECURITY;

-- Lectura pública (herramienta interna, sin auth de usuario)
CREATE POLICY "anon_select_notes" ON submission_notes
  FOR SELECT TO anon, authenticated USING (true);

-- Escritura solo desde service_role (server-side únicamente)
CREATE POLICY "service_all_notes" ON submission_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
