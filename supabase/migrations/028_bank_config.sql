-- 028: Configuración de bancos editable desde el Command Center
--
-- Sustituye a la Google Sheet "Red_Flags_Bancos_Config" y a los correos escritos a mano en n8n:
--   · bank_config              → ajustes por banco (bloqueo por red flags, origen del TO, asunto…)
--   · bank_redflag_rules       → reglas de red flags por banco y tipo de operación (pestaña "Reglas Red Flag")
--   · bank_required_documents  → documentos de Drive obligatorios (pestaña "Documentos Requeridos")
--   · bank_contacts            → destinatarios por defecto / por provincia / CC condicional (pestaña "Contactos Banco")
--   · provinces                → id de opción de Pipedrive (campo Provincia) → nombre
--   · blocked_emails           → correos a los que nunca se envía (pestaña "Correos excluidos No Bank fee")
--   · bank_config_editors      → quién puede editar desde el Command Center
--   · bank_config_history      → historial de cambios (append-only)
-- n8n solo LEE (GET /api/bank-config/*). Las escrituras las hace el Command Center (server actions, service_role).
-- Aditivo: no toca tablas existentes.

-- ── Ajustes por banco ────────────────────────────────────────────────────────
create table if not exists bank_config (
  bank_slug          text primary key,
  display_name       text        not null,
  pipedrive_names    text[]      not null default '{}',   -- nombres con los que llega el banco en el deal (campo c3a445…)
  block_on_red_flags boolean     not null default false,  -- false = red flags solo informativas (comportamiento actual)
  to_source          text        not null default 'contacts'
                     check (to_source in ('contacts', 'deal_field', 'deal_field_then_contacts', 'contacts_cc_deal_field')),
                     -- contacts                 → TO/CC de bank_contacts
                     -- deal_field               → TO = campo "Email bancario" del deal bancario (498dd83b…)
                     -- deal_field_then_contacts → Email bancario si existe; si no, bank_contacts (Hipotecas.com, Deutsche)
                     -- contacts_cc_deal_field   → TO de bank_contacts; CC = Email bancario si existe, si no el CC de la
                     --                            provincia (Ibercaja: oficina)
  subject_template   text,
  email_from         text        default 'hipotecas@bayteca.com',
  cc_owner           boolean     not null default true,   -- copia al gestor/owner del deal
  sheet_tab          text,                                -- pestaña del sheet operativo del banco (informativo)
  notes              text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table bank_config is
  'Ajustes por banco para los flujos de envío de dossier (n8n). block_on_red_flags=false mantiene las red flags como informativas.';

-- ── Reglas de red flags ──────────────────────────────────────────────────────
create table if not exists bank_redflag_rules (
  id                     uuid primary key default gen_random_uuid(),
  bank_slug              text        not null references bank_config(bank_slug) on delete cascade,
  operation_type         text        not null
                         check (operation_type in ('primera_residencia', 'segunda_residencia', 'cambio_hipoteca')),
  min_importe            numeric,          -- Importe Mínimo (€)
  max_plazo_anos         numeric,          -- Plazo Máximo (años)
  max_financiacion_pct   numeric,          -- % Financiación Máx (null = sin límite)
  max_edad_plazo         numeric,          -- Edad + Plazo Máx
  min_ingresos_1t        numeric,          -- Ingresos Mínimos 1T (€)
  max_dti_pct            numeric,          -- DTI Máximo (%)
  min_ingresos_2t        numeric,          -- Ingresos Mínimos 2T (€)
  max_bancos             integer,          -- Envío Único (máx bancos)
  min_antiguedad_anos    numeric,          -- antes escrito en el código (Unicaja = 2)
  validate_dti           boolean     not null default false,  -- antes escrito en el código (solo Ruralnostra)
  notes                  text,
  updated_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (bank_slug, operation_type)
);

comment on table bank_redflag_rules is
  'Reglas de red flags por banco y tipo de operación. Las lee el subflujo n8n "Red Flag Check IRPF" vía /api/bank-config/redflags.';

-- ── Documentos obligatorios ──────────────────────────────────────────────────
create table if not exists bank_required_documents (
  id             uuid primary key default gen_random_uuid(),
  bank_slug      text        not null references bank_config(bank_slug) on delete cascade,
  drive_code     text        not null,      -- n8n busca en Drive name contains '<código>'
  label          text        not null,
  required       boolean     not null default true,
  ocr            boolean     not null default false,
  extract_field  text,
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (bank_slug, drive_code)
);

-- ── Destinatarios ────────────────────────────────────────────────────────────
-- scope = 'default'  → destinatario cuando no hay regla de provincia (scope_value null)
-- scope = 'province' → scope_value = nombre de provincia (tabla provinces)
-- scope = 'when_to'  → CC extra cuando el TO (dinámico) es scope_value (p. ej. Unicaja mclopezr → lpenalver)
create table if not exists bank_contacts (
  id           uuid primary key default gen_random_uuid(),
  bank_slug    text        not null references bank_config(bank_slug) on delete cascade,
  scope        text        not null check (scope in ('default', 'province', 'when_to')),
  scope_value  text,
  to_emails    text[]      not null default '{}',
  cc_emails    text[]      not null default '{}',
  cc_owner     boolean,                              -- null = lo que diga bank_config.cc_owner (Cajamar: solo Madrid)
  active       boolean     not null default true,
  notes        text,
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((scope = 'default') = (scope_value is null))
);

create unique index if not exists uq_bank_contacts_scope
  on bank_contacts (bank_slug, scope, coalesce(lower(scope_value), ''));

-- ── Provincias (opciones del campo Provincia de Pipedrive) ───────────────────
create table if not exists provinces (
  pipedrive_option_id  integer primary key,
  name                 text    not null,
  aliases              text[]  not null default '{}'   -- variantes escritas en la hoja ("Palmas Las", "Coruña A"…)
);

-- ── Correos bloqueados ───────────────────────────────────────────────────────
create table if not exists blocked_emails (
  id          uuid primary key default gen_random_uuid(),
  email       text        not null,
  bank_slug   text,                                   -- null = aplica a todos los bancos
  reason      text,
  updated_by  text,
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_blocked_emails
  on blocked_emails (lower(email), coalesce(bank_slug, ''));

-- ── Editores ─────────────────────────────────────────────────────────────────
create table if not exists bank_config_editors (
  email       text primary key,
  added_by    text,
  created_at  timestamptz not null default now()
);

-- ── Historial (append-only) ──────────────────────────────────────────────────
create table if not exists bank_config_history (
  id          uuid primary key default gen_random_uuid(),
  bank_slug   text,                         -- null para cambios globales (bloqueados, editores)
  table_name  text        not null,
  record_key  text,
  action      text        not null check (action in ('insert', 'update', 'delete')),
  before      jsonb,
  after       jsonb,
  actor       text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_bank_config_history_bank on bank_config_history (bank_slug, created_at desc);

-- ── updated_at automático ────────────────────────────────────────────────────
drop trigger if exists trg_bank_config_updated_at on bank_config;
create trigger trg_bank_config_updated_at before update on bank_config
  for each row execute function update_updated_at_column();
drop trigger if exists trg_bank_redflag_rules_updated_at on bank_redflag_rules;
create trigger trg_bank_redflag_rules_updated_at before update on bank_redflag_rules
  for each row execute function update_updated_at_column();
drop trigger if exists trg_bank_required_documents_updated_at on bank_required_documents;
create trigger trg_bank_required_documents_updated_at before update on bank_required_documents
  for each row execute function update_updated_at_column();
drop trigger if exists trg_bank_contacts_updated_at on bank_contacts;
create trigger trg_bank_contacts_updated_at before update on bank_contacts
  for each row execute function update_updated_at_column();

-- ── RLS: lectura para usuarios logueados, escritura solo service_role ────────
do $$
declare t text;
begin
  foreach t in array array['bank_config','bank_redflag_rules','bank_required_documents','bank_contacts',
                           'provinces','blocked_emails','bank_config_editors','bank_config_history']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_service_all', t);
    execute format('create policy %I on %I for all to service_role using (true) with check (true)', t || '_service_all', t);
  end loop;
end $$;
