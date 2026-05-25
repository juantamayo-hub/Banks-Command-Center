-- =============================================================================
-- Migration: 005_fix_uid_constraint.sql
--
-- The uid (ITEM ID from Apps Script) is not globally unique: the same deal
-- can be sent to multiple banks and each bank's Apps Script may generate the
-- same uid (derived from the same Pipedrive opportunity_id).
--
-- Fix: drop the global UNIQUE constraint on uid and replace it with a
-- partial unique index scoped to (bank_id, uid) ignoring NULLs.
-- =============================================================================

-- Drop the global unique constraint (created implicitly by UNIQUE column def)
ALTER TABLE sheet_rows DROP CONSTRAINT IF EXISTS sheet_rows_uid_key;

-- Add a scoped unique index: uid must be unique within a bank, but two
-- different banks can have the same uid for the same deal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sheet_rows_bank_uid
    ON sheet_rows (bank_id, uid)
    WHERE uid IS NOT NULL;
