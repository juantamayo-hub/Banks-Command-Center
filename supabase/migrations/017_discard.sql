-- 017_discard.sql
-- Agrega is_discarded a sheet_rows para descartar casos del dashboard pendientes
-- Marca abanca con has_dispatch=false (solo accesible desde plataforma)

-- ── 1. is_discarded ────────────────────────────────────────────────────────────
ALTER TABLE sheet_rows
  ADD COLUMN IF NOT EXISTS is_discarded BOOLEAN NOT NULL DEFAULT false;

-- Índice parcial: solo las filas descartadas (minoría)
CREATE INDEX IF NOT EXISTS idx_sheet_rows_is_discarded
  ON sheet_rows(is_discarded) WHERE is_discarded = true;

-- ── 2. Abanca: marcar como banco de plataforma ────────────────────────────────
-- Abanca no tiene sync automático desde el Sheet ni dispatch a n8n.
-- Las filas se crean vía "Nuevo envío" (plataforma), no deben mezclarse
-- con los pendientes normales del Sheet.
UPDATE banks SET has_dispatch = false WHERE slug = 'abanca';
