-- =============================================================================
-- Migration: 008_bank_dispatch.sql
--
-- Adds has_dispatch flag to banks.
--
-- has_dispatch = TRUE  → bank can be relaunched from the dashboard via n8n.
-- has_dispatch = FALSE → bank uses a separate manual process; the dashboard
--                        shows data but never triggers a webhook for these banks.
--
-- Banks without dashboard dispatch (as of 2026-05-25):
--   santander, bankinter, sabadell, banca_360, kutxabank
-- =============================================================================

ALTER TABLE banks
    ADD COLUMN IF NOT EXISTS has_dispatch BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN banks.has_dispatch IS
    'TRUE = dashboard can trigger n8n relaunch webhook for this bank. '
    'FALSE = bank uses a separate manual send process; Relanzar button is hidden.';

-- Banks whose dispatch process lives outside this platform
UPDATE banks
SET    has_dispatch = FALSE
WHERE  slug IN ('santander', 'bankinter', 'sabadell', 'banca_360', 'kutxabank');
