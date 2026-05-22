/***************
 * CONFIG AUTO
 ***************/
var LABORALK_SHEET_NAME = "Laboral Kutxa Test";

var COL_OPPORT = 1;          // A - Opportunity
var COL_ENVIAR = 7;          // G - Enviar
var COL_AUTORIZACION = 8;    // H - Autorización
var COL_TIMESTAMP = 10;      // J - Timestamp sent
var COL_STATUS = 11;         // K - Status
var COL_ITEM_ID = 18;        // R - ITEM ID
var COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var COL_PROCESS_STATUS = 20; // T - Process Status

var N8N_WEBHOOK_LABORALK = "https://huspy.app.n8n.cloud/webhook/kutxa-dossier-envio";

var LABORALK_DUPLICATE_WINDOW_SECONDS = 20;
var LABORALK_AUTO_RETRY_AFTER_MINUTES = 10;
var LABORALK_PROP_PREFIX = "LABORALK_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDLABORALK() {
  return Utilities.getUuid();
}

function rangeTouchesColumnLABORALK(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function isEmptyLABORALK(value) {
  return value === "" || value === null || value === undefined;
}

function cleanLABORALK(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerLABORALK(value) {
  return cleanLABORALK(value).toLowerCase();
}

function isYesLABORALK(value) {
  return lowerLABORALK(value) === "yes";
}

function isStatusEnviadoOkLABORALK(value) {
  return cleanLABORALK(value) === "Enviado ✅";
}

function statusLooksClosedLABORALK(value) {
  var s = lowerLABORALK(value);

  return (
    s.indexOf("enviado") !== -1 ||
    s.indexOf("completado") !== -1 ||
    s.indexOf("completed") !== -1 ||
    s.indexOf("sent") !== -1
  );
}

function dateToMillisLABORALK(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyLABORALK(value)) return 0;

  var d = new Date(value);
  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowLABORALK(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetLABORALK() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LABORALK_SHEET_NAME);
}

function getRowSnapshotLABORALK(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, COL_STATUS).getValue(),
    itemID: sheet.getRange(row, COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusLABORALK(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, COL_STATUS).getValue();

  if (isStatusEnviadoOkLABORALK(status)) {
    sheet.getRange(row, COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionLABORALK(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesLABORALK(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesLABORALK(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesLABORALK(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesLABORALK(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyLABORALK(itemID, action) {
  var safeItemID = cleanLABORALK(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return LABORALK_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoLABORALK(itemID, action) {
  var key = getDuplicateKeyLABORALK(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < LABORALK_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function reserveSendLABORALK(key) {
  PropertiesService.getScriptProperties().setProperty(key, String(new Date().getTime()));
}


/***************
 * PREPARAR FILA
 ***************/
function ensureRowReadyLABORALK(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, COL_OPPORT).getValue();

  if (isEmptyLABORALK(opportunity)) {
    sheet.getRange(row, COL_ITEM_ID).clearContent();
    sheet.getRange(row, COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyLABORALK(itemID)) {
    itemID = generateUIDLABORALK();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusLABORALK(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedLABORALK(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanLABORALK(sheet.getRange(row, COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, COL_AUTORIZACION).getValue();

  if (!isEmptyLABORALK(timestamp) || statusLooksClosedLABORALK(status)) {
    sheet.getRange(row, COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesLABORALK(enviarVal) || isYesLABORALK(autorizacionVal)) {
    sheet.getRange(row, COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsLABORALK(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, COL_OPPORT).getValue();

    if (isEmptyLABORALK(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusLABORALK(sheet, row)) {
      continue;
    }

    ensureRowReadyLABORALK(sheet, row, forceEnviarYes);

    var data = getRowSnapshotLABORALK(sheet, row);

    if (isYesLABORALK(data.enviar) || isYesLABORALK(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditLABORALK(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== LABORALK_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnLABORALK(range, COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnLABORALK(range, COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnLABORALK(range, COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnLABORALK(range, COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnLABORALK(range, COL_STATUS);

  var isRelevantEdit =
    touchesOpportunity ||
    touchesEnviar ||
    touchesAutorizacion ||
    touchesTimestamp ||
    touchesStatus;

  if (!isRelevantEdit) return;

  var startRow = range.getRow();
  var numRows = range.getNumRows();

  var rowsToSend = [];

  /***************
   * FASE 1:
   * Preparar todas las filas antes de enviar a n8n.
   ***************/
  for (var r = 0; r < numRows; r++) {
    var row = startRow + r;
    if (row === 1) continue;

    var opportunity = sheet.getRange(row, COL_OPPORT).getValue();

    if (isEmptyLABORALK(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, COL_ITEM_ID).clearContent();
        sheet.getRange(row, COL_PROCESS_STATUS).clearContent();
      }
      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusLABORALK(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyLABORALK(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (touchesAutorizacion && isYesLABORALK(sheet.getRange(row, COL_AUTORIZACION).getValue())) {
        preferredAction = "AUTORIZACION";
      } else if (touchesEnviar && isYesLABORALK(sheet.getRange(row, COL_ENVIAR).getValue())) {
        preferredAction = "ENVIAR";
      }

      var mode = touchesEnviar || touchesAutorizacion ? "manual" : "auto";

      rowsToSend.push({
        row: row,
        mode: mode,
        preferredAction: preferredAction
      });
    }

    if (touchesTimestamp || touchesStatus) {
      if (syncProcessStatusFromStatusLABORALK(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, COL_STATUS).getValue();

      if (!isEmptyLABORALK(timestamp) || statusLooksClosedLABORALK(status)) {
        sheet.getRange(row, COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  /***************
   * FASE 2:
   * Enviar después de que todas tengan UID / Yes.
   ***************/
  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NLABORALK(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NLABORALK(sheet, row, options) {
  options = options || {};

  var mode = options.mode || "auto";
  var preferredAction = options.preferredAction || "";
  var manualMode = mode === "manual";

  if (!sheet || row <= 1) {
    return {
      ok: false,
      reason: "Fila inválida"
    };
  }

  var data = getRowSnapshotLABORALK(sheet, row);

  if (isEmptyLABORALK(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyLABORALK(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkLABORALK(data.status)) {
    sheet.getRange(row, COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionLABORALK(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyLABORALK(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedLABORALK(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedLABORALK(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisLABORALK(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < LABORALK_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoLABORALK(data.itemID, action);

  if (recentInfo.isRecent) {
    return {
      ok: false,
      reason: "Bloqueado anti-duplicado. Último envío hace " + recentInfo.diffSeconds + "s"
    };
  }

  return {
    ok: true,
    action: action,
    key: recentInfo.key,
    data: data
  };
}


/***************
 * POST A N8N
 ***************/
function postToN8NLABORALK(sheet, row, options) {
  options = options || {};

  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    Logger.log("Fila " + row + " - no se pudo obtener lock. Otra ejecución está en curso.");
    return false;
  }

  try {
    ensureRowReadyLABORALK(sheet, row, false);

    if (syncProcessStatusFromStatusLABORALK(sheet, row)) {
      Logger.log('Fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NLABORALK(sheet, row, options);

    if (!validation.ok) {
      Logger.log("Fila " + row + " - no enviada: " + validation.reason);
      return false;
    }

    reserveSendLABORALK(validation.key);

    var now = new Date();

    sheet.getRange(row, COL_TEST_TIME).setValue(now);
    sheet.getRange(row, COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowLABORALK(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanLABORALK(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    payload["_laboralk_action"] = validation.action;
    payload["_laboralk_row"] = row;
    payload["_laboralk_item_id"] = sheet.getRange(row, COL_ITEM_ID).getValue();
    payload["_laboralk_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(N8N_WEBHOOK_LABORALK, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST Laboral Kutxa - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusLABORALK(sheet, row)) {
      Logger.log('Fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatus = sheet.getRange(row, COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedLABORALK(currentProcessStatus)) {
      Logger.log("Fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowLABORALK(now)
      );
    } else {
      sheet.getRange(row, COL_PROCESS_STATUS).setValue(
        "Error n8n (" +
        validation.action +
        ") - HTTP " +
        code +
        " - " +
        body.substring(0, 200)
      );
    }

    return true;

  } catch (err) {
    Logger.log("Error posting to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja: " + innerErr);
    }

    return false;

  } finally {
    lock.releaseLock();
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta es la función que debe llamar el script distribuidor
 * cuando crea filas en la pestaña Laboral Kutxa.
 ***************/
function procesarFilasCreadasPorScriptLABORALK(startRow, numRows) {
  var sheet = getSheetLABORALK();

  if (!sheet) {
    Logger.log("Hoja Laboral Kutxa Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsLABORALK(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NLABORALK(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptLABORALK(row) {
  procesarFilasCreadasPorScriptLABORALK(row, 1);
}


/***************
 * CHECKER MANUAL / TRIGGER DE TIEMPO
 *
 * Útil para recuperar filas que entraron por script
 * pero no llamaron procesarFilasCreadasPorScriptLABORALK.
 ***************/
function checkPendientesLABORALK() {
  var sheet = getSheetLABORALK();

  if (!sheet) {
    Logger.log("Hoja Laboral Kutxa Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos");
    return;
  }

  var rowsToSend = [];

  /***************
   * FASE 1:
   * Preparar filas incompletas.
   ***************/
  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, COL_OPPORT).getValue();

    if (isEmptyLABORALK(opportunity)) continue;

    if (syncProcessStatusFromStatusLABORALK(sheet, row)) {
      Logger.log('Fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotLABORALK(sheet, row);

    if (statusLooksClosedLABORALK(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyLABORALK(dataBefore.itemID) &&
      isEmptyLABORALK(dataBefore.enviar) &&
      isEmptyLABORALK(dataBefore.autorizacion) &&
      isEmptyLABORALK(dataBefore.timestamp) &&
      !statusLooksClosedLABORALK(dataBefore.status);

    ensureRowReadyLABORALK(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NLABORALK(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("Fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  /***************
   * FASE 2:
   * Enviar después de preparar todas.
   ***************/
  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log("Enviando fila pendiente " + rowsToSend[i] + " a n8n desde checkPendientesLABORALK");

    postToN8NLABORALK(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * RECREAR TRIGGER ON EDIT
 *
 * Ejecuta esta función una sola vez.
 ***************/
function recrearTriggerLABORALK() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditLABORALK") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditLABORALK ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditLABORALK")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditLABORALK creado correctamente.");
}


/***************
 * CREAR TRIGGER CHECKER OPCIONAL
 *
 * Ejecuta esta función una sola vez si quieres que el checker
 * revise filas pendientes automáticamente cada 5 minutos.
 ***************/
function crearTriggerCheckerLABORALK() {
  var triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "checkPendientesLABORALK") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("checkPendientesLABORALK")
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log("Trigger checkPendientesLABORALK creado correctamente.");
}
function borrarTriggersDuplicados() {
  var triggers = ScriptApp.getProjectTriggers();
  var vistos = {};

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    var eventType = String(trigger.getEventType());
    var key = handler + "__" + eventType;

    if (vistos[key]) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log("Trigger duplicado eliminado: " + handler + " | " + eventType);
    } else {
      vistos[key] = true;
    }
  });

  Logger.log("Limpieza de duplicados completada.");
}