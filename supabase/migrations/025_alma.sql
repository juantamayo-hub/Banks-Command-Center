-- 025: Alma — eventos de diagnóstico de los flujos + registro del chat
--
-- flow_events: lo que hoy solo llega a Slack o a texto libre en NOTAS (peso del dossier, error de Gmail,
-- merge/compresión fallidos, documentos de la carpeta, bloqueos anti-duplicado). Lo escriben n8n y el
-- Command Center vía POST /api/flow-events. Alma lo usa para explicar por qué un envío no salió.
--
-- alma_conversations / alma_messages: auditoría del chat (quién preguntó qué y qué datos usó Alma).
-- alma_reports: reportes técnicos escalados a Juanjo por Slack.
-- Todo es aditivo: no toca tablas existentes.

create table if not exists flow_events (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  bigint,
  bank_deal_id    bigint,
  bank_slug       text,
  workflow        text not null,             -- p. ej. 'dossier_generation', 'send_dossier', 'dossier_claim'
  step            text,                       -- nodo o paso donde ocurrió
  kind            text not null,              -- gmail_error | dossier_too_big | dossier_generated | compress_failed
                                              -- | merge_failed | upload_failed | decrypt_failed | missing_docs
                                              -- | docs_snapshot | antidup_blocked | flow_error
  severity        text not null default 'info' check (severity in ('info', 'warning', 'error')),
  message         text,                       -- texto legible
  detail          jsonb not null default '{}'::jsonb,  -- size_mb, limit_mb, error, files[], execution_id…
  execution_id    text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_flow_events_opp on flow_events (opportunity_id, created_at desc);
create index if not exists idx_flow_events_bank_deal on flow_events (bank_deal_id, created_at desc);
create index if not exists idx_flow_events_kind on flow_events (kind, created_at desc);

alter table flow_events enable row level security;

drop policy if exists "flow_events_select_authenticated" on flow_events;
create policy "flow_events_select_authenticated" on flow_events
  for select to authenticated using (true);

drop policy if exists "flow_events_all_service_role" on flow_events;
create policy "flow_events_all_service_role" on flow_events
  for all to service_role using (true) with check (true);

create table if not exists alma_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null,
  app         text not null default 'command_center' check (app in ('command_center', 'request_hub')),
  env         text not null default 'production',
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_alma_conversations_user on alma_conversations (user_email, updated_at desc);

drop trigger if exists trg_alma_conversations_updated_at on alma_conversations;
create trigger trg_alma_conversations_updated_at
  before update on alma_conversations
  for each row execute function update_updated_at_column();

create table if not exists alma_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references alma_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  tools_used       jsonb not null default '[]'::jsonb,  -- [{name, input, ok}]
  technical_issue  boolean not null default false,       -- Alma detectó un problema técnico (habilita el reporte)
  input_tokens     integer,
  output_tokens    integer,
  created_at       timestamptz not null default now()
);

create index if not exists idx_alma_messages_conv on alma_messages (conversation_id, created_at);

create table if not exists alma_reports (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references alma_conversations(id) on delete set null,
  user_email       text not null,
  opportunity_id   bigint,
  bank_slug        text,
  summary          text not null,
  evidence         jsonb not null default '{}'::jsonb,
  slack_ts         text,
  env              text not null default 'production',
  created_at       timestamptz not null default now()
);

create index if not exists idx_alma_reports_created on alma_reports (created_at desc);

-- Solo el servidor (service_role) lee y escribe el chat; el navegador nunca accede directamente.
alter table alma_conversations enable row level security;
alter table alma_messages enable row level security;
alter table alma_reports enable row level security;

drop policy if exists "alma_conversations_all_service_role" on alma_conversations;
create policy "alma_conversations_all_service_role" on alma_conversations
  for all to service_role using (true) with check (true);

drop policy if exists "alma_messages_all_service_role" on alma_messages;
create policy "alma_messages_all_service_role" on alma_messages
  for all to service_role using (true) with check (true);

drop policy if exists "alma_reports_all_service_role" on alma_reports;
create policy "alma_reports_all_service_role" on alma_reports
  for all to service_role using (true) with check (true);
