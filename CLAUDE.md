# Migración Bancos - Ofertas Recibidas

## Contexto del proyecto

Este proyecto crea una plataforma interna para controlar los envíos bancarios y las ofertas recibidas.

El proceso actual vive principalmente en:

- Google Sheets
- Apps Script
- n8n / webhooks
- Pipedrive
- Gmail
- Archivos/documentos del dossier

Actualmente existe un Google Sheet con pestañas por banco. Cada fila representa un envío, solicitud o seguimiento asociado a un banco.

El objetivo es tener una plataforma web donde podamos ver en tiempo real:

1. Qué envíos están pendientes.
2. Qué envíos no salieron.
3. Qué envíos están bloqueados por red flags.
4. Qué envíos están bloqueados por documentos faltantes.
5. Qué envíos ya salieron.
6. Qué envíos fallaron.
7. Qué ofertas o respuestas se han recibido.
8. Qué red flags son más comunes por banco.
9. Qué bancos generan más bloqueos.
10. Qué filas se pueden relanzar de forma segura.

## Proceso actual

Cada banco puede tener una pestañ

Cada pestaña puede tener columnas como:

- Enviar
- UID
- Timestamp sent
- Status
- Deal ID
- Cliente
- Banco
- Red flags
- Documentos faltantes
- Archivos faltantes
- Resultado del envío
- Motivo de bloqueo
- Motivo de denegación
- Oferta recibida
- Fecha de respuesta

Apps Script controla parte del flujo.

En muchos casos, cuando una fila se edita:

1. Se genera un UID si no existe.
2. Se revisa si la fila tiene Enviar = Yes.
3. Se revisan red flags.
4. Se revisan documentos faltantes.
5. Se evita duplicar envíos.
6. Se marca Timestamp sent.
7. Se marca Status.
8. Se envía información a n8n o webhook.
9. n8n puede continuar el proceso hacia banco, Gmail, Pipedrive u otros sistemas.

## Reglas críticas

1. Nunca duplicar envíos al banco.
2. Nunca relanzar una fila ya enviada salvo que exista confirmación explícita con force=true.
3. Nunca eliminar lógica bancaria existente sin entenderla.
4. Google Sheets sigue siendo la fuente operativa inicial.
5. Supabase será la base espejo para la plataft.js será la plataforma visual.
7. Apps Script será el puente entre Sheets y Supabase.
8. Todo relanzamiento debe quedar registrado.
9. Todo bloqueo debe tener una razón clara.
10. Los secretos no pueden exponerse en frontend.
11. Supabase service_role nunca puede usarse en navegador.

## Estados normalizados

Usar estos estados:

- pending_ready
- blocked_red_flag
- blocked_missing_docs
- blocked_validation
- sent
- sending
- failed
- relaunch_requested
- offer_received
- rejected
- more_info_requested
- unknown

## Arquitectura deseada

- apps/web: Next.js + Tailwind + Supabase.
- apps/appscript: Google Apps Script clonado con clasp.
- supabase/migrations: migraciones SQL.
- packages/shared: tipos y lógica compartida.
- data: Excel exportado del Google Sheet actual.
- .claude/agents: agentes especializados para Claude Code.

## MVP

Primero construir:

1. Dashboard general.
2. Tabla de envíos pendientes.
3. Tabla de envíos bloqueados.
4. Tabla de enviados.
5. Tabla de fallidos.
6. Vista por banco.
7n de relanzar con protección anti-duplicados.
8. Métricas por banco.
9. Métricas de red flags.
10. Clustering básico de red flags similares.

## Orden de trabajo

1. Auditar Excel actual.
2. Auditar Apps Script actual.
3. Identificar bancos y columnas.
4. Identificar lógica anti-duplicados.
5. Diseñar schema Supabase.
6. Crear sincronización Apps Script a Supabase.
7. Crear dashboard Next.js.
8. Crear relanzamiento seguro.
9. Crear métricas.
10. Crear clustering.
11. QA de duplicados y seguridad.
