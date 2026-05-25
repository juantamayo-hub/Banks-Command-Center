// =============================================================================
// types.ts
// Project:  Migración Bancos - Ofertas Recibidas
// Source:   Generated from supabase/migrations/001_init.sql
//
// Rules:
//   - No external dependencies. Pure TypeScript.
//   - Nullable SQL columns are typed as `T | null`.
//   - Can be imported from apps/web (Next.js) and, after transpilation, from
//     apps/appscript (Google Apps Script via clasp + ts-to-gs or inline tsc).
// =============================================================================


// =============================================================================
// ENUM: RowStatus
// Mirrors the SQL `normalized_status` ENUM defined in 001_init.sql.
// =============================================================================
export enum RowStatus {
  PendingReady       = 'pending_ready',
  BlockedRedFlag     = 'blocked_red_flag',
  BlockedMissingDocs = 'blocked_missing_docs',
  BlockedValidation  = 'blocked_validation',
  Sent               = 'sent',
  Sending            = 'sending',
  Failed             = 'failed',
  RelaunhRequested   = 'relaunch_requested',
  OfferReceived      = 'offer_received',
  Rejected           = 'rejected',
  MoreInfoRequested  = 'more_info_requested',
  Unknown            = 'unknown',
}

/** Union of all valid normalized status strings. Useful for runtime validation. */
export type RowStatusValue = `${RowStatus}`;

/** All valid RowStatus values as a readonly tuple, useful for runtime checks. */
export const ROW_STATUS_VALUES: readonly RowStatusValue[] = [
  'pending_ready',
  'blocked_red_flag',
  'blocked_missing_docs',
  'blocked_validation',
  'sent',
  'sending',
  'failed',
  'relaunch_requested',
  'offer_received',
  'rejected',
  'more_info_requested',
  'unknown',
] as const;


// =============================================================================
// BANK SLUGS AND ACTIVE_BANKS
// Mirrors the seed INSERT in 001_init.sql (22 banks).
// =============================================================================

/** All 22 bank slugs seeded in the database. */
export const BANK_SLUGS = [
  'santander',
  'uci',
  'ing',
  'ruralnostra',
  'ibercaja',
  'cr_teruel',
  'unicaja',
  'no_bank_fee',
  'cr_asturias',
  'cr_aragon',
  'cr_granada',
  'laboral_kutxa',
  'deutsche_bank',
  'eurocajarural',
  'myinvestor',
  'cr_del_sur',
  'globalcaja',
  'caixa_popular',
  'cajamar',
  'bankinter',
  'kutxabank',
  'abanca',
  'cr_extremadura',
  'sabadell',
  'banca_360',
] as const;

/** A single bank slug. Derived from BANK_SLUGS so it stays in sync automatically. */
export type BankSlug = typeof BANK_SLUGS[number];

/** Lightweight bank descriptor used client-side (does not include DB-internal fields). */
export interface BankDescriptor {
  slug: BankSlug;
  name: string;
  sheet_name: string;
}

/**
 * All 22 active banks with their display name and exact Google Sheet tab name.
 * Mirrors the seed data in 001_init.sql.
 * Use this array to build dropdowns, filters, and routing without a DB round-trip.
 */
