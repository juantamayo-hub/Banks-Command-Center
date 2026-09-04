/**
 * relaunchWebApp.js
 * Apps Script Web App — Dispatcher de Relanzamiento desde Plataforma
 * Pushed: 2026-07-06
 *
 * DEPLOY:
 *   Ejecutar → Implementar → Nueva implementación
 *   Tipo: Aplicación web
 *   Ejecutar como: Yo (la cuenta con acceso al Sheet)
 *   Quién tiene acceso: Cualquiera
 *
 * SEGURIDAD:
 *   Acceso protegido por APPS_SCRIPT_RELAUNCH_SECRET en Script Properties.
 *   Configura ejecutando setRelaunchSecret() manualmente una vez.
 *
 * ACCIONES:
 *   action = 'ENVIAR'       → reintenta el flujo normal (Enviar=Yes ya está)
 *   action = 'AUTORIZACION' → escribe 'Yes' en col H (Autorización) del Sheet
 *                             antes de enviar → n8n bypasea red flags / docs faltantes
 *
 * FLUJO COMPLETO:
 *   Dashboard → requestRelaunch() → Supabase (relaunch_requested)
 *                                 → doPost (this) → escribe col H si AUTORIZACION
 *                                 → postToN8N{BANCO}(mode:'manual')
 *                                 → n8n → banco
 *
 * LIMITACIONES:
 *   - cr_extremadura: sin ROW_ID script → no soportado desde plataforma
 *   - Rows con K='Enviado ✅': postToN8N no reenviará (requiere limpiar K manualmente)
 */

// ── Bancos sin dispatch desde plataforma (has_dispatch = false en Supabase) ──
var NO_DISPATCH_SLUGS = ['santander', 'bankinter', 'sabadell', 'banca_360', 'kutxabank'];

// Columna H en todos los bancos = Autorización (número 8)
var COL_AUTORIZACION = 8;

// ── Mapa slug → sheetName para APPEND_ROW (todos los bancos) ─────────────────
var APPEND_SHEET_NAMES = {
  'unicaja':        'Unicaja Test',
  'santander':      'Santander',
  'laboral_kutxa':  'Laboral Kutxa Test',
  'kutxabank':      'Kutxabank',
  'uci':            'UCI',
  'myinvestor':     'MyInvestor Test',
  'cr_del_sur':     'CR del Sur Test',
  'cr_teruel':      'CR Teruel Test',
  'cr_granada':     'CR Granada Test',
  'eurocajarural':  'EuroCajaRural Test',
  'globalcaja':     'Globalcaja Test',
  'cr_extremadura': 'CR Extremadura',
  'sabadell':       'Sabadell no residentes',
  'banca_360':      'MSF 360 - Sabadell Residentes',
  'ing':            'ING',
  'bankinter':      'Bankinter',
  'no_bank_fee':    'No Bank Fee Test',
  'cr_asturias':    'CR Asturias Test',
  'ibercaja':       'Ibercaja Test',
  'deutsche_bank':  'Deutsche Bank Test',
  'cajamar':        'Cajamar Test',
  'caixa_popular':  'Caixa Popular Test',
  'cr_aragon':      'CR Aragon Test',
  'ruralnostra':    'RURALNOSTRA',
  'abanca':         'Abanca',
  'pichincha':      'Pichincha'
};

