-- 027: Envíos a entidades de préstamo (Cofidis; preparado para Inversiones Griffs y PrimeTeca)
--
-- Los rellena el flujo n8n de envío (Gabriel) cada vez que intenta enviar un caso a la entidad:
--   · lender_submissions        → estado ACTUAL del caso (1 fila por entidad + deal; UPSERT)
--   · lender_submission_events  → historial de cada intento (1 fila por intento; INSERT)
-- El Command Center lee lender_submissions para la sección de pendientes (modelo Kutxabank):
-- los casos con status = 'pending_docs' o 'error' se revisan y se envían desde allí.
-- Aditivo: no toca tablas existentes.

create table if not exists lender_submissions (
  id               uuid primary key default gen_random_uuid(),

  -- Qué y de dónde
  lender           text        not null,                 -- 'cofidis' | 'inversiones_griffs' | 'primeteca'
  source           text        not null                  -- flujo que originó el envío
                   check (source in ('loans_pipeline', 'no_bank_fee')),
  product          text        not null                  -- préstamo personal / reunificación de deudas
                   check (product in ('personal_loan', 'debt_consolidation')),
  deal_id          bigint      not null,                 -- deal de Pipedrive que dispara el envío (préstamos o general)
  bank_deal_id     bigint,                               -- deal bancario, si existe

  -- Cliente y consultor
  client_name      text,
  dni              text,
  holders          smallint    check (holders in (1, 2)),  -- nº de titulares (plantilla 1T / 2T)
  owner_email      text,                                 -- consultor (va en copia del correo)

  -- Estado del envío
  status           text        not null default 'pending_docs'
                   check (status in ('pending_docs', 'sent', 'error', 'dismissed')),
  missing_docs     text[]      not null default '{}',    -- p. ej. {'Autorización','Formulario Cofidis','DNI 2T'}
  sent_at          timestamptz,                          -- cuándo salió el correo a la entidad
  sent_to          text,                                 -- p. ej. apis@cofidis.es
  gmail_message_id text,                                 -- id del correo enviado (trazabilidad)
  drive_folder_id  text,                                 -- carpeta con la documentación del caso
  error_message    text,                                 -- solo si status = 'error'

  -- Trazabilidad n8n
  workflow_id      text,
  execution_id     text,
  attempts         integer     not null default 1,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Un caso por entidad y deal: n8n hace UPSERT con on_conflict=lender,deal_id
  unique (lender, deal_id)
);

comment on table lender_submissions is
  'Estado actual de cada envío a entidades de préstamo (Cofidis…). 1 fila por (lender, deal_id); n8n hace UPSERT. '
  'pending_docs = no se envió por documentación incompleta (ver missing_docs); sent = enviado; error = fallo técnico; '
  'dismissed = descartado desde el Command Center.';

create index if not exists idx_lender_submissions_status on lender_submissions (lender, status, updated_at desc);

create table if not exists lender_submission_events (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid        references lender_submissions(id) on delete cascade,
  lender         text        not null,
  source         text        not null,
  deal_id        bigint      not null,
  status         text        not null check (status in ('pending_docs', 'sent', 'error', 'dismissed')),
  missing_docs   text[]      not null default '{}',
  detail         text,                                   -- mensaje libre: error, "enviado desde CC por …", etc.
  workflow_id    text,
  execution_id   text,
  created_at     timestamptz not null default now()
);

comment on table lender_submission_events is
  'Historial: una fila por cada intento de envío (o acción manual) sobre un caso de lender_submissions.';

create index if not exists idx_lender_submission_events_deal on lender_submission_events (lender, deal_id, created_at desc);

-- updated_at automático (función compartida de migraciones anteriores)
drop trigger if exists trg_lender_submissions_updated_at on lender_submissions;
create trigger trg_lender_submissions_updated_at
  before update on lender_submissions
  for each row execute function update_updated_at_column();

-- RLS: el dashboard (usuario autenticado) solo lee; escriben n8n y las API del CC con service_role
alter table lender_submissions enable row level security;
alter table lender_submission_events enable row level security;

drop policy if exists lender_submissions_select on lender_submissions;
create policy lender_submissions_select on lender_submissions for select to authenticated using (true);
drop policy if exists lender_submissions_service_all on lender_submissions;
create policy lender_submissions_service_all on lender_submissions for all to service_role using (true) with check (true);

drop policy if exists lender_submission_events_select on lender_submission_events;
create policy lender_submission_events_select on lender_submission_events for select to authenticated using (true);
drop policy if exists lender_submission_events_service_all on lender_submission_events;
create policy lender_submission_events_service_all on lender_submission_events for all to service_role using (true) with check (true);
