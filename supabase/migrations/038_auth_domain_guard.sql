-- 038: seguridad (auditoría 03-nov)
--
-- SEC-002: la restricción @huspy.io / @bayteca.com solo estaba en la web (middleware). Con cualquier cuenta de Google
-- se podía completar el OAuth contra Supabase y leer por la API lo que tiene "to authenticated". Ahora la propia base
-- rechaza crear (o cambiar a) un usuario de otro dominio. Usuarios actuales: todos @bayteca.com / @huspy.io.
--
-- SEC-008: claim_dispatch con search_path vacío y nombres cualificados.

create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or lower(split_part(new.email, '@', 2)) not in ('huspy.io', 'bayteca.com') then
    raise exception 'Solo se permiten cuentas @huspy.io o @bayteca.com';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_allowed_email_domain() from public, anon, authenticated;

drop trigger if exists trg_enforce_allowed_email_domain on auth.users;
create trigger trg_enforce_allowed_email_domain
  before insert or update of email on auth.users
  for each row execute function public.enforce_allowed_email_domain();

create or replace function public.claim_dispatch(
  p_row_id uuid,
  p_action text default 'ENVIAR',
  p_force  boolean default false,
  p_actor  text default 'system',
  p_source text default 'auto'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.sheet_rows%rowtype;
begin
  select * into r from public.sheet_rows where id = p_row_id for update;
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

  update public.sheet_rows set
    status          = 'sending',
    status_raw      = null,
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

  insert into public.dispatch_attempts (sheet_row_id, bank_id, opportunity_id, uid, triggered_by, status, force_flag)
  values (r.id, r.bank_id, r.opportunity_id, r.uid, p_actor, 'claimed', p_force);

  insert into public.event_log (event_type, sheet_row_id, bank_id, opportunity_id, actor, payload)
  values ('dispatch', r.id, r.bank_id, r.opportunity_id, p_actor,
          jsonb_build_object('action', p_action, 'force', p_force, 'source', p_source, 'previous_status', r.status));

  return jsonb_build_object('ok', true, 'previous_status', r.status, 'attempt', r.attempts + 1);
end;
$$;

revoke all on function public.claim_dispatch(uuid, text, boolean, text, text) from public, anon, authenticated;
