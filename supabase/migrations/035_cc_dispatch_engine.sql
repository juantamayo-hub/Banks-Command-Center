-- 035: Envío de dossiers desde el Command Center (sin Google Sheets ni Apps Script)
--
-- Hoy: generador n8n → hoja "Step 1" → Apps Script reparte a la pestaña del banco → onEdit lanza "Send Dossier"
-- → n8n escribe el resultado en la hoja → syncToSupabase (cada minuto) copia la hoja a sheet_rows.
-- Nuevo (banco a banco): generador → POST /api/dossiers/event → el CC crea la línea en sheet_rows y lanza el
-- webhook del banco → n8n informa del resultado a /api/dispatch/report. La hoja queda congelada.
--
-- ADITIVA: no modifica ni borra datos. Todo banco empieza en dispatch_engine = 'sheets' (comportamiento actual).
--   · bank_config.dispatch_engine  → interruptor por banco ('sheets' | 'cc')
--   · bank_config.send_webhook_path / send_payload_prefix / banks_slug → datos para lanzar el webhook sin Apps Script
--   · sheet_rows.engine + columnas de control del envío
--   · trigger: el sync de Apps Script nunca pisa una línea del CC
--   · dossiers → dossiers creados por el generador (página /dashboard/dossiers)
--   · claim_dispatch() → reserva atómica antes de llamar a n8n (anti-duplicados)
--   · realtime en sheet_rows y dossiers (las líneas desaparecen solas de Pendientes)

-- ── 1. Interruptor y datos de envío por banco ───────────────────────────────
alter table bank_config add column if not exists dispatch_engine text not null default 'sheets'
  check (dispatch_engine in ('sheets', 'cc'));
alter table bank_config add column if not exists send_webhook_path text;     -- ruta del webhook n8n "Send Dossier"
alter table bank_config add column if not exists send_payload_prefix text;   -- prefijo de _<prefix>_action, _<prefix>_item_id…
alter table bank_config add column if not exists banks_slug text;            -- slug en la tabla banks (sheet_rows.bank_id)

comment on column bank_config.dispatch_engine is
  'sheets = envío por la hoja + Apps Script (antiguo); cc = el Command Center crea la línea y lanza el webhook n8n';

-- Mismos webhooks y prefijos que usa hoy Apps Script (apps/appscript/ROW_ID *.js)
update bank_config c set send_webhook_path = v.path, send_payload_prefix = v.prefix, banks_slug = v.banks_slug
from (values
  ('caixa_popular', 'send-dossier-caixapopular',            'caixapopular',  'caixa_popular'),
  ('cajamar',       'send-dossier-cajamar',                 'cajamar',       'cajamar'),
  ('cr_aragon',     'send-dossier-craragon',                'craragon',      'cr_aragon'),
  ('cr_asturias',   'send-dossier-crasturias',              'crasturias',    'cr_asturias'),
  ('cr_granada',    'send-dossier-crgranada',               'crgranada',     'cr_granada'),
  ('cr_teruel',     'send-dossier-crteruel',                'teruel',        'cr_teruel'),
  ('cr_del_sur',    'send-dossier-crdelsur',                'crdelsur',      'cr_del_sur'),
  ('deutsche_bank', 'send-dossier-deutsche-bank',           'deutsche',      'deutsche_bank'),
  ('eurocajarural', 'send-dossier-eurocajarural',           'eurocajarural', 'eurocajarural'),
  ('globalcaja',    'send-dossier-globalcaja',              'globalcaja',    'globalcaja'),
  ('ibercaja',      'ibercaja-dossier',                     'ibercaja',      'ibercaja'),
  ('ing',           'f2b00ff3-0d78-48ac-a258-6425893eec61', 'ing',           'ing'),
  ('laboral_kutxa', 'kutxa-dossier-envio',                  'laboralk',      'laboral_kutxa'),
  ('myinvestor',    'send-dossier-MyInvestor',              'MYINVESTOR',    'myinvestor'),
  ('no_bank_fee',   'send-dossier-nobankfee',               'nobankfee',     'no_bank_fee'),
  ('pichincha',     'Pichincha',                            'PICHINCHA',     'pichincha'),
  ('ruralnostra',   'Ruralnostra-dossier',                  'ruralnostra',   'ruralnostra'),
  ('hipotecas_com', 'send-dossier-hipotecascom',            'uci',           'uci'),
  ('unicaja',       'send-dossier-unicaja',                 'UNICAJA',       'unicaja')
) as v(bank_slug, path, prefix, banks_slug)
where c.bank_slug = v.bank_slug;

-- ── 2. Línea de envío: columnas de control (sheet_rows sigue siendo la tabla de envíos) ──
alter table sheet_rows add column if not exists engine text not null default 'sheets'
  check (engine in ('sheets', 'cc'));
