-- 034_alma_mailbox_audit.sql
-- Auditoría de las consultas de Alma al buzón de hipotecas (herramientas buzon_buscar / buzon_leer).
-- Solo lectura del buzón vía n8n; aquí queda quién buscó/leyó qué y cuántos resultados obtuvo.
-- Solo service_role: RLS activado y sin políticas para anon/authenticated. Aditivo: no toca tablas existentes.

create table if not exists alma_mailbox_audit (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_email    text not null,
  action        text not null check (action in ('search', 'read')),
  query         text,
  message_id    text,
  result_count  integer,
  ok            boolean not null default false
);

create index if not exists idx_alma_mailbox_audit_user on alma_mailbox_audit (user_email, created_at desc);

alter table alma_mailbox_audit enable row level security;

revoke all on alma_mailbox_audit from anon, authenticated;

drop policy if exists "alma_mailbox_audit_all_service_role" on alma_mailbox_audit;
create policy "alma_mailbox_audit_all_service_role" on alma_mailbox_audit
  for all to service_role using (true) with check (true);
