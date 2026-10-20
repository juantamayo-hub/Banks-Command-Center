-- 032: Gestores de banco (Santander) y asignaciones recibidas del banco
--
-- Santander contesta al informe diario de activaciones con un Excel (Nombre cliente, DNI, Fecha, Estado vivienda,
-- Importe, Gestor Asignado). El Command Center (POST /api/santander/agent-assignments, llamado por n8n) busca el deal
-- bancario (pipeline 7) por DNI, y escribe el correo del gestor en "Bank Mail / Email agente bancario" + nota.
--   · bank_agents             → nombre → correo de cada gestor (lo mantiene Florencia desde Configuración → Santander)
--   · bank_agent_assignments  → una fila por cliente + gestor recibido (idempotencia y cola de pendientes)
-- Aditivo: no toca tablas existentes.

create table if not exists bank_agents (
  id          uuid primary key default gen_random_uuid(),
  bank_slug   text        not null references bank_config(bank_slug) on delete cascade,
  full_name   text        not null,
  name_key    text        not null,          -- MAYÚSCULAS, sin tildes ni signos, espacios simples
  email       text        not null,
  active      boolean     not null default true,
  notes       text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (bank_slug, name_key)
);

comment on table bank_agents is 'Gestores de banco (nombre que manda el banco → correo). Editable en Configuración → <banco> → Gestores.';

create table if not exists bank_agent_assignments (
  id                 uuid primary key default gen_random_uuid(),
  bank_slug          text        not null,
  source_message_id  text,                    -- id del correo de Gmail del banco
  source_file        text,
  client_name        text,
  dni                text        not null,    -- normalizado (mayúsculas, sin espacios ni guiones)
  agent_name_raw     text        not null,    -- tal cual viene en el Excel
  agent_key          text        not null,
  agent_email        text,
  bank_deal_id       bigint,                  -- deal bancario (pipeline 7) donde se escribió
  status             text        not null
                     check (status in ('assigned', 'already_assigned', 'pending_agent', 'deal_not_found', 'error')),
  detail             text,
  pipedrive_note_id  bigint,
  hub_ticket_id      text,
  notified_at        timestamptz,             -- aviso enviado (gestor desconocido / deal no encontrado)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (bank_slug, dni, agent_key)
);

comment on table bank_agent_assignments is
  'Asignaciones de gestor recibidas del banco. assigned/already_assigned = hecho; pending_agent = falta el correo del gestor; '
  'deal_not_found = no hay un único deal bancario (pipeline 7) para ese DNI; error = fallo técnico (se reintenta).';

create index if not exists idx_bank_agent_assignments_status on bank_agent_assignments (bank_slug, status, created_at desc);

drop trigger if exists trg_bank_agents_updated_at on bank_agents;
create trigger trg_bank_agents_updated_at before update on bank_agents
  for each row execute function update_updated_at_column();
drop trigger if exists trg_bank_agent_assignments_updated_at on bank_agent_assignments;
create trigger trg_bank_agent_assignments_updated_at before update on bank_agent_assignments
  for each row execute function update_updated_at_column();

do $$
declare t text;
begin
  foreach t in array array['bank_agents', 'bank_agent_assignments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_service_all', t);
    execute format('create policy %I on %I for all to service_role using (true) with check (true)', t || '_service_all', t);
  end loop;
end $$;

-- Carga inicial: "Listado Gestores Santander.xlsx" (Florencia, 2026-10-20)
insert into bank_agents (bank_slug, full_name, name_key, email, updated_by) values
  ('santander', 'AIDA CARRERO MARTIN', 'AIDA CARRERO MARTIN', 'aida.carrero@gruposantander.es', 'seed'),
  ('santander', 'ANA GONZALEZ LOPEZ', 'ANA GONZALEZ LOPEZ', 'ana.gonzalezlopez@gruposantander.es', 'seed'),
  ('santander', 'ANA MARIA FERREIRO VILASO', 'ANA MARIA FERREIRO VILASO', 'anamaria.ferreiro@gruposantander.es', 'seed'),
  ('santander', 'ANGEL LUIS PEREZ MAJADA', 'ANGEL LUIS PEREZ MAJADA', 'angelluis.perez@gruposantander.es', 'seed'),
  ('santander', 'CARLA VILLASECA MARTIN', 'CARLA VILLASECA MARTIN', 'carla.villaseca@gruposantander.es', 'seed'),
  ('santander', 'CAROLINA ALONSO', 'CAROLINA ALONSO', 'carolinagabriela.alonso@gruposantander.es', 'seed'),
  ('santander', 'DOLORES MAGAN MAGAN', 'DOLORES MAGAN MAGAN', 'dmagan@gruposantander.es', 'seed'),
  ('santander', 'GEMA VILLALBA OLIVEROS', 'GEMA VILLALBA OLIVEROS', 'gema.villalbaoliveros@gruposantander.es', 'seed'),
  ('santander', 'LIDIA SÁNCHEZ REMIREZ', 'LIDIA SANCHEZ REMIREZ', 'lidia.sanchez@gruposantander.es', 'seed'),
  ('santander', 'LORENA CONDE OUTERIÑO', 'LORENA CONDE OUTERINO', 'lorena.conde@gruposantander.es', 'seed'),
  ('santander', 'LUCÍA LARA REDONDO', 'LUCIA LARA REDONDO', 'lucia.lara@gruposantander.es', 'seed'),
  ('santander', 'MARIA PILAR OTERO DIAZ', 'MARIA PILAR OTERO DIAZ', 'mariapilar.otero@gruposantander.es', 'seed'),
  ('santander', 'MIGUEL TRIGO ROJAS', 'MIGUEL TRIGO ROJAS', 'migueljuan.trigo@gruposantander.es', 'seed'),
  ('santander', 'PABLO SANCHEZ LOPEZ', 'PABLO SANCHEZ LOPEZ', 'pablo.sanchezlopez@gruposantander.es', 'seed'),
  ('santander', 'SERGIO ALONSO GARCIA', 'SERGIO ALONSO GARCIA', 'sergio.alonsogarcia@gruposantander.es', 'seed'),
  ('santander', 'SERGIO GONZALEZ GUISADO', 'SERGIO GONZALEZ GUISADO', 'sergio.gonzalezguisado@gruposantander.es', 'seed'),
  ('santander', 'SUSANA MUIÑO SADA', 'SUSANA MUINO SADA', 'smuino@gruposantander.es', 'seed'),
  ('santander', 'VERONICA CULEBRAS GALVEZ', 'VERONICA CULEBRAS GALVEZ', 'veronica.culebrasgalvez@gruposantander.es', 'seed')
on conflict (bank_slug, name_key) do nothing;