alter table sheet_rows add column if not exists dossier_id uuid;
alter table sheet_rows add column if not exists attempts integer not null default 0;
alter table sheet_rows add column if not exists last_attempt_at timestamptz;
alter table sheet_rows add column if not exists reported_at timestamptz;        -- último informe de n8n
alter table sheet_rows add column if not exists last_error text;
alter table sheet_rows add column if not exists block_reason text;
alter table sheet_rows add column if not exists n8n_execution_id text;
alter table sheet_rows add column if not exists test_mode boolean not null default false;
alter table sheet_rows add column if not exists dispatch_source text;           -- auto | manual | nuevo_envio

create index if not exists idx_sheet_rows_cc_sending on sheet_rows (last_attempt_at)
  where engine = 'cc' and status = 'sending';

-- ── 3. El sync de Apps Script nunca pisa una línea del CC ───────────────────
-- syncToSupabase.js siempre escribe synced_at; el CC nunca lo hace. Si una línea es del CC y la escritura
-- trae un synced_at nuevo, viene del sync → se ignora (la línea queda como estaba).
create or replace function protect_cc_rows_from_sheet_sync()
returns trigger language plpgsql as $$
begin
  if old.engine = 'cc' and new.synced_at is distinct from old.synced_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_cc_rows on sheet_rows;
create trigger trg_protect_cc_rows before update on sheet_rows
  for each row execute function protect_cc_rows_from_sheet_sync();

-- ── 4. Dossiers creados por el generador ───────────────────────────────────
create table if not exists dossiers (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  bigint      not null,
  dossier_key     text        not null default 'UNICO',     -- UNICO | A | B | C (un dossier por importe distinto)
  cliente         text,
  owner           text,
  importe         numeric,
  link_dossier    text,
  status          text        not null default 'generating'
                  check (status in ('generating', 'ready', 'error')),
  error_type      text,
  error_text      text,
  execution_id    text,
  test_mode       boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (opportunity_id, dossier_key)
);

create index if not exists idx_dossiers_created on dossiers (created_at desc);

drop trigger if exists trg_dossiers_updated_at on dossiers;
create trigger trg_dossiers_updated_at before update on dossiers
  for each row execute function update_updated_at_column();

alter table dossiers enable row level security;
drop policy if exists dossiers_select on dossiers;
create policy dossiers_select on dossiers for select to authenticated using (true);
-- escritura: solo service_role (salta RLS)

-- ── 5. Reserva atómica antes de lanzar el webhook ──────────────────────────
-- Devuelve la línea reservada (status → sending). Bloquea:
--   · línea que no es del CC                      → NOT_CC
--   · ya enviándose hace menos de 15 min          → BLOCKED
--   · ya enviada / con oferta, sin force          → REQUIRES_FORCE
create or replace function claim_dispatch(
  p_row_id uuid,
  p_action text default 'ENVIAR',
  p_force  boolean default false,
  p_actor  text default 'system',
  p_source text default 'auto'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r sheet_rows%rowtype;
begin
  select * into r from sheet_rows where id = p_row_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'Línea no encontrada');
  end if;
  if r.engine <> 'cc' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CC', 'error', 'La línea se envía por la hoja');
  end if;
  if r.status = 'sending' and r.last_attempt_at > now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'code', 'BLOCKED', 'error', 'Ya se está enviando', 'current_status', r.status);
  end if;
  if r.status in ('sent', 'offer_received') and not p_force then
    return jsonb_build_object('ok', false, 'code', 'REQUIRES_FORCE', 'error', 'Ya enviado: requiere confirmación', 'current_status', r.status);
  end if;

  update sheet_rows set
    status          = 'sending',
    process_status  = 'Enviando a n8n (' || p_action || ')',
    attempts        = r.attempts + 1,
    last_attempt_at = now(),
    last_error      = null,
    block_reason    = null,
    dispatch_source = p_source,
    autorizacion    = case when p_action = 'AUTORIZACION' then 'Yes' else r.autorizacion end,
    timestamp_sent  = case when p_force then null else r.timestamp_sent end,
    test_time       = now()
  where id = p_row_id;

  insert into dispatch_attempts (sheet_row_id, bank_id, opportunity_id, uid, triggered_by, status, force_flag)
  values (r.id, r.bank_id, r.opportunity_id, r.uid, p_actor, 'claimed', p_force);

  insert into event_log (event_type, sheet_row_id, bank_id, opportunity_id, actor, payload)
  values ('dispatch', r.id, r.bank_id, r.opportunity_id, p_actor,
          jsonb_build_object('action', p_action, 'force', p_force, 'source', p_source, 'previous_status', r.status));

  return jsonb_build_object('ok', true, 'previous_status', r.status, 'attempt', r.attempts + 1);
end;
$$;

revoke all on function claim_dispatch(uuid, text, boolean, text, text) from public, anon, authenticated;

-- ── 6. Tiempo real: Pendientes se actualiza sola ────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sheet_rows') then
    alter publication supabase_realtime add table sheet_rows;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dossiers') then
    alter publication supabase_realtime add table dossiers;
  end if;
end $$;
