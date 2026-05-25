/**
 * relaunchWebApp.js
 * Apps Script Web App — Dispatcher de Relanzamiento desde Plataforma
 *
 * DEPLOY:
 *   Ejecutar → Implementar → Nueva implementación
 *   Tipo: Aplicación web
 *   Ejecutar como: Yo (la cuenta con acceso al Sheet)
 *   Quién tiene acceso: Cualquiera
 *
 * SEGURIDAD:
 *   El acceso está protegido por APPS_SCRIPT_RELAUNCH_SECRET en Script Properties.
 *   Configúralo ejecutando setRelaunchSecret() manualmente una vez.
 *
 * FLUJO:
 *   Dashboard → Server Action → requestRelaunch() → Supabase (DB state = relaunch_requested)
 *                                                  → Apps Script doPost (activa envío a n8n)
 *                                                  → postToN8N{BANCO}() → n8n → Banco
 *
 * LIMITACIONES:
 *   - cr_extremadura: sin script de dispatch → no soportado desde plataforma
 *   - Rows con Status "Enviado ✅" en Sheet: Apps Script no las reenviará aunque force=true
 *     (requiere limpiar manualmente la columna K primero)
 */

// ── Bancos sin dispatch desde plataforma (has_dispatch = false en Supabase) ──
var NO_DISPATCH_SLUGS = ['santander', 'bankinter', 'sabadell', 'banca_360', 'kutxabank'];

// ── Mapa slug → { sheetName, fn } ────────────────────────────────────────────
// Todas las llamadas usan mode:'manual' para bypasear el check de Timestamp.
// mode:'manual' sí respeta el check de "Enviado ✅" (protección anti-reenvío).
var DISPATCH_MAP = {
  'unicaja':       { sheetName: 'Unicaja Test',              fn: function(s,r){ return postToN8NUNICAJA(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'laboral_kutxa': { sheetName: 'Laboral Kutxa Test',        fn: function(s,r){ return postToN8NLABORALK(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'uci':           { sheetName: 'UCI',                       fn: function(s,r){ return postToN8NUCI(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'myinvestor':    { sheetName: 'MyInvestor Test',           fn: function(s,r){ return postToN8NMYINVESTOR(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'cr_del_sur':    { sheetName: 'CR del Sur Test',           fn: function(s,r){ return postToN8NCRDELSUR(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'cr_teruel':     { sheetName: 'CR Teruel Test',            fn: function(s,r){ return postToN8NTERUEL(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'cr_granada':    { sheetName: 'CR Granada Test',           fn: function(s,r){ return postToN8NCRGRANADA(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'eurocajarural': { sheetName: 'EuroCajaRural Test',        fn: function(s,r){ return postToN8NEUROCAJARURAL(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'globalcaja':    { sheetName: 'Globalcaja Test',           fn: function(s,r){ return postToN8NGLOBALCAJA(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'ing':           { sheetName: 'ING',                       fn: function(s,r){ return postToN8NING(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'no_bank_fee':   { sheetName: 'No Bank Fee Test',          fn: function(s,r){ return postToN8NNOBANKFEE(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'cr_asturias':   { sheetName: 'CR Asturias Test',          fn: function(s,r){ return postToN8NCRASTURIAS(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'ibercaja':      { sheetName: 'Ibercaja Test',             fn: function(s,r){ return postToN8NIbercaja(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'deutsche_bank': { sheetName: 'Deutsche Bank Test',        fn: function(s,r){ return postToN8NDEUTSCHE(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'cajamar':       { sheetName: 'Cajamar Test',              fn: function(s,r){ return postToN8NCAJAMAR(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'caixa_popular': { sheetName: 'Caixa Popular Test',        fn: function(s,r){ return postToN8NCAIXAPOPULAR(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'cr_aragon':     { sheetName: 'CR Aragon Test',            fn: function(s,r){ return postToN8NCRARAGON(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } },
  'ruralnostra':   { sheetName: 'RURALNOSTRA',               fn: function(s,r){ return postToN8NRuralnostra(s, r, { mode:'manual', preferredAction:'ENVIAR' }); } }
  // cr_extremadura: sin ROW_ID script — no soportado desde plataforma
};

// ── doPost ────────────────────────────────────────────────────────────────────
/**
 * Recibe: POST JSON { secret, bank_slug, row_number }
 * Devuelve: JSON { ok: true } | { ok: false, error: '...' }
 */
function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var body = JSON.parse(e.postData.contents);

    // ── Validar secret ──────────────────────────────────────────────────────
    var secret = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_RELAUNCH_SECRET');
    if (!secret || body.secret !== secret) {
      Logger.log('[relaunchWebApp] Unauthorized attempt');
      output.setContent(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return output;
    }

    // ── Validar parámetros ──────────────────────────────────────────────────
    var bankSlug   = String(body.bank_slug || '').trim();
    var rowNumber  = parseInt(body.row_number, 10);

    if (!bankSlug || isNaN(rowNumber) || rowNumber < 2) {
      output.setContent(JSON.stringify({ ok: false, error: 'Parámetros inválidos' }));
      return output;
    }

    // ── Bloquear bancos sin dispatch desde plataforma ───────────────────────
    if (NO_DISPATCH_SLUGS.indexOf(bankSlug) !== -1) {
      output.setContent(JSON.stringify({ ok: false, error: 'Banco sin dispatch desde plataforma: ' + bankSlug }));
      return output;
    }

    // ── Buscar configuración ────────────────────────────────────────────────
    var config = DISPATCH_MAP[bankSlug];
    if (!config) {
      output.setContent(JSON.stringify({ ok: false, error: 'Banco no soportado: ' + bankSlug }));
      return output;
    }

    // ── Obtener hoja ────────────────────────────────────────────────────────
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName);
    if (!sheet) {
      output.setContent(JSON.stringify({ ok: false, error: 'Hoja no encontrada: ' + config.sheetName }));
      return output;
    }

    // ── Disparar postToN8N del banco ────────────────────────────────────────
    var result = config.fn(sheet, rowNumber);

    Logger.log('[relaunchWebApp] bank=' + bankSlug + ' row=' + rowNumber + ' ok=' + result);
    output.setContent(JSON.stringify({ ok: result === true }));
    return output;

  } catch (err) {
    Logger.log('[relaunchWebApp] Error: ' + err);
    output.setContent(JSON.stringify({ ok: false, error: String(err) }));
    return output;
  }
}

// ── Configurar secret ────────────────────────────────────────────────────────
/**
 * Ejecuta esta función UNA VEZ para guardar el secret en Script Properties.
 * Pon el mismo valor en APPS_SCRIPT_RELAUNCH_SECRET en tu .env.local de Next.js.
 */
function setRelaunchSecret() {
  var secret = 'CAMBIA_ESTO_POR_UN_SECRET_ALEATORIO_LARGO';
  PropertiesService.getScriptProperties().setProperty('APPS_SCRIPT_RELAUNCH_SECRET', secret);
  Logger.log('Secret guardado: ' + secret);
}

// ── Test manual ───────────────────────────────────────────────────────────────
/**
 * Para probar desde el editor: testRelaunchRow('unicaja', 5)
 */
function testRelaunchRow(bankSlug, rowNumber) {
  var config = DISPATCH_MAP[bankSlug];
  if (!config) { Logger.log('Banco no encontrado: ' + bankSlug); return; }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName);
  if (!sheet) { Logger.log('Hoja no encontrada: ' + config.sheetName); return; }

  Logger.log('Relanzando ' + bankSlug + ' fila ' + rowNumber);
  var result = config.fn(sheet, rowNumber);
  Logger.log('Resultado: ' + result);
}
