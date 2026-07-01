/**
 * Platform Dispatch constants
 *
 * The 4 banks whose dossiers are sent manually from the platform
 * (not via Google Sheets / n8n).
 *
 * Pipedrive: deals are detected when stage_id = 62 (Doc. Completed).
 * On mark-sent: deal moves to pipeline 7, stage 70 (Bank Submission).
 */

export const PLATFORM_BANKS = ['CaixaBank', 'Abanca', 'Bankinter', 'Santander'] as const
export type PlatformBankName = (typeof PLATFORM_BANKS)[number]

// Pipedrive custom field hash IDs for Bank 1–5 (which bank option)
export const BANK_FIELD_IDS = [
  'af536dbfe7d00fd441ae9bd4b144c25bc1d4c725', // Bank 1
  '8e4b44a3f3973d1f524f8cd0ec6f6babe9e96965', // Bank 2
  'ed0a30972778ac2c3d29cab53e27a89f5b52a1b2', // Bank 3
  '9049591570e78d3274a72cfb7a28076789ce0676', // Bank 4
  '36ff3525fb8a73637e069099967b2afe164e408a', // Bank 5
] as const

// Pipedrive custom field hash IDs for Bank 1–5 ID (banking deal ID in pipeline 7)
// These are "double" fields on the general deal storing the ID of the banking deal.
// Must be indexed in sync with BANK_FIELD_IDS (slot 1 = index 0, etc.)
export const BANK_ID_FIELD_IDS = [
  '04d666f12e4d27a3867daa5d7d6b777d76d24eb9', // Bank 1 ID
  '75d8963d89d47daf37349722c531677263173484', // Bank 2 ID
  '874add027adde7fa7690874e3bac581489387651', // Bank 3 ID
  '467feaa56488620159ef39890e6d8f96489bdbac', // Bank 4 ID
  'b3dfef96dce320a1cfa4605056757f7e79731676', // Bank 5 ID
] as const

// Map: Pipedrive enum option ID → platform bank name
// Each bank has a different option ID per Bank 1–5 slot.
export const OPTION_ID_TO_BANK: Record<number, PlatformBankName> = {
  // CaixaBank
  2636: 'CaixaBank', 2654: 'CaixaBank', 2672: 'CaixaBank', 2690: 'CaixaBank', 2708: 'CaixaBank',
  // Abanca
  2630: 'Abanca',    2648: 'Abanca',    2666: 'Abanca',    2684: 'Abanca',    2702: 'Abanca',
  // Bankinter
  2639: 'Bankinter', 2657: 'Bankinter', 2675: 'Bankinter', 2693: 'Bankinter', 2711: 'Bankinter',
  // Santander
  2635: 'Santander', 2653: 'Santander', 2671: 'Santander', 2689: 'Santander', 2707: 'Santander',
}

// Pipedrive stages — pipeline 7 (Bayteca_BankArea)
export const DOC_COMPLETED_STAGE_ID = 62          // source: trigger for discovery
export const BANK_SUBMISSION_PIPELINE_ID = 7       // destination pipeline
export const PRE_BANK_SUBMISSION_STAGE_ID = 77    // order 1 — only stage that should be moved to BS
export const BANK_SUBMISSION_STAGE_ID = 70        // order 2 — destination stage

// Stage order map for pipeline 7. Used to guard against moving deals that are
// already at or past Bank Submission.
export const PIPELINE7_STAGE_ORDER: Record<number, number> = {
  77: 1, // Pre Bank Submission
  70: 2, // Bank Submission
  71: 3, // Bank offers received
  79: 4, // Pre - Valuation
  72: 5, // Valuation
  73: 6, // FEIN
  74: 7, // Notary - Formalization
  75: 8, // Notary - Signature
}

// Badge color per bank
export const BANK_COLOR: Record<PlatformBankName, string> = {
  CaixaBank: 'bg-blue-50 text-blue-700 border-blue-200',
  Abanca:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  Bankinter: 'bg-orange-50 text-orange-700 border-orange-200',
  Santander: 'bg-red-50 text-red-700 border-red-200',
}
