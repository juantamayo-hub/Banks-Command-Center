-- =============================================================================
-- Migration: 012_platform_dispatches.sql
-- Purpose:   Track manual bank dispatches (CaixaBank, Abanca, Bankinter, Santander)
--            that are triggered from the platform (not via Google Sheets).
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_dispatches (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      BIGINT       NOT NULL,            -- Pipedrive deal ID
  bank_name    TEXT         NOT NULL,            -- 'CaixaBank' | 'Abanca' | 'Bankinter' | 'Santander'
  deal_title   TEXT,                             -- cached from Pipedrive
  person_name  TEXT,                             -- cached from Pipedrive
  sent_at      TIMESTAMPTZ,                      -- NULL = pending, set = sent
  sent_by      TEXT         NOT NULL DEFAULT 'platform',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One record per (deal, bank) — prevents duplicates
  CONSTRAINT platform_dispatches_deal_bank_unique UNIQUE (deal_id, bank_name)
);

COMMENT ON TABLE platform_dispatches IS
  'Tracks dossier dispatches for banks managed from the platform (not via Sheets/n8n). '
  'One row per (deal, bank). sent_at = NULL means pending; set means done.';

-- RLS
ALTER TABLE platform_dispatches ENABLE ROW LEVEL SECURITY;

-- service_role can do everything (used by API routes)
CREATE POLICY "service_role_all" ON platform_dispatches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Dashboard can read (anon key)
CREATE POLICY "anon_select" ON platform_dispatches
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_select" ON platform_dispatches
  FOR SELECT TO authenticated USING (true);
