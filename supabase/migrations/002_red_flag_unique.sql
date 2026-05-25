-- =============================================================================
-- Migration: 002_red_flag_unique.sql
-- Adds a unique constraint on red_flag_events(bank_id, opportunity_id, raw_text)
-- so that Apps Script can upsert without creating duplicate red flag rows.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_red_flag_events_unique
    ON red_flag_events (bank_id, opportunity_id, raw_text);
