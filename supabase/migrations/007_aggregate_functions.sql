-- =============================================================================
-- Migration: 007_aggregate_functions.sql
--
-- Three Postgres functions that eliminate full-table-scan JS aggregation:
--
--   1. bank_stats()
--      Aggregate per-bank submission counts in a single SQL query.
--      Replaces the full sheet_rows fetch in /dashboard/metricas.
--      SECURITY INVOKER — safe to call via anon key (RLS SELECT applies).
--
--   2. bank_top_flags(p_bank_id, p_limit)
--      Top-N red flags for a single bank using unnest + GROUP BY.
--      Replaces the full red_flags column fetch in /dashboard/bancos/[slug].
--      SECURITY INVOKER — safe to call via anon key.
--
--   3. request_relaunch_atomic(p_row_id, p_force, p_actor)
--      Atomically updates sheet_rows.status and inserts into event_log
--      inside a single transaction. Eliminates the two-write race condition.
--      Must be called via service_role (admin client) — UPDATE + INSERT
--      require service_role to bypass RLS.
--
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. bank_stats()
--    Returns one row per active bank with counts broken down by status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bank_stats()
RETURNS TABLE (
    slug        TEXT,
    name        TEXT,
    total       BIGINT,
    sent        BIGINT,
    blocked     BIGINT,
    pending     BIGINT,
    failed      BIGINT,
    offers      BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    SELECT
        b.slug,
        b.name,
        COUNT(*)                                                                           AS total,
        COUNT(*) FILTER (WHERE sr.status = 'sent')                                        AS sent,
        COUNT(*) FILTER (WHERE sr.status IN (
            'blocked_red_flag', 'blocked_missing_docs', 'blocked_validation'))             AS blocked,
        COUNT(*) FILTER (WHERE sr.status = 'pending_ready')                               AS pending,
        COUNT(*) FILTER (WHERE sr.status = 'failed')                                      AS failed,
        COUNT(*) FILTER (WHERE sr.status = 'offer_received')                              AS offers
    FROM   banks b
    JOIN   sheet_rows sr ON sr.bank_id = b.id
    WHERE  b.active = TRUE
    GROUP  BY b.slug, b.name
    ORDER  BY total DESC;
$$;

COMMENT ON FUNCTION bank_stats IS
    'Returns aggregate submission counts per active bank. '
    'Called from /dashboard/metricas via the anon client.';


-- ---------------------------------------------------------------------------
-- 2. bank_top_flags(p_bank_id, p_limit)
--    Returns the most frequent individual red flag strings for one bank.
--    Uses unnest() to explode the red_flags array, then groups and counts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bank_top_flags(p_bank_id INT, p_limit INT DEFAULT 10)
RETURNS TABLE (
    flag    TEXT,
    cnt     BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    SELECT
        unnest(red_flags) AS flag,
        COUNT(*)          AS cnt
    FROM  sheet_rows
    WHERE bank_id    = p_bank_id
      AND red_flags IS NOT NULL
    GROUP BY flag
    ORDER BY cnt DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION bank_top_flags IS
    'Top-N red flag strings for a given bank_id. '
    'Called from /dashboard/bancos/[slug] via the anon client.';


-- ---------------------------------------------------------------------------
-- 3. request_relaunch_atomic(p_row_id, p_force, p_actor)
--
--    All guards and writes run inside one transaction:
--      - SELECT ... FOR UPDATE locks the row to prevent races.
--      - UPDATE sheet_rows.status = 'relaunch_requested'.
--      - INSERT into event_log (audit trail — CLAUDE.md Rule 8).
--
--    Returns a JSONB object:
--      { ok: true,  previous_status: text }
--      { ok: false, code: text, error: text [, current_status: text] }
--
--    MUST be called via service_role (admin client) because:
--      - UPDATE on sheet_rows requires service_role to bypass RLS.
--      - INSERT on event_log requires service_role to bypass RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_relaunch_atomic(
    p_row_id UUID,
    p_force  BOOLEAN,
    p_actor  TEXT
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY INVOKER   -- service_role bypasses RLS at connection level; no DEFINER needed
AS $$
DECLARE
    v_row          sheet_rows%ROWTYPE;
    v_prev_status  TEXT;
BEGIN
    -- Lock the row for the duration of this transaction to prevent races
    SELECT * INTO v_row
    FROM   sheet_rows
    WHERE  id = p_row_id
    FOR    UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok',    FALSE,
            'code',  'NOT_FOUND',
            'error', 'Fila no encontrada'
        );
    END IF;

    v_prev_status := v_row.status::TEXT;

    -- Guard: unconditionally blocked statuses
    IF v_prev_status IN ('sending', 'relaunch_requested') THEN
        RETURN jsonb_build_object(
            'ok',    FALSE,
            'code',  'BLOCKED',
            'error', CASE v_prev_status
                         WHEN 'sending'              THEN 'El envío está en curso. Espera a que termine.'
                         WHEN 'relaunch_requested'   THEN 'Ya hay un relanzamiento pendiente para esta fila.'
                     END
        );
    END IF;

    -- Guard: already dispatched — require explicit force
    IF v_prev_status IN ('sent', 'offer_received') AND NOT p_force THEN
        RETURN jsonb_build_object(
            'ok',             FALSE,
            'code',           'REQUIRES_FORCE',
            'error',          'Esta fila ya fue enviada al banco. Confirma con force=true para relanzar.',
            'current_status', v_prev_status
        );
    END IF;

    -- Atomic write 1: update status
    UPDATE sheet_rows
    SET    status = 'relaunch_requested'
    WHERE  id     = p_row_id;

    -- Atomic write 2: audit log (same transaction — cannot succeed without write 1)
    INSERT INTO event_log (
        event_type, sheet_row_id, bank_id, opportunity_id, actor, payload
    )
    VALUES (
        'relaunch_requested',
        p_row_id,
        v_row.bank_id,
        v_row.opportunity_id,
        p_actor,
        jsonb_build_object(
            'previous_status', v_prev_status,
            'force',           p_force,
            'nombre_cliente',  v_row.nombre_cliente
        )
    );

    RETURN jsonb_build_object(
        'ok',              TRUE,
        'previous_status', v_prev_status
    );
END;
$$;

COMMENT ON FUNCTION request_relaunch_atomic IS
    'Atomically marks a sheet_row as relaunch_requested and logs the event. '
    'Must be called via service_role (admin client). '
    'Called from app/actions/relaunch.ts Server Action only.';


-- ---------------------------------------------------------------------------
-- Grant execute on read-only functions to anon and authenticated roles.
-- request_relaunch_atomic is intentionally NOT granted to anon/authenticated —
-- it must only be reachable via the service_role client in Server Actions.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION bank_stats()                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bank_top_flags(INT, INT)            TO anon, authenticated;
-- request_relaunch_atomic: no grant → only service_role can call it
