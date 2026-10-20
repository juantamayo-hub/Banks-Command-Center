-- 031: Bancos del desplegable de Pipedrive con los que hoy no se trabaja
-- (no están en el Google Sheet operativo, ni en n8n, ni en envíos por plataforma).
-- Se muestran aparte en /dashboard/configuracion.

alter table bank_config drop constraint if exists bank_config_channel_check;
alter table bank_config add constraint bank_config_channel_check
  check (channel in ('email', 'platform', 'none', 'unused'));

update bank_config
  set channel = 'unused',
      channel_note = 'Está en el desplegable de bancos de Pipedrive, pero hoy no trabajamos con este banco (no hay hoja, flujo ni plataforma).',
      updated_by = 'seed'
  where bank_slug in ('banca_march', 'bbva', 'cajasiete', 'evo', 'targobank', 'vp_bank', 'quintet', 'cr_zamora', 'caixa_ontinyent');
