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

// Pipedrive custom field hash IDs for Bank 1–5
export const BANK_FIELD_IDS = [
  'af536dbfe7d00fd441ae9bd4b144c25bc1d4c725', // Bank 1
  '8e4b44a3f3973d1f524f8cd0ec6f6babe9e96965', // Bank 2
  'ed0a30972778ac2c3d29cab53e27a89f5b52a1b2', // Bank 3
  '9049591570e78d3274a72cfb7a28076789ce0676', // Bank 4
  '36ff3525fb8a73637e069099967b2afe164e408a', // Bank 5
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

// Pipedrive stages
export const DOC_COMPLETED_STAGE_ID = 62     // source: trigger for discovery
export const BANK_SUBMISSION_PIPELINE_ID = 7  // destination pipeline
export const BANK_SUBMISSION_STAGE_ID = 70   // destination stage

// Badge color per bank
export const BANK_COLOR: Record<PlatformBankName, string> = {
  CaixaBank: 'bg-blue-50 text-blue-700 border-blue-200',
  Abanca:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  Bankinter: 'bg-orange-50 text-orange-700 border-orange-200',
  Santander: 'bg-red-50 text-red-700 border-red-200',
}
