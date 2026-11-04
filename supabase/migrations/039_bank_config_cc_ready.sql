-- 039: marca "flujo n8n adaptado" por banco.
-- El interruptor dispatch_engine solo puede pasar a 'cc' si el Send Dossier del banco ya informa al Command Center
-- (bifurcación "¿Desde CC?" + modo prueba + anti-duplicado). La pone quien adapta y prueba el flujo; así no se puede
-- encender por error un banco cuyo flujo aún escribe en la hoja (se quedaría sin enviar).

alter table bank_config add column if not exists cc_ready boolean not null default false;
alter table bank_config add column if not exists cc_ready_note text;   -- p. ej. "adaptado y probado en staging 04-nov"

comment on column bank_config.cc_ready is
  'true = el Send Dossier de n8n ya está adaptado al Command Center y probado; requisito para dispatch_engine = cc';

-- CR Teruel (eUntnpw1FAhx5Ups) y CR del Sur (zgLT2IOJqTidzDXv): adaptados y probados de punta a punta en staging el 04-nov-2026.
-- El resto se marca con un update de datos a medida que pasa su prueba (no requiere migración).
update bank_config set cc_ready = true, cc_ready_note = 'n8n adaptado y probado en staging (envío completo) 04-nov-2026'
where bank_slug in ('cr_teruel', 'cr_del_sur');

-- Red de seguridad en la base: un banco sin flujo adaptado no puede quedar en 'cc'
create or replace function public.enforce_cc_ready()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.dispatch_engine = 'cc' and not new.cc_ready then
    raise exception 'El flujo n8n de % no está adaptado al Command Center (cc_ready = false)', new.bank_slug;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_cc_ready on public.bank_config;
create trigger trg_enforce_cc_ready before insert or update of dispatch_engine, cc_ready on public.bank_config
  for each row execute function public.enforce_cc_ready();