// ── Mapa slug → { sheetName, fn(sheet, row, action) } ────────────────────────
var DISPATCH_MAP = {
  'unicaja':       { sheetName: 'Unicaja Test',
                     fn: function(s,r,a){ return postToN8NUNICAJA(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'laboral_kutxa': { sheetName: 'Laboral Kutxa Test',
                     fn: function(s,r,a){ return postToN8NLABORALK(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'uci':           { sheetName: 'UCI',
                     fn: function(s,r,a){ return postToN8NUCI(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'myinvestor':    { sheetName: 'MyInvestor Test',
                     fn: function(s,r,a){ return postToN8NMYINVESTOR(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'cr_del_sur':    { sheetName: 'CR del Sur Test',
                     fn: function(s,r,a){ return postToN8NCRDELSUR(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'cr_teruel':     { sheetName: 'CR Teruel Test',
                     fn: function(s,r,a){ return postToN8NTERUEL(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'cr_granada':    { sheetName: 'CR Granada Test',
                     fn: function(s,r,a){ return postToN8NCRGRANADA(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'eurocajarural': { sheetName: 'EuroCajaRural Test',
                     fn: function(s,r,a){ return postToN8NEUROCAJARURAL(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'globalcaja':    { sheetName: 'Globalcaja Test',
                     fn: function(s,r,a){ return postToN8NGLOBALCAJA(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'ing':           { sheetName: 'ING',
                     fn: function(s,r,a){ return postToN8NING(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'no_bank_fee':   { sheetName: 'No Bank Fee Test',
                     fn: function(s,r,a){ return postToN8NNOBANKFEE(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'cr_asturias':   { sheetName: 'CR Asturias Test',
                     fn: function(s,r,a){ return postToN8NCRASTURIAS(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'ibercaja':      { sheetName: 'Ibercaja Test',
                     fn: function(s,r,a){ return postToN8NIbercaja(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'deutsche_bank': { sheetName: 'Deutsche Bank Test',
                     fn: function(s,r,a){ return postToN8NDEUTSCHE(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'cajamar':       { sheetName: 'Cajamar Test',
                     fn: function(s,r,a){ return postToN8NCAJAMAR(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'caixa_popular': { sheetName: 'Caixa Popular Test',
                     fn: function(s,r,a){ return postToN8NCAIXAPOPULAR(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'cr_aragon':     { sheetName: 'CR Aragon Test',
                     fn: function(s,r,a){ return postToN8NCRARAGON(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'ruralnostra':   { sheetName: 'RURALNOSTRA',
                     fn: function(s,r,a){ return postToN8NRuralnostra(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } },
  'pichincha':     { sheetName: 'Pichincha',
                     fn: function(s,r,a){ return postToN8NPICHINCHA(s, r, { mode:'manual', preferredAction:a, source:'platform' }); } }
  // cr_extremadura: sin ROW_ID script — no soportado
};

// ── doPost ────────────────────────────────────────────────────────────────────
/**
 * Recibe: POST JSON { secret, bank_slug, row_number, action }
 *   action: 'ENVIAR' | 'AUTORIZACION'
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
    var bankSlug  = String(body.bank_slug || '').trim();
    var action    = String(body.action || 'ENVIAR').toUpperCase().trim();

    if (!bankSlug) {
      output.setContent(JSON.stringify({ ok: false, error: 'bank_slug requerido' }));
      return output;
    }

    // ── KUTXA_SYNC_ENVIOS: sincroniza filas aprobadas al Sheet de Kutxabank ──
    if (action === 'KUTXA_SYNC_ENVIOS') {
      // rows: [{ deal_id, dni, respuesta }]
      // respuesta: 'Enviar' → append to Ops. Enviadas + mark col I as 'Enviado'
      // respuesta: 'No enviar' → only mark col I as 'No enviar' (no append)
      var rows = body.rows || [];
      if (!rows.length) {
        output.setContent(JSON.stringify({ ok: true, synced: 0, skipped: 0 }));
        return output;
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var opsSheet    = ss.getSheetByName('Ops. Enviadas');
      var filtroSheet = ss.getSheetByName('1 Filtro');

      // Build set of deal_ids already in "Ops. Enviadas" (col A) for dedup
      var existingOpsIds = {};
      if (opsSheet && opsSheet.getLastRow() > 1) {
        var opsColA = opsSheet.getRange(2, 1, opsSheet.getLastRow() - 1, 1).getValues();
        for (var e = 0; e < opsColA.length; e++) {
          var eid = String(opsColA[e][0]).trim();
          if (eid) existingOpsIds[eid] = true;
        }
      }

      // Read 1 Filtro once (col A = ID, col I = Respuesta Rastreator)
      var filtroData = filtroSheet ? filtroSheet.getDataRange().getValues() : [];

      var synced = 0, skipped = 0;
      for (var i = 0; i < rows.length; i++) {
        var rowData   = rows[i];
        var dealId    = String(rowData.deal_id || '').trim();
        var dni       = String(rowData.dni || '').trim();
        var respuesta = String(rowData.respuesta || 'Enviar').trim();

        if (!dealId) continue;

        if (respuesta === 'Enviar') {
          // Dedup: skip if already in Ops. Enviadas
          if (existingOpsIds[dealId]) {
            Logger.log('[KUTXA_SYNC_ENVIOS] SKIP duplicate Ops. Enviadas dealId=' + dealId);
            skipped++;
          } else if (opsSheet) {
            var newRow = opsSheet.getLastRow() + 1;
            opsSheet.getRange(newRow, 1).setValue(dealId);
            opsSheet.getRange(newRow, 2).setValue(dni);
            existingOpsIds[dealId] = true; // prevent re-add within same batch
            Logger.log('[KUTXA_SYNC_ENVIOS] Appended Ops. Enviadas row=' + newRow + ' dealId=' + dealId);
          }
        }

        // Mark col I (Respuesta Rastreator) in 1 Filtro for both Enviar and No enviar
        if (filtroSheet) {
          var label = (respuesta === 'Enviar') ? 'Enviado' : 'No enviar';
          for (var r = 1; r < filtroData.length; r++) {
            if (String(filtroData[r][0]).trim() === dealId) {
              filtroSheet.getRange(r + 1, 9).setValue(label);
              Logger.log('[KUTXA_SYNC_ENVIOS] Marked 1 Filtro row=' + (r + 1) + ' dealId=' + dealId + ' label=' + label);
              break;
            }
          }
        }
        synced++;
      }

      SpreadsheetApp.flush();
      output.setContent(JSON.stringify({ ok: true, synced: synced, skipped: skipped }));
      return output;
    }

    // ── APPEND_ROW: escribe una nueva fila en la hoja del banco ────────────
    if (action === 'APPEND_ROW') {
      var sheetName = APPEND_SHEET_NAMES[bankSlug];
      if (!sheetName) {
        output.setContent(JSON.stringify({ ok: false, error: 'Banco no soportado para APPEND_ROW: ' + bankSlug }));
        return output;
      }
      var appendSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
      if (!appendSheet) {
        output.setContent(JSON.stringify({ ok: false, error: 'Hoja no encontrada: ' + sheetName }));
        return output;
      }
      var rowData  = body.row_data || {};
      var newRow   = appendSheet.getLastRow() + 1;
      var uid      = Utilities.getUuid();
      var now      = new Date();
      var testTime = now.getDate() + '/' +
                     String(now.getMonth() + 1).padStart(2, '0') + '/' +
                     now.getFullYear();                                            // d/MM/yyyy
      appendSheet.getRange(newRow, 1).setValue(rowData.opportunity_id   || '');  // A: Opportunity ID
      appendSheet.getRange(newRow, 2).setValue(rowData.nombre_cliente    || '');  // B: Nombre Cliente
      appendSheet.getRange(newRow, 3).setValue(rowData.importe           || '');  // C: Importe
      appendSheet.getRange(newRow, 6).setValue(rowData.bank_deal_id      || '');  // F: Bank Deal ID
      appendSheet.getRange(newRow, 7).setValue('Yes');                            // G: Autorizar envío
      appendSheet.getRange(newRow, 18).setValue(uid);                             // R: Item ID (UID)
      appendSheet.getRange(newRow, 19).setValue(testTime);                        // S: Test Time
      appendSheet.getRange(newRow, 22).setValue('Sí');                            // V: Plataforma
      SpreadsheetApp.flush();
      Logger.log('[relaunchWebApp] APPEND_ROW bank=' + bankSlug + ' sheet=' + sheetName + ' row=' + newRow);

      // Disparar postToN8N directamente si el banco tiene dispatch configurado.
      // onEdit NO se dispara para ediciones programáticas, por lo que llamamos
      // la función de envío explícitamente aquí.
      //
      // Excepción: ibercaja usa delay de 1 minuto vía time trigger para dar
      // tiempo a que la fila quede visible antes del dispatch.
      var dispatchConfig = DISPATCH_MAP[bankSlug];
      var dispatched = false;
      if (dispatchConfig) {
        if (bankSlug === 'ibercaja') {
          // Guardar fila pendiente y programar dispatch con delay de 1 min
          var props = PropertiesService.getScriptProperties();
          var pendingRaw = props.getProperty('IBERCAJA_DELAYED_ROWS') || '[]';
          var pendingRows = JSON.parse(pendingRaw);
          pendingRows.push(newRow);
          props.setProperty('IBERCAJA_DELAYED_ROWS', JSON.stringify(pendingRows));
          ScriptApp.newTrigger('dispatchIbercajaDelayed_')
            .timeBased()
            .after(60 * 1000)
            .create();
          Logger.log('[relaunchWebApp] APPEND_ROW ibercaja row=' + newRow + ' scheduled for delayed dispatch');
          output.setContent(JSON.stringify({ ok: true, row: newRow, dispatched: false, scheduled: true }));
          return output;
        }
        try {
          var dispatchResult = dispatchConfig.fn(appendSheet, newRow, 'ENVIAR');
          dispatched = (dispatchResult === true);
          Logger.log('[relaunchWebApp] APPEND_ROW dispatch bank=' + bankSlug + ' row=' + newRow + ' ok=' + dispatched);
        } catch (dispatchErr) {
          Logger.log('[relaunchWebApp] APPEND_ROW dispatch error: ' + dispatchErr);
        }
      }

      output.setContent(JSON.stringify({ ok: true, row: newRow, dispatched: dispatched }));
      return output;
    }

    // ── ENVIAR / AUTORIZACION: dispatch via postToN8N ──────────────────────
    var rowNumber = parseInt(body.row_number, 10);

    if (isNaN(rowNumber) || rowNumber < 2) {
      output.setContent(JSON.stringify({ ok: false, error: 'row_number inválido' }));
      return output;
    }

    if (action !== 'ENVIAR' && action !== 'AUTORIZACION') {
      output.setContent(JSON.stringify({ ok: false, error: 'Acción inválida: ' + action }));
      return output;
    }

    // ── Bloquear bancos sin dispatch desde plataforma ───────────────────────
    if (NO_DISPATCH_SLUGS.indexOf(bankSlug) !== -1) {
      output.setContent(JSON.stringify({ ok: false, error: 'Banco sin dispatch desde plataforma: ' + bankSlug }));
      return output;
    }

    // ── Buscar configuración del banco ──────────────────────────────────────
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

    // ── Si AUTORIZACION: escribir 'Yes' en columna H antes de enviar ────────
    if (action === 'AUTORIZACION') {
      sheet.getRange(rowNumber, COL_AUTORIZACION).setValue('Yes');
      SpreadsheetApp.flush();
      Logger.log('[relaunchWebApp] Set Autorización=Yes bank=' + bankSlug + ' row=' + rowNumber);
    }

    // ── Marcar columna V (Plataforma) = 'Sí' — indica envío desde plataforma web ──
    sheet.getRange(rowNumber, 22).setValue('Sí');
    SpreadsheetApp.flush();

    // ── Disparar postToN8N del banco ────────────────────────────────────────
    var result = config.fn(sheet, rowNumber, action);

    Logger.log('[relaunchWebApp] bank=' + bankSlug + ' row=' + rowNumber + ' action=' + action + ' ok=' + result);
    output.setContent(JSON.stringify({ ok: result === true }));
    return output;

  } catch (err) {
    Logger.log('[relaunchWebApp] Error: ' + err);
    output.setContent(JSON.stringify({ ok: false, error: String(err) }));
    return output;
  }
}

// ── Dispatch diferido Ibercaja ────────────────────────────────────────────────
/**
 * Ejecutada por un time-based trigger ~1 minuto después de APPEND_ROW ibercaja.
 * Lee las filas pendientes de Script Properties y llama postToN8NIbercaja.
 * Limpia el trigger al finalizar.
 */
function dispatchIbercajaDelayed_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('[dispatchIbercajaDelayed_] No se pudo obtener lock — otra ejecución en curso');
    return;
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var pendingRaw = props.getProperty('IBERCAJA_DELAYED_ROWS') || '[]';
    var pendingRows = JSON.parse(pendingRaw);

    if (!pendingRows.length) {
      Logger.log('[dispatchIbercajaDelayed_] Sin filas pendientes');
      return;
    }

    // Limpiar antes de procesar para evitar re-procesado si falla a mitad
    props.deleteProperty('IBERCAJA_DELAYED_ROWS');
    lock.releaseLock();

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(APPEND_SHEET_NAMES['ibercaja']);
    if (!sheet) {
      Logger.log('[dispatchIbercajaDelayed_] Hoja ibercaja no encontrada');
      return;
    }

    pendingRows.forEach(function(rowNum) {
      try {
        Logger.log('[dispatchIbercajaDelayed_] Dispatching ibercaja row=' + rowNum);
        postToN8NIbercaja(sheet, rowNum, { mode: 'manual', preferredAction: 'ENVIAR', source: 'platform' });
      } catch (err) {
        Logger.log('[dispatchIbercajaDelayed_] Error row=' + rowNum + ': ' + err);
      }
    });

  } finally {
    if (lock.hasLock()) lock.releaseLock();
    // Eliminar todos los triggers completados de esta función
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'dispatchIbercajaDelayed_') {
        ScriptApp.deleteTrigger(t);
      }
    });
  }
}

// ── Utilidades de configuración ───────────────────────────────────────────────

/**
 * Ejecuta UNA VEZ para guardar el secret en Script Properties.
 * Pon el mismo valor en APPS_SCRIPT_RELAUNCH_SECRET en .env.local / Vercel.
 */
function setRelaunchSecret() {
  var secret = 'CAMBIA_ESTO_POR_UN_SECRET_ALEATORIO_LARGO';
  PropertiesService.getScriptProperties().setProperty('APPS_SCRIPT_RELAUNCH_SECRET', secret);
  Logger.log('Secret guardado: ' + secret);
}

/**
 * Test manual desde el editor:
 *   testRelaunchRow('myinvestor', 12, 'ENVIAR')
 *   testRelaunchRow('myinvestor', 12, 'AUTORIZACION')
 */
function testRelaunchRow(bankSlug, rowNumber, action) {
  action = action || 'ENVIAR';
  var config = DISPATCH_MAP[bankSlug];
  if (!config) { Logger.log('Banco no encontrado: ' + bankSlug); return; }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName);
  if (!sheet) { Logger.log('Hoja no encontrada: ' + config.sheetName); return; }

  if (action === 'AUTORIZACION') {
    sheet.getRange(rowNumber, COL_AUTORIZACION).setValue('Yes');
    SpreadsheetApp.flush();
    Logger.log('Set Autorización=Yes en fila ' + rowNumber);
  }

  Logger.log('Relanzando ' + bankSlug + ' fila ' + rowNumber + ' action=' + action);
  var result = config.fn(sheet, rowNumber, action);
  Logger.log('Resultado: ' + result);
}