export const ACTIVE_BANKS: readonly BankDescriptor[] = [
  { slug: 'santander',     name: 'Santander',     sheet_name: 'Santander'     },
  { slug: 'uci',           name: 'UCI',           sheet_name: 'UCI'           },
  { slug: 'ing',           name: 'ING',           sheet_name: 'ING'           },
  { slug: 'ruralnostra',   name: 'Ruralnostra',   sheet_name: 'Ruralnostra'   },
  { slug: 'ibercaja',      name: 'Ibercaja',      sheet_name: 'Ibercaja'      },
  { slug: 'cr_teruel',     name: 'CR Teruel',     sheet_name: 'CR Teruel'     },
  { slug: 'unicaja',       name: 'Unicaja',       sheet_name: 'Unicaja'       },
  { slug: 'no_bank_fee',   name: 'No Bank Fee',   sheet_name: 'No Bank Fee'   },
  { slug: 'cr_asturias',   name: 'CR Asturias',   sheet_name: 'CR Asturias'   },
  { slug: 'cr_aragon',     name: 'CR Aragón',     sheet_name: 'CR Aragón'     },
  { slug: 'cr_granada',    name: 'CR Granada',    sheet_name: 'CR Granada'    },
  { slug: 'laboral_kutxa', name: 'Laboral Kutxa', sheet_name: 'Laboral Kutxa' },
  { slug: 'deutsche_bank', name: 'Deutsche Bank', sheet_name: 'Deutsche Bank' },
  { slug: 'eurocajarural', name: 'EuroCajaRural', sheet_name: 'EuroCajaRural' },
  { slug: 'myinvestor',    name: 'MyInvestor',    sheet_name: 'MyInvestor'    },
  { slug: 'cr_del_sur',    name: 'CR del Sur',    sheet_name: 'CR del Sur'    },
  { slug: 'globalcaja',    name: 'Globalcaja',    sheet_name: 'Globalcaja'    },
  { slug: 'caixa_popular', name: 'Caixa Popular', sheet_name: 'Caixa Popular' },
  { slug: 'cajamar',       name: 'Cajamar',       sheet_name: 'Cajamar'       },
  { slug: 'bankinter',     name: 'Bankinter',     sheet_name: 'Bankinter'     },
  { slug: 'kutxabank',      name: 'Kutxabank',              sheet_name: 'Kutxabank'                   },
  { slug: 'abanca',         name: 'Abanca',                 sheet_name: 'Abanca'                      },
  { slug: 'cr_extremadura', name: 'CR Extremadura',         sheet_name: 'CR Extremadura'              },
  { slug: 'sabadell',       name: 'Sabadell no residentes', sheet_name: 'Sabadell no residentes'      },
  { slug: 'banca_360',      name: 'Banca 360 / MSF 360',   sheet_name: 'MSF 360 - Sabadell Residentes' },
] as const;


// =============================================================================
// INTERFACE: Bank
// Mirrors the full `banks` table row returned from Supabase.
// =============================================================================
export interface Bank {
  /** SERIAL PRIMARY KEY — auto-assigned by Postgres. */
  id: number;
  /** URL-safe unique identifier (e.g. 'ibercaja', 'deutsche_bank'). */
  slug: BankSlug;
  /** Human-readable display name. */
  name: string;
  /** Exact Google Sheet tab name. Used by Apps Script row mapping. */
  sheet_name: string;
  /** Whether this bank is currently active. */
  active: boolean;
  /** True when the bank sheet has an ITEM ID / UID column generated by Apps Script. */
  has_uid_column: boolean;
  /** True when the bank sheet has a Process Status column. */
  has_process_status: boolean;
  /** ISO-8601 timestamp string as returned by Supabase. */
  created_at: string;
}


// =============================================================================
// INTERFACE: SheetRow
// Mirrors the full `sheet_rows` table row returned from Supabase.
// Nullable SQL columns are typed as `T | null`.
// =============================================================================
export interface SheetRow {
  /** UUID PRIMARY KEY. */
  id: string;

  // -- Source identifiers --
  /** ITEM ID from Apps Script. NULL for banks without a UID column. */
  uid: string | null;
  /** FK to banks.id. */
  bank_id: number;
  /** Pipedrive Opportunity ID. */
  opportunity_id: number;
  /** ID of the deal in the bank's own system. */
  bank_deal_id: number | null;

  // -- Client & loan data --
  nombre_cliente: string;
  /** Loan amount in EUR. Returned as a string by Supabase NUMERIC columns. */
  importe: string | null;
  /** Google Drive URL to the dossier. */
  link_dossier: string | null;

  // -- Timing --
  /** ISO-8601 — when the row was first entered in the Sheet. */
  timestamp_entry: string | null;
  /**
   * Normalized from "Enviado/Enviar" column.
   * true = Yes, false = No, null = blank or unknown.
   */
  send_trigger: boolean | null;
  /** ISO-8601 — when Apps Script marked the row as sent. */
  timestamp_sent: string | null;

  // -- Status --
  /** Original unmodified status string from the Sheet. Never overwritten once set. */
  status_raw: string | null;
  /** Computed normalized state. Use RowStatus enum for comparisons. */
  status: RowStatusValue | null;

  // -- Red flags --
  /** Original pipe-separated red flag string from the Sheet. */
  red_flags_raw: string | null;
  /** Parsed array of individual trimmed red flag strings. */
  red_flags: string[] | null;

  // -- Bank-specific optional columns --
  clasificacion: string | null;
  dossier: string | null;
  /** 'NO' or empty. */
  auto_bayteca: string | null;
  auto_banco: string | null;
  autorizacion: string | null;
  autorizacion_link: string | null;
  autorizacion_red_flag: string | null;
  /** 'Completado' | 'Procesando' | 'Listo para enviar' */
  process_status: string | null;
  notas: string | null;

