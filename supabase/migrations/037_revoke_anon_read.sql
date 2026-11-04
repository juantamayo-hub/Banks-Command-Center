-- 037: la clave anónima (pública, va en el navegador) deja de poder leer datos de clientes y envíos.
--
-- Auditoría de seguridad (SEC-001): con la anon key se podía hacer GET /rest/v1/sheet_rows y, desde la 035, recibir
-- en tiempo real cada cambio (nombre del cliente, importe, enlace al dossier, notas…). La web usa SIEMPRE la sesión
-- del usuario (authenticated); Apps Script y el servidor usan service_role. Comprobado en los logs de 24 h (03-nov):
-- ninguna lectura REST de estas tablas con rol anon.
--
-- No se toca: banks (solo nombres de bancos), ni permisos de EJECUCIÓN de funciones (processa_copia_envios se llama
-- con anon pero es SECURITY DEFINER con token propio).

-- Políticas solo para anon → fuera (cada tabla ya tiene su política *_select_authenticated)
drop policy if exists sheet_rows_select_anon        on sheet_rows;
drop policy if exists dispatch_attempts_select_anon on dispatch_attempts;
drop policy if exists red_flag_events_select_anon   on red_flag_events;
drop policy if exists event_log_select_anon         on event_log;
drop policy if exists anon_select                   on platform_dispatches;

-- Políticas compartidas anon + authenticated → solo authenticated
alter policy anon_select_notes             on submission_notes            to authenticated;
alter policy anon_select                   on platform_dispatch_notes     to authenticated;
alter policy anon_select                   on kutxabank_submission_notes  to authenticated;
alter policy kutxabank_anon_select         on kutxabank_submissions       to authenticated;
alter policy kutxabank_estados_anon_select on kutxabank_estados_processed to authenticated;
