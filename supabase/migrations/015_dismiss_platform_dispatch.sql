-- =============================================================================
-- Migration: 015_dismiss_platform_dispatch.sql
-- Purpose:   Allow users to dismiss/discard a pending platform dispatch
--            without marking it as sent.
-- =============================================================================

ALTER TABLE platform_dispatches
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN platform_dispatches.dismissed_at IS
  'NULL = still pending. Set = user explicitly discarded this dispatch (will not appear in queue).';
