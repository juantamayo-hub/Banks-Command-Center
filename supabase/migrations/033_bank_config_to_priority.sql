-- 033: Prioridad del destinatario por banco — nuevo valor 'contacts_then_deal_field'
-- (correos configurados por provincia / por defecto; si no hay, el "Email bancario" del deal de Pipedrive).
-- No cambia ningún banco: cada uno conserva el to_source que reproduce su flujo actual.

alter table bank_config drop constraint if exists bank_config_to_source_check;
alter table bank_config add constraint bank_config_to_source_check
  check (to_source in ('contacts', 'deal_field', 'deal_field_then_contacts', 'contacts_then_deal_field', 'contacts_cc_deal_field'));
