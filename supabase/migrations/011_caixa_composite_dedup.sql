-- Migration 011: composite dedup key for caixa_processed
--
-- Previously: UNIQUE(numero_peticion)
-- Now: UNIQUE(numero_peticion, estado_del_lead, motivo_pendiente, resolucion)
--
-- This allows the same petition number to be reprocessed if estado/motivo/resolución
-- changes (e.g. deal advances through stages), while still preventing exact duplicates.

-- 1. Add new columns needed for the composite key
ALTER TABLE caixa_processed
  ADD COLUMN IF NOT EXISTS motivo_pendiente TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resolucion       TEXT NOT NULL DEFAULT '';

-- 2. Backfill resolucion from existing resolution_text data
UPDATE caixa_processed
  SET resolucion = COALESCE(resolution_text, '');

-- 3. Normalize estado_del_lead to NOT NULL (was nullable before)
UPDATE caixa_processed SET estado_del_lead = '' WHERE estado_del_lead IS NULL;
ALTER TABLE caixa_processed
  ALTER COLUMN estado_del_lead SET NOT NULL,
  ALTER COLUMN estado_del_lead SET DEFAULT '';

-- 4. Drop the old single-column unique constraint
ALTER TABLE caixa_processed
  DROP CONSTRAINT IF EXISTS caixa_processed_numero_peticion_key;

-- 5. New composite unique index (replaces the old constraint)
CREATE UNIQUE INDEX IF NOT EXISTS caixa_processed_dedup_idx
  ON caixa_processed (numero_peticion, estado_del_lead, motivo_pendiente, resolucion);
