-- =============================================================================
-- Migration: 013_add_bank_deal_id_to_platform_dispatches.sql
-- Purpose:   Add bank_deal_id column to platform_dispatches.
--            The general deal (deal_id) is used for discovery only.
--            Notes, stage updates, and all Pipedrive writes must target the
--            banking deal (bank_deal_id) in pipeline 7.
-- =============================================================================

ALTER TABLE platform_dispatches
  ADD COLUMN IF NOT EXISTS bank_deal_id BIGINT;

COMMENT ON COLUMN platform_dispatches.bank_deal_id IS
  'Pipedrive banking deal ID (pipeline 7). Read from Bank N ID custom field on the '
  'general deal during discovery. All Pipedrive writes (notes, stage moves) target '
  'this deal, never deal_id (the general deal).';
