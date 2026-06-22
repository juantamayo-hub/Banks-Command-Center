-- Migration 014: add test_time column to sheet_rows
-- Columna S del Sheet ("Test time") — fecha que tienen tanto enviados como pendientes.
-- Se usa como campo de filtro de fecha en el dashboard.

ALTER TABLE sheet_rows
  ADD COLUMN IF NOT EXISTS test_time TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sheet_rows_test_time
  ON sheet_rows (test_time)
  WHERE test_time IS NOT NULL;