  // -- Response data --
  /** ISO date string (YYYY-MM-DD). */
  fecha_respuesta: string | null;
  dias_sin_respuesta: number | null;

  // -- Operational metadata --
  owner: string | null;
  /** 1-indexed row number in the Google Sheet. */
  sheet_row_number: number | null;
  /** ISO-8601 — last time Apps Script touched this row. */
  synced_at: string;
  created_at: string;
  updated_at: string;
}


// =============================================================================
// TYPE: DispatchTriggeredBy
// Mirrors the documented values for dispatch_attempts.triggered_by.
// =============================================================================
export type DispatchTriggeredBy =
  | 'apps_script'
  | 'manual_relaunch'
  | 'auto_retry';

// =============================================================================
// TYPE: DispatchStatus
// Mirrors the documented values for dispatch_attempts.status.
// =============================================================================
export type DispatchStatus =
  | 'sent'
  | 'failed'
  | 'blocked'
  | 'duplicate_prevented';

// =============================================================================
// INTERFACE: DispatchAttempt
// Mirrors the full `dispatch_attempts` table row returned from Supabase.
// Append-only — never updated or deleted.
// =============================================================================
export interface DispatchAttempt {
  /** UUID PRIMARY KEY. */
  id: string;
  /** FK to sheet_rows.id. */
  sheet_row_id: string;
  /** FK to banks.id. */
  bank_id: number;
  opportunity_id: number;
  /** UID snapshot at the moment of dispatch. */
  uid: string | null;
  /** Who or what triggered this attempt. */
  triggered_by: DispatchTriggeredBy;
  /** Outcome of the dispatch attempt. */
  status: DispatchStatus;
  /** Destination webhook URL that was called. */
  webhook_url: string | null;
  /** Raw response body returned by the webhook or bank system. */
  response_body: string | null;
  /** Error detail when status is 'failed'. */
  error_message: string | null;
  /**
   * true means the caller explicitly passed force=true,
   * acknowledging a potential re-send.
   */
  force_flag: boolean;
  /** ISO-8601 — when the dispatch was executed. */
  dispatched_at: string;
  created_at: string;
}


// =============================================================================
// INTERFACE: RedFlagEvent
// Mirrors the full `red_flag_events` table row returned from Supabase.
// One row per individual red flag string (already split from the pipe-separated source).
// =============================================================================
export interface RedFlagEvent {
  /** UUID PRIMARY KEY. */
  id: string;
  /** FK to sheet_rows.id. */
  sheet_row_id: string;
  /** FK to banks.id. */
  bank_id: number;
  opportunity_id: number;
  /** Single red flag text already split from the source string. */
  raw_text: string;
  /**
   * Category label assigned by the clustering process.
   * NULL until clustering has been run.
   * Examples: 'age_term_exceeded', 'min_amount', 'min_income'.
   */
  normalized_reason: string | null;
  created_at: string;
}


// =============================================================================
// TYPE: EventType
// Mirrors the documented valid values for event_log.event_type.
// =============================================================================
export type EventType =
  | 'sync'
  | 'dispatch'
  | 'relaunch_requested'
  | 'relaunch_executed'
  | 'status_change'
  | 'red_flag_detected'
  | 'offer_received'
  | 'duplicate_prevented'
  | 'blocked';

// =============================================================================
// TYPE: EventActor
// Documented pattern for event_log.actor.
// Literal 'apps_script' | 'system' or a dynamic 'user:email' string.
// =============================================================================
export type EventActor = 'apps_script' | 'system' | (string & {});

// =============================================================================
// INTERFACE: EventLog
// Mirrors the full `event_log` table row returned from Supabase.
// Append-only immutable audit trail — never updated or deleted.
// =============================================================================
export interface EventLog {
  /** UUID PRIMARY KEY. */
  id: string;
  /** Type of event that occurred. */
  event_type: EventType;
  /** FK to sheet_rows.id. NULL when the event is not tied to a specific row. */
  sheet_row_id: string | null;
  /** FK to banks.id. NULL when the event is not tied to a specific bank. */
  bank_id: number | null;
  opportunity_id: number | null;
  /**
   * Who triggered the event.
   * Pattern: 'apps_script' | 'user:email@domain.com' | 'system'
   */
  actor: EventActor | null;
  /** Arbitrary JSON with event-specific data (previous status, new status, error, etc.). */
  payload: Record<string, unknown> | null;
  created_at: string;
}
