-- 030: Configuración de bancos — regla general de red flags, canal de envío por banco, bancos que faltaban
--      y correcciones pedidas por Juanjo (2026-10-20).
-- Aditivo sobre 028/029.

-- ── Canal de envío y uso de la regla general ─────────────────────────────────
alter table bank_config
  add column if not exists channel text not null default 'email'
    check (channel in ('email', 'platform', 'none')),           -- email = flujo n8n "Send Dossier" por correo
  add column if not exists channel_note text,                    -- por qué no aplica (plataforma, flujo propio…)
  add column if not exists redflags_apply boolean not null default true,   -- el flujo pasa por el subflujo de red flags
  add column if not exists uses_general_rules boolean not null default false;

comment on column bank_config.uses_general_rules is
  'true = las red flags de este banco usan la regla general (bank_redflag_general) e ignoran sus reglas propias.';

-- ── Regla general (lo que el subflujo usaba por defecto cuando el banco no tenía fila) ──
create table if not exists bank_redflag_general (
  operation_type         text primary key
                         check (operation_type in ('primera_residencia', 'segunda_residencia', 'cambio_hipoteca')),
  min_importe            numeric,
  max_plazo_anos         numeric,
  max_financiacion_pct   numeric,
  max_edad_plazo         numeric,
  min_ingresos_1t        numeric,
  max_dti_pct            numeric,
  min_ingresos_2t        numeric,
  max_bancos             integer,
  min_antiguedad_anos    numeric,
  validate_dti           boolean     not null default false,
  notes                  text,
  updated_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists trg_bank_redflag_general_updated_at on bank_redflag_general;
create trigger trg_bank_redflag_general_updated_at before update on bank_redflag_general
  for each row execute function update_updated_at_column();

alter table bank_redflag_general enable row level security;
drop policy if exists bank_redflag_general_select on bank_redflag_general;
create policy bank_redflag_general_select on bank_redflag_general for select to authenticated using (true);
drop policy if exists bank_redflag_general_service_all on bank_redflag_general;
create policy bank_redflag_general_service_all on bank_redflag_general for all to service_role using (true) with check (true);

-- Valores = defaults del nodo "Validate All Rules" del subflujo Red Flag Check IRPF
insert into bank_redflag_general (operation_type, min_importe, max_plazo_anos, max_financiacion_pct, max_edad_plazo,
  min_ingresos_1t, max_dti_pct, min_ingresos_2t, max_bancos, notes, updated_by) values
  ('primera_residencia', 80000, 30, 100, 75, 1200, 35, 0, 1, 'Valores por defecto del subflujo de red flags', 'seed'),
  ('segunda_residencia', 80000, 30, 100, 75, 1200, 35, 0, 1, 'Valores por defecto del subflujo de red flags', 'seed'),
  ('cambio_hipoteca',    80000, 30, 100, 75, 1200, 35, 0, 1, 'Valores por defecto del subflujo de red flags', 'seed')
on conflict (operation_type) do nothing;

-- Bancos con envío por correo sin reglas propias en la hoja → regla general
update bank_config set uses_general_rules = true where bank_slug in ('caixa_popular', 'no_bank_fee', 'pichincha');

-- ── Canal de los bancos ya cargados ──────────────────────────────────────────
update bank_config set channel = 'platform', redflags_apply = false,
  channel_note = 'Se envía por la plataforma del banco (sección Envíos por plataforma). Sus reglas no las usa ningún flujo.'
  where bank_slug = 'caixabank';
update bank_config set channel = 'none', redflags_apply = false,
  channel_note = 'No hay flujo de envío propio: los expedientes de UCI salen por Hipotecas.com.'
  where bank_slug = 'uci';

-- ── Bancos que faltaban ──────────────────────────────────────────────────────
insert into bank_config (bank_slug, display_name, pipedrive_names, channel, channel_note, redflags_apply, to_source, updated_by) values
  ('santander',      'Santander',      array['Santander']::text[],      'platform', 'Se envía por la plataforma del banco (sección Envíos por plataforma).', false, 'contacts', 'seed'),
  ('sabadell',       'Sabadell',       array['Sabadell']::text[],       'platform', 'Se envía por la plataforma del banco (sección Envíos por plataforma).', false, 'contacts', 'seed'),
  ('bankinter',      'Bankinter',      array['Bankinter']::text[],      'platform', 'Se envía por la plataforma del banco (sección Envíos por plataforma).', false, 'contacts', 'seed'),
  ('abanca',         'Abanca',         array['Abanca']::text[],         'platform', 'Se envía por la plataforma del banco (sección Envíos por plataforma).', false, 'contacts', 'seed'),
  ('kutxabank',      'Kutxabank',      array['Kutxabank']::text[],      'platform', 'Flujo propio: ZIP cifrado vía Rastreator (sección Kutxabank).', false, 'contacts', 'seed'),
  ('ing',            'ING',            array['ING']::text[],            'email',    'Envía al "Email bancario" del deal. Su flujo no pasa por el control de red flags.', false, 'deal_field', 'seed'),
  ('cr_extremadura', 'CR Extremadura', array['CR Extremadura']::text[], 'none',     'Sin flujo de envío automático.', false, 'contacts', 'seed'),
  ('banca_360',      'Banca 360',      array['Banca 360']::text[],      'none',     'Sin flujo de envío automático.', false, 'contacts', 'seed')
on conflict (bank_slug) do nothing;

-- ── Correcciones (Juanjo, 2026-10-20) ────────────────────────────────────────
-- Ibercaja Badajoz: la oficina estaba como @bayteca.es
insert into bank_config_history (bank_slug, table_name, record_key, action, before, after, actor)
select 'ibercaja', 'bank_contacts', 'province:Badajoz', 'update',
       jsonb_build_object('cc_emails', cc_emails), jsonb_build_object('cc_emails', array['2085.4503@ibercaja.es']),
       'juan.tamayo@huspy.io (corrección migración 030)'
from bank_contacts where bank_slug = 'ibercaja' and scope = 'province' and scope_value = 'Badajoz'
  and '2085.4503@bayteca.es' = any (cc_emails);
update bank_contacts set cc_emails = array['2085.4503@ibercaja.es'], updated_by = 'juan.tamayo@huspy.io'
  where bank_slug = 'ibercaja' and scope = 'province' and scope_value = 'Badajoz' and '2085.4503@bayteca.es' = any (cc_emails);

-- Hipotecas.com La Rioja: la hoja tenía "Rioja La" y el flujo nunca la encontraba
insert into bank_contacts (bank_slug, scope, scope_value, to_emails, notes, updated_by)
values ('hipotecas_com', 'province', 'Rioja, La', array['ivan.gutierrez@redext.uci.com'],
        'Corregido: en la hoja estaba como "Rioja La"', 'juan.tamayo@huspy.io')
on conflict do nothing;
insert into bank_config_history (bank_slug, table_name, record_key, action, before, after, actor)
values ('hipotecas_com', 'bank_contacts', 'province:Rioja, La', 'insert', null,
        jsonb_build_object('to_emails', array['ivan.gutierrez@redext.uci.com']),
        'juan.tamayo@huspy.io (corrección migración 030)');

-- Unicaja: el asunto de referencia decía "Laboral Kutxa"
update bank_config
  set subject_template = 'Unicaja - Nuevo Expediente - {BankDealID} - {Expediente} - {Nombre} - DNI {DNI}',
      updated_by = 'juan.tamayo@huspy.io'
  where bank_slug = 'unicaja' and subject_template like 'Laboral Kutxa%';
