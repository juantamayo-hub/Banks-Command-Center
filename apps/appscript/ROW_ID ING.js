/***************
 * CONFIG ING AUTO
 ***************/
var ING_SHEET_NAME = "ING";

var ING_COL_OPPORT = 1;          // A - Opportunity
var ING_COL_ENVIAR = 7;          // G - Enviar
var ING_COL_AUTORIZACION = 8;    // H - Autorización
var ING_COL_TIMESTAMP = 10;      // J - Timestamp sent
var ING_COL_STATUS = 11;         // K - Status
var ING_COL_ITEM_ID = 18;        // R - ITEM ID
var ING_COL_LAST_SENT = 19;      // S - Last sent / TEST TIME
var ING_COL_PROCESS_STATUS = 20; // T - Process Status

var ING_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/f2b00ff3-0d78-48ac-a258-6425893eec61";

var ING_DUPLICATE_WINDOW_SECONDS = 20;
var ING_AUTO_RETRY_AFTER_MINUTES = 10;
var ING_PROP_PREFIX = "ING_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDING() {
  return Utilities.getUuid();
}

function isEmptyING(value) {
  return value === "" || value === null || value === undefined;
}

function cleanING(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerING(value) {
  return cleanING(value).toLowerCase();
}

function isYesING(value) {
  return lowerING(value) === "yes";
}

function isStatusEnviadoOkING(value) {
  return cleanING(value) === "Enviado ✅";
}

function rangeTouchesColumnING(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedING(value) {
  var s = lowerING(value);

  if (s === "") return false;

  // Evita falsos positivos:
  // "No enviado" contiene "enviado", pero NO debe cerrar la fila.
  if (
    s.indexOf("no enviado") !== -1 ||
    s.indexOf("no enviada") !== -1 ||
    s.indexOf("sin enviar") !== -1 ||
    s.indexOf("not sent") !== -1 ||
    s.indexOf("no completado") !== -1 ||
    s.indexOf("no completada") !== -1 ||
    s.indexOf("not completed") !== -1
  ) {
    return false;
  }

  return (
    s.indexOf("enviado") !== -1 ||
    s.indexOf("completado") !== -1 ||
    s.indexOf("completed") !== -1 ||
    s.indexOf("sent") !== -1
  );
}

function dateToMillisING(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyING(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowING(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetING() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ING_SHEET_NAME);
}

function getRowSnapshotING(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, ING_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, ING_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, ING_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, ING_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, ING_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, ING_COL_ITEM_ID).getValue(),
    lastSent: sheet.getRange(row, ING_COL_LAST_SENT).getValue(),
    processStatus: sheet.getRange(row, ING_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusING(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, ING_COL_STATUS).getValue();

  if (isStatusEnviadoOkING(status)) {
    sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionING(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesING(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesING(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesING(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesING(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyING(itemID, action) {
  var safeItemID = cleanING(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return ING_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoING(itemID, action) {
  var key = getDuplicateKeyING(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < ING_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

// Reserva corta: usa lock solo para reservar, NO para enviar a n8n.
function tryReserveSendING(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyING(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < ING_DUPLICATE_WINDOW_SECONDS * 1000
    ) {
      var diffSeconds = Math.round((nowMillis - lastMillis) / 1000);

      return {
        ok: false,
        reason: "Bloqueado anti-duplicado. Último envío hace " + diffSeconds + "s"
      };
    }

    props.setProperty(key, String(nowMillis));

    return {
      ok: true,
      key: key
    };

  } finally {
    lock.releaseLock();
  }
}


/***************
 * PREPARAR FILA
 ***************/
function ensureRowReadyING(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, ING_COL_OPPORT).getValue();

  if (isEmptyING(opportunity)) {
    sheet.getRange(row, ING_COL_ITEM_ID).clearContent();
    sheet.getRange(row, ING_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, ING_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyING(itemID)) {
    itemID = generateUIDING();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusING(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, ING_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedING(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanING(sheet.getRange(row, ING_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, ING_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, ING_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, ING_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, ING_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, ING_COL_AUTORIZACION).getValue();

  if (!isEmptyING(timestamp) || statusLooksClosedING(status)) {
    sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesING(enviarVal) || isYesING(autorizacionVal)) {
    sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsING(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, ING_COL_OPPORT).getValue();

    if (isEmptyING(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusING(sheet, row)) {
      continue;
    }

    ensureRowReadyING(sheet, row, forceEnviarYes);

    var data = getRowSnapshotING(sheet, row);

    if (isYesING(data.enviar) || isYesING(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT ING
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditING(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== ING_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnING(range, ING_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnING(range, ING_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnING(range, ING_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnING(range, ING_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnING(range, ING_COL_STATUS);

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

    var opportunity = sheet.getRange(row, ING_COL_OPPORT).getValue();

    if (isEmptyING(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, ING_COL_ITEM_ID).clearContent();
        sheet.getRange(row, ING_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusING(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyING(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (touchesAutorizacion && isYesING(sheet.getRange(row, ING_COL_AUTORIZACION).getValue())) {
        preferredAction = "AUTORIZACION";
      } else if (touchesEnviar && isYesING(sheet.getRange(row, ING_COL_ENVIAR).getValue())) {
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
      if (syncProcessStatusFromStatusING(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, ING_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, ING_COL_STATUS).getValue();

      if (!isEmptyING(timestamp) || statusLooksClosedING(status)) {
        sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  /***************
   * FASE 2:
   * Enviar después de que todas tengan UID / Yes.
   ***************/
  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NING(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDACIÓN
 ***************/
function validateSendING(sheet, row, options) {
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

  var data = getRowSnapshotING(sheet, row);

  if (isEmptyING(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyING(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkING(data.status)) {
    sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionING(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyING(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedING(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedING(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisING(data.lastSent);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < ING_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoING(data.itemID, action);

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

function shouldSendToN8NING(sheet, row, options) {
  return validateSendING(sheet, row, options).ok;
}


/***************
 * POST A N8N
 ***************/
function postToN8NING(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyING(sheet, row, false);

    if (!ready) {
      Logger.log("ING fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusING(sheet, row)) {
      Logger.log('ING fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = validateSendING(sheet, row, options);

    if (!validation.ok) {
      Logger.log("ING fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, ING_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedING(currentProcessStatus)) {
        sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowING(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    // Reserva corta.
    // El lock solo se usa aquí, durante milisegundos.
    // El webhook NO queda dentro del lock.
    var reservation = tryReserveSendING(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("ING fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, ING_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedING(currentStatus)) {
        sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowING(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, ING_COL_LAST_SENT).setValue(now);
    sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowING(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanING(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    payload["_ing_action"] = validation.action;
    payload["_ing_row"] = row;
    payload["_ing_item_id"] = sheet.getRange(row, ING_COL_ITEM_ID).getValue();
    payload["_ing_attempt_at"] = now.toISOString();

    // Este fetch va SIN lock para no bloquear otros bancos.
    var response = UrlFetchApp.fetch(ING_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST ING - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusING(sheet, row)) {
      Logger.log('ING fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, ING_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedING(currentProcessStatusAfterPost)) {
      Logger.log("ING fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowING(now)
      );
    } else {
      sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting ING to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, ING_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja ING: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en ING.
 ***************/
function procesarFilasCreadasPorScriptING(startRow, numRows) {
  var sheet = getSheetING();

  if (!sheet) {
    Logger.log("Hoja ING no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsING(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NING(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptING(row) {
  procesarFilasCreadasPorScriptING(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesING() {
  var sheet = getSheetING();

  if (!sheet) {
    Logger.log("Hoja ING no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en ING");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, ING_COL_OPPORT).getValue();

    if (isEmptyING(opportunity)) continue;

    if (syncProcessStatusFromStatusING(sheet, row)) {
      Logger.log('ING fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotING(sheet, row);

    if (statusLooksClosedING(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyING(dataBefore.itemID) &&
      isEmptyING(dataBefore.enviar) &&
      isEmptyING(dataBefore.autorizacion) &&
      isEmptyING(dataBefore.timestamp) &&
      !statusLooksClosedING(dataBefore.status);

    ensureRowReadyING(sheet, row, shouldForceYes);

    var validation = validateSendING(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("ING fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log("Enviando fila ING pendiente " + rowsToSend[i] + " a n8n desde checkPendientesING");

    postToN8NING(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD CON TRIGGER ANTIGUO ING
 ***************/
function checkCompletadosING() {
  checkPendientesING();
}


/***************
 * DIAGNÓSTICO POR FILA
 *
 * Ejecuta diagnosticarFilaING(353), por ejemplo.
 ***************/
function diagnosticarFilaING(row) {
  var sheet = getSheetING();

  if (!sheet) {
    Logger.log("Hoja ING no encontrada");
    return;
  }

  var data = getRowSnapshotING(sheet, row);

  Logger.log("===== DIAGNÓSTICO ING FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("LAST SENT S: " + data.lastSent);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedING(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedING(data.processStatus));

  var validation = validateSendING(sheet, row, {
    mode: "auto",
    preferredAction: "ENVIAR"
  });

  Logger.log("Validation OK?: " + validation.ok);
  Logger.log("Reason: " + validation.reason);
  Logger.log("Action: " + validation.action);
  Logger.log("===============================================");
}


/***************
 * RECREAR TRIGGER ON EDIT
 *
 * Úsalo solo si no tienes ya onEditING.
 ***************/
function recrearTriggerING() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditING") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditING ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditING")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditING creado correctamente.");
}


/***************
 * TEST PERMISOS
 ***************/
function testFetchPermisosING() {
  var r = UrlFetchApp.fetch("https://example.com");
  Logger.log(r.getResponseCode());
}