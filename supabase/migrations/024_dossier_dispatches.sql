-- 024: reserva atómica de envíos de dossier al banco (anti-duplicados)
--
-- Los workflows n8n "Send Dossier *" llaman a POST /api/dossier/claim justo antes de
-- mandar el correo al banco. UNIQUE(bank_slug, opportunity_id) garantiza que, aunque lleguen
-- dos webhooks casi a la vez (ENVIAR + AUTORIZACION, plataforma + hoja), solo uno envía.
-- (La clave es banco + Opportunity ID porque el Bank Deal ID de la hoja puede venir vacío.)

create table if not exists dossier_dispatches (
  id               uuid primary key default gen_random_uuid(),
  bank_slug        text not null,
  opportunity_id   bigint not null,
  bank_deal_id     bigint,
  workflow_id      text,
  execution_id     text,
  source           text,
  claimed_at       timestamptz not null default now(),
  attempts         integer not null default 1,
  forced           boolean not null default false,
  blocked_count    integer not null default 0,
  last_blocked_at  timestamptz,
  last_blocked_execution_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (bank_slug, opportunity_id)
);

create index if not exists idx_dossier_dispatches_claimed_at on dossier_dispatches (claimed_at desc);

drop trigger if exists trg_dossier_dispatches_updated_at on dossier_dispatches;
create trigger trg_dossier_dispatches_updated_at
  before update on dossier_dispatches
  for each row execute function update_updated_at_column();

alter table dossier_dispatches enable row level security;

drop policy if exists "dossier_dispatches_select_authenticated" on dossier_dispatches;
create policy "dossier_dispatches_select_authenticated" on dossier_dispatches
  for select to authenticated using (true);

drop policy if exists "dossier_dispatches_all_service_role" on dossier_dispatches;
create policy "dossier_dispatches_all_service_role" on dossier_dispatches
  for all to service_role using (true) with check (true);
