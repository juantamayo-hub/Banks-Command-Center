-- =============================================================================
-- Migration: 004_add_missing_banks.sql
--
-- 1. Adds 3 banks that exist in the active Google Sheet but were missing
--    from the initial seed: CR Extremadura, Sabadell, Banca 360.
--
-- 2. Updates sheet_name for existing banks to match the real active tab names
--    (many use "Test" tabs as confirmed in Pasar datos a pestañas.js).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Add missing banks
-- ---------------------------------------------------------------------------
INSERT INTO banks (slug, name, sheet_name, active, has_uid_column, has_process_status)
VALUES
  ('cr_extremadura', 'CR Extremadura',           'CR Extremadura',              TRUE, FALSE, FALSE),
  ('sabadell',       'Sabadell no residentes',   'Sabadell no residentes',      TRUE, FALSE, FALSE),
  ('banca_360',      'Banca 360 / MSF 360',      'MSF 360 - Sabadell Residentes', TRUE, FALSE, FALSE)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Update sheet_name to reflect the actual active tabs (many are "Test" tabs)
-- Source of truth: BANCOS_CONFIG in Pasar datos a pestañas.js
-- ---------------------------------------------------------------------------
UPDATE banks SET sheet_name = 'Unicaja Test'          WHERE slug = 'unicaja';
UPDATE banks SET sheet_name = 'Laboral Kutxa Test'    WHERE slug = 'laboral_kutxa';
UPDATE banks SET sheet_name = 'MyInvestor Test'       WHERE slug = 'myinvestor';
UPDATE banks SET sheet_name = 'CR del Sur Test'       WHERE slug = 'cr_del_sur';
UPDATE banks SET sheet_name = 'CR Teruel Test'        WHERE slug = 'cr_teruel';
UPDATE banks SET sheet_name = 'CR Granada Test'       WHERE slug = 'cr_granada';
UPDATE banks SET sheet_name = 'EuroCajaRural Test'    WHERE slug = 'eurocajarural';
UPDATE banks SET sheet_name = 'Globalcaja Test'       WHERE slug = 'globalcaja';
UPDATE banks SET sheet_name = 'No Bank Fee Test'      WHERE slug = 'no_bank_fee';
UPDATE banks SET sheet_name = 'CR Asturias Test'      WHERE slug = 'cr_asturias';
UPDATE banks SET sheet_name = 'Ibercaja Test'         WHERE slug = 'ibercaja';
UPDATE banks SET sheet_name = 'Deutsche Bank Test'    WHERE slug = 'deutsche_bank';
UPDATE banks SET sheet_name = 'Cajamar Test'          WHERE slug = 'cajamar';
UPDATE banks SET sheet_name = 'Caixa Popular Test'    WHERE slug = 'caixa_popular';
UPDATE banks SET sheet_name = 'CR Aragon Test'        WHERE slug = 'cr_aragon';
UPDATE banks SET sheet_name = 'RURALNOSTRA'           WHERE slug = 'ruralnostra';
