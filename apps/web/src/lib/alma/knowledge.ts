/**
 * Base de conocimiento de Alma: cómo funcionan los procesos de envío a bancos y recepción de ofertas.
 * Es la ÚNICA fuente de "cómo funciona"; para datos de un cliente Alma debe usar las herramientas.
 * Mantener al día cuando cambie un proceso (cada sección es independiente: la herramienta
 * `conocimiento` devuelve solo la que se pide).
 */

export const KNOWLEDGE: Record<string, { titulo: string; texto: string }> = {
  envio_dossier: {
    titulo: 'Cómo sale un dossier al banco',
    texto: `
1. Recogida de documentos (Doc Collection): el cliente sube sus documentos y se guardan en su carpeta de Drive
   con códigos: C003 DNI 1T, C004 Vida laboral 1T, C005 Nóminas 1T, C006 Contrato 1T, C007 IRPF 1T, C008 Movimientos 1T,
   y D003…D008 lo mismo para el 2º titular.
2. Cuando el deal llega a la etapa "Doc Completed" (62) en Pipedrive, una automatización lanza el generador de dossier (n8n):
   une los documentos con PDF.co en un PDF (portada + documentos), lo comprime si pesa más de 12–15 MB y lo sube
   a la carpeta del cliente como "IMPORTE€MDxxxx.pdf". Avisa en Slack "Un nuevo Dossier … ha sido creado".
   Si el cliente tiene varios importes por banco se genera un dossier por importe.
3. En la hoja "[Bayteca] Dossier - Envío a Bancos" hay una pestaña por banco. Al poner Enviar=Yes en la fila del cliente,
   Apps Script llama al flujo "Send Dossier <banco>" de n8n.
4. El flujo comprueba: que existan el dossier y la autorización Bayteca (y la del banco si aplica) en Drive, el chequeo de
   red flags (IRPF, etc.), y la reserva anti-duplicado. Si todo está bien envía el correo desde hipotecas@bayteca.com con
   el dossier adjunto, marca la hoja "Enviado ✅", mueve el deal bancario a "Bank Submission" (70) y deja nota en Pipedrive.
5. Envíos por plataforma (Santander, CaixaBank, Sabadell, Bankinter, Abanca): no van por la hoja; se envían a mano desde la
   web del banco y se marcan como enviados en la página "Envíos por plataforma" del Command Center.
6. Kutxabank: se genera un ZIP cifrado con los documentos y se envía a Rastreator; se gestiona en "Kutxabank · Envíos".
7. Más de 3 bancos en un cliente YA NO bloquea el envío (desde el 30-sep-2026): solo deja una nota para revisarlo con el TL.`,
  },
  limites: {
    titulo: 'Límites técnicos que explican envíos fallidos',
    texto: `
- Gmail no permite adjuntos de más de 25 MB por correo. Un dossier más pesado NO puede salir por correo: hay que subir a la
  carpeta versiones más ligeras de los documentos pesados (escaneos de DNI, movimientos) y regenerar el dossier.
- PDF.co: la compresión acepta como máximo 100 MB y corta trabajos de más de ~3 minutos. Si falla, el dossier se guarda SIN
  comprimir (y puede superar los 25 MB de Gmail).
- Archivos de 0 bytes en la carpeta (subidas fallidas): el generador los ignora desde el 1-oct-2026; antes rompían el dossier.
- Nóminas y movimientos con contraseña: el generador prueba el DNI/NIE y variantes (minúsculas, sin letra, NIE sin letra
  inicial…). Si ninguna funciona, ese documento se EXCLUYE del dossier y se avisa; hay que añadirlo a mano o pedirlo sin clave.
- Google (Sheets/Drive) limita peticiones por minuto: los flujos reintentan solos 5 veces.
- Anti-duplicado: tras un envío, el mismo banco+cliente queda reservado 6 horas. Un segundo envío en ese plazo se bloquea
  (salvo que el primero falló antes de enviarse: pasados 15 min se permite reintentar). Pasadas 6 h se puede reenviar.`,
  },
  estados: {
    titulo: 'Qué significa cada estado de la hoja / Command Center',
    texto: `
Status (columna de la hoja) y estado normalizado del Command Center:
- "Enviado ✅" → sent: el correo salió al banco.
- pending_ready: tiene Enviar=Yes pero aún no consta enviado.
- blocked_red_flag: red flag detectada; necesita "Autorización Red Flag" o revisión.
- blocked_missing_docs: faltan documentos.
- blocked_validation: bloqueo de validación (p. ej. "N banks → blocked (>3)", aunque ya no bloquea el envío).
- failed: error ("Error envío ❌", "El correo no ha salido", "Error n8n …").
- offer_received / rejected / more_info_requested: respuesta del banco.
- unknown: sin estado reconocible.
Process Status (lo escribe Apps Script/n8n):
- "Enviando a n8n (ENVIAR|AUTORIZACION) - fecha": Apps Script llamó al flujo.
- "Enviado a n8n … HTTP 200": el flujo recibió la orden (no significa que el correo saliera).
- "Error n8n … HTTP 404 … not registered": el flujo de n8n está desactivado (problema TÉCNICO).
- "Bloqueado - <motivo>": Apps Script no lanzó el flujo (fila inválida, sin Opportunity, sin ITEM ID, sin Enviar/Autorización,
  ya tenía Timestamp, cooldown anti-duplicado…).
- "Esperando a la creación del dossier… 🏃": el flujo espera unos minutos a que exista el dossier.
- "Procesando": en curso. "Completado": terminó (mirar Status y NOTAS para saber el resultado).
NOTAS: "Falta <documentos>" (p. ej. "Falta Nuevo_Documento" en Ibercaja = documento de datos básicos),
"Ver notas" (mirar la nota del deal en Pipedrive), "Gmail no pudo enviar…" (error de Gmail).`,
  },
  problemas_frecuentes: {
    titulo: 'Problemas frecuentes y qué hacer',
    texto: `
- Dossier > 25 MB → no sale por Gmail. Subir documentos más ligeros y regenerar el dossier. (Operativo, no técnico.)
- Falta dossier en Drive → el generador no lo creó o falló (mirar eventos del flujo). Si falló por un error del flujo es técnico.
- Faltan documentos / autorización → pedirlos al cliente o subirlos a la carpeta con el código correcto. (Operativo.)
- Red flag → revisar con el TL y, si procede, poner "Autorización Red Flag". (Operativo.)
- Fila duplicada en la pestaña del banco (mismo cliente dos veces) o fila sin ITEM ID → la hoja no se marca aunque el correo
  salga. Borrar la duplicada y marcar la buena como Enviado. (Operativo.)
- No volver a crear/borrar filas para reintentar: cambia el ITEM ID y la hoja deja de actualizarse sola.
- "Error n8n HTTP 404 not registered" → flujo de n8n desactivado. (TÉCNICO: reportar a Juanjo.)
- Error de un paso de n8n, de Supabase, de Apps Script, sincronización rota o un proceso mal diseñado → TÉCNICO.
- Bloqueo anti-duplicado → esperar a que se libere (6 h desde el envío) o confirmar que ya salió. (Operativo.)
- Sin "Bank Mail / Email agente bancario" en el deal bancario → en Ibercaja se usa el código de oficina. (Operativo.)`,
  },
  ofertas: {
    titulo: 'Recepción de respuestas de los bancos',
    texto: `
- Cada 5 minutos el "repartidor" de n8n busca en hipotecas@bayteca.com correos nuevos de los 18 bancos y los pasa al flujo
  del banco, que los clasifica con IA (oferta / más info / rechazo), actualiza Pipedrive (etapa 71 con la oferta, lost en
  rechazos, nota en más info) y avisa al MC.
- Todo queda registrado en la página "Ofertas recibidas" del Command Center. Lo que no se pudo vincular a un deal
  (p. ej. asunto sin nº de expediente) aparece en «Requieren atención» para vincularlo a mano.
- Las respuestas de los bancos por plataforma (Santander, Sabadell…) llegan por sus propios flujos.`,
  },
  caixabank: {
    titulo: 'CaixaBank: envíos y respuestas',
    texto: `
- CaixaBank se envía por plataforma (página «Envíos por plataforma» del Command Center; se marca a mano como enviado).
- Las respuestas llegan en un Excel de CaixaBank que se sube en la página «Caixa» del Command Center. Cada fila es una
  petición (nº de petición = deal) con «Estado del lead» y «Motivo pendiente» / «Resolución».
- Estados del lead: 1 - SOLIC. INICIAL (recibida, aún sin estudio), 2 - SIA EN CURSO (en estudio; el «motivo pendiente»
  dice qué falta: OK del cliente, onboarding, firma SUA, llamada, informe, tasación, documentación, FEIN, CIRBE, provisión
  de fondos, aprobación CARP…), 3 - EN FIRMA (aprobada, camino de la firma), 4 - FORMALIZADA (firmada 🎉),
  5 - CERRADA (no sigue; la «resolución» explica por qué: Competencia, cliente no localizado, registrado por otra
  plataforma, ya tiene una simulación en CaixaBank, sin vivienda, DTI excedido, plazo fuera de límites, edad…).
- Al procesar el Excel: se añade una nota en Pipedrive con el estado y, si está CERRADA con motivo de pérdida, el deal
  bancario se marca perdido con el motivo equivalente. Si el estado no cambia, no se repite la nota.
- «Peticiones registradas» (Caixa → Requests) = relación nº de oportunidad de CaixaBank ↔ deal de Bayteca, con nota en Pipedrive.`,
  },
  kutxabank: {
    titulo: 'Kutxabank vía Rastreator',
    texto: `
- Kutxabank no se envía por correo al banco: se crea un ZIP cifrado con la documentación y se manda a Rastreator, que lo
  estudia y lo pasa a Kutxabank. Página «Kutxabank» del Command Center (envíos, documentos que faltan, estados).
- Antes de enviar se comprueban los documentos («Verificar documentos»); si faltan, el envío queda pendiente de documentos.
- Rastreator responde por un Excel de estados con comentarios: «Pendiente de envío a Kutxabank», «Enviado a Kutxabank»,
  «Denegada LTV», «Denegada endeudamiento», «Denegada perfil», «Oferta recibida». Cada estado nuevo se apunta en Pipedrive
  y puede mover la etapa del deal.`,
  },
  plataforma: {
    titulo: 'Envíos por plataforma (Santander, Sabadell, Bankinter, Abanca, CaixaBank)',
    texto: `
- Estos bancos no reciben el dossier por correo automático: el equipo lo sube a la plataforma del banco a mano.
- Cuando un deal tiene uno de estos bancos en sus Bank 1–5 de Pipedrive y está en la etapa adecuada, aparece en
  «Envíos por plataforma». Al subirlo, se pulsa «Marcar enviado» (o «Descartar» si no procede); se pueden añadir notas.
- Que aparezca ahí pendiente es normal hasta que alguien lo sube: no es un fallo técnico.`,
  },
  command_center: {
    titulo: 'Páginas del Command Center',
    texto: `
- Inicio (dashboard): envíos pendientes y enviados por banco, con buscador por nombre o nº de deal.
- Bancos/<banco>: detalle de un banco (filas, estados, red flags).
- Ofertas recibidas: respuestas de bancos y cola «Requieren atención».
- Envíos por plataforma: deals a enviar a mano a Santander, CaixaBank, Sabadell, Bankinter y Abanca; botón para marcarlos enviados.
- Nuevo envío, Métricas, Caixa (respuestas y peticiones), Kutxabank (envíos y estados, botón "Verificar documentos").
- Request Hub (otra app): tickets de incidencias por deal (BAN-AAAA-NNNN), estados new / in_progress / waiting_on_employee /
  resolved / closed.`,
  },
  alma: {
    titulo: 'Qué puede y qué no puede hacer Alma',
    texto: `
- Puede: buscar clientes, explicar por qué un envío no salió, mostrar documentos de la carpeta, tickets de Request Hub,
  respuestas de bancos y métricas.
- No puede: cambiar datos, reenviar dossieres, mover deals, editar la hoja ni modificar procesos.
- Si el problema es técnico (n8n, Supabase, Apps Script, sincronización, diseño del proceso) puede ofrecer "Enviar reporte a
  Juanjo"; si es operativo explica qué hacer al equipo.`,
  },
}

export const KNOWLEDGE_TOPICS = Object.keys(KNOWLEDGE)
