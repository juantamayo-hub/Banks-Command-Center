/***************
 * CONFIG IBERCAJA AUTO
 ***************/
var IBERCAJA_SHEET_NAME = "Ibercaja Test";

var IBERCAJA_COL_OPPORT = 1;          // A - Opportunity
var IBERCAJA_COL_ENVIAR = 7;          // G - Enviar
var IBERCAJA_COL_AUTORIZACION = 8;    // H - Autorización
var IBERCAJA_COL_TIMESTAMP = 10;      // J - Timestamp sent
var IBERCAJA_COL_STATUS = 11;         // K - Status
var IBERCAJA_COL_ITEM_ID = 18;        // R - ITEM ID
var IBERCAJA_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var IBERCAJA_COL_PROCESS_STATUS = 20; // T - Process Status

var IBERCAJA_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/ibercaja-dossier";

var IBERCAJA_DUPLICATE_WINDOW_SECONDS = 20;
var IBERCAJA_AUTO_RETRY_AFTER_MINUTES = 10;
var IBERCAJA_PROP_PREFIX = "IBERCAJA_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDIbercaja() {
  return Utilities.getUuid();
}

function isEmptyIbercaja(value) {
  return value === "" || value === null || value === undefined;
}

function cleanIbercaja(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerIbercaja(value) {
  return cleanIbercaja(value).toLowerCase();
}

function isYesIbercaja(value) {
  return lowerIbercaja(value) === "yes";
}

function isStatusEnviadoOkIbercaja(value) {
  return cleanIbercaja(value) === "Enviado ✅";
}

function rangeTouchesColumnIbercaja(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;

  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedIbercaja(value) {
  var s = lowerIbercaja(value);

  if (s === "") return false;

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

function dateToMillisIbercaja(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyIbercaja(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowIbercaja(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetIbercaja() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(IBERCAJA_SHEET_NAME);
}

function getRowSnapshotIbercaja(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, IBERCAJA_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, IBERCAJA_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, IBERCAJA_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, IBERCAJA_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, IBERCAJA_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, IBERCAJA_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, IBERCAJA_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusIbercaja(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, IBERCAJA_COL_STATUS).getValue();

  if (isStatusEnviadoOkIbercaja(status)) {
    sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionIbercaja(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesIbercaja(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesIbercaja(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesIbercaja(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesIbercaja(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyIbercaja(itemID, action) {
  var safeItemID = cleanIbercaja(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return IBERCAJA_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoIbercaja(itemID, action) {
  var key = getDuplicateKeyIbercaja(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < IBERCAJA_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendIbercaja(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyIbercaja(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < IBERCAJA_DUPLICATE_WINDOW_SECONDS * 1000
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
 *
 * En automático, forceEnviarYes = true pone G = Yes.
 ***************/
function ensureRowReadyIbercaja(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, IBERCAJA_COL_OPPORT).getValue();

  if (isEmptyIbercaja(opportunity)) {
    sheet.getRange(row, IBERCAJA_COL_ITEM_ID).clearContent();
    sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, IBERCAJA_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyIbercaja(itemID)) {
    itemID = generateUIDIbercaja();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusIbercaja(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedIbercaja(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanIbercaja(sheet.getRange(row, IBERCAJA_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, IBERCAJA_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, IBERCAJA_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, IBERCAJA_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, IBERCAJA_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, IBERCAJA_COL_AUTORIZACION).getValue();

  if (!isEmptyIbercaja(timestamp) || statusLooksClosedIbercaja(status)) {
    sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesIbercaja(enviarVal) || isYesIbercaja(autorizacionVal)) {
    sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsIbercaja(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, IBERCAJA_COL_OPPORT).getValue();

    if (isEmptyIbercaja(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusIbercaja(sheet, row)) {
      continue;
    }

    ensureRowReadyIbercaja(sheet, row, forceEnviarYes);

    var data = getRowSnapshotIbercaja(sheet, row);

    if (isYesIbercaja(data.enviar) || isYesIbercaja(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT IBERCAJA
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditIbercaja(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== IBERCAJA_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnIbercaja(range, IBERCAJA_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnIbercaja(range, IBERCAJA_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnIbercaja(range, IBERCAJA_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnIbercaja(range, IBERCAJA_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnIbercaja(range, IBERCAJA_COL_STATUS);

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

  for (var r = 0; r < numRows; r++) {
    var row = startRow + r;

    if (row === 1) continue;

    var opportunity = sheet.getRange(row, IBERCAJA_COL_OPPORT).getValue();

    if (isEmptyIbercaja(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, IBERCAJA_COL_ITEM_ID).clearContent();
        sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusIbercaja(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyIbercaja(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesIbercaja(sheet.getRange(row, IBERCAJA_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesIbercaja(sheet.getRange(row, IBERCAJA_COL_ENVIAR).getValue())
      ) {
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
      if (syncProcessStatusFromStatusIbercaja(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, IBERCAJA_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, IBERCAJA_COL_STATUS).getValue();

      if (!isEmptyIbercaja(timestamp) || statusLooksClosedIbercaja(status)) {
        sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NIbercaja(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NIbercaja(sheet, row, options) {
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

  var data = getRowSnapshotIbercaja(sheet, row);

  if (isEmptyIbercaja(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyIbercaja(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkIbercaja(data.status)) {
    sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionIbercaja(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyIbercaja(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedIbercaja(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedIbercaja(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisIbercaja(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < IBERCAJA_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoIbercaja(data.itemID, action);

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
function postToN8NIbercaja(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyIbercaja(sheet, row, false);

    if (!ready) {
      Logger.log("IBERCAJA fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusIbercaja(sheet, row)) {
      Logger.log('IBERCAJA fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NIbercaja(sheet, row, options);

    if (!validation.ok) {
      Logger.log("IBERCAJA fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedIbercaja(currentProcessStatus)) {
        sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowIbercaja(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendIbercaja(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("IBERCAJA fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedIbercaja(currentStatus)) {
        sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowIbercaja(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, IBERCAJA_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowIbercaja(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanIbercaja(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, IBERCAJA_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_ibercaja_opportunity_id"] = opportunityId;

    payload["_ibercaja_action"] = validation.action;
    payload["_ibercaja_row"] = row;
    payload["_ibercaja_item_id"] = sheet.getRange(row, IBERCAJA_COL_ITEM_ID).getValue();
    payload["_ibercaja_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(IBERCAJA_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST IBERCAJA - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusIbercaja(sheet, row)) {
      Logger.log('IBERCAJA fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedIbercaja(currentProcessStatusAfterPost)) {
      Logger.log("IBERCAJA fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowIbercaja(now)
      );
    } else {
      sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting IBERCAJA to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja IBERCAJA: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en Ibercaja Test.
 ***************/
function procesarFilasCreadasPorScriptIbercaja(startRow, numRows) {
  var sheet = getSheetIbercaja();

  if (!sheet) {
    Logger.log("Hoja Ibercaja Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsIbercaja(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NIbercaja(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptIbercaja(row) {
  procesarFilasCreadasPorScriptIbercaja(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 *
 * Útil para recuperar filas que entraron por script
 * pero no llamaron procesarFilasCreadasPorScriptIbercaja.
 ***************/
function checkPendientesIbercaja() {
  var sheet = getSheetIbercaja();

  if (!sheet) {
    Logger.log("Hoja Ibercaja Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Ibercaja");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, IBERCAJA_COL_OPPORT).getValue();

    if (isEmptyIbercaja(opportunity)) continue;

    if (syncProcessStatusFromStatusIbercaja(sheet, row)) {
      Logger.log('IBERCAJA fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotIbercaja(sheet, row);

    if (statusLooksClosedIbercaja(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyIbercaja(dataBefore.itemID) &&
      isEmptyIbercaja(dataBefore.enviar) &&
      isEmptyIbercaja(dataBefore.autorizacion) &&
      isEmptyIbercaja(dataBefore.timestamp) &&
      !statusLooksClosedIbercaja(dataBefore.status);

    ensureRowReadyIbercaja(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NIbercaja(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("IBERCAJA fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila IBERCAJA pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesIbercaja"
    );

    postToN8NIbercaja(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD CON TRIGGER ANTIGUO
 *
 * Si ya tienes trigger llamado checkCompletadosIbercaja,
 * esta función no rompe nada. No envía a n8n.
 ***************/
function checkCompletadosIbercaja() {
  var sheet = getSheetIbercaja();

  if (!sheet) {
    Logger.log("Hoja Ibercaja Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Ibercaja");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, IBERCAJA_COL_OPPORT).getValue();

    if (isEmptyIbercaja(opportunity)) continue;

    var itemID = sheet.getRange(row, IBERCAJA_COL_ITEM_ID).getValue();

    if (isEmptyIbercaja(itemID)) {
      sheet.getRange(row, IBERCAJA_COL_ITEM_ID).setValue(generateUIDIbercaja());
    }

    if (syncProcessStatusFromStatusIbercaja(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, IBERCAJA_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, IBERCAJA_COL_STATUS).getValue();

    if (!isEmptyIbercaja(timestamp) || statusLooksClosedIbercaja(status)) {
      sheet.getRange(row, IBERCAJA_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 *
 * Ejecuta diagnosticarFilaIbercaja(353), por ejemplo.
 ***************/
function diagnosticarFilaIbercaja(row) {
  var sheet = getSheetIbercaja();

  if (!sheet) {
    Logger.log("Hoja Ibercaja Test no encontrada");
    return;
  }

  var data = getRowSnapshotIbercaja(sheet, row);

  Logger.log("===== DIAGNÓSTICO IBERCAJA FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedIbercaja(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedIbercaja(data.processStatus));

  var validation = shouldSendToN8NIbercaja(sheet, row, {
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
 * Úsalo solo si no tienes ya el trigger onEditIbercaja.
 ***************/
function recrearTriggerIbercaja() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditIbercaja") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditIbercaja ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditIbercaja")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditIbercaja creado correctamente.");
}