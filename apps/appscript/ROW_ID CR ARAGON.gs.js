/***************
 * CONFIG CRARAGON AUTO
 ***************/
var CRARAGON_SHEET_NAME = "CR Aragon Test";

var CRARAGON_COL_OPPORT = 1;          // A - Opportunity
var CRARAGON_COL_ENVIAR = 7;          // G - Enviar
var CRARAGON_COL_AUTORIZACION = 8;    // H - Autorización
var CRARAGON_COL_TIMESTAMP = 10;      // J - Timestamp sent
var CRARAGON_COL_STATUS = 11;         // K - Status
var CRARAGON_COL_ITEM_ID = 18;        // R - ITEM ID
var CRARAGON_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var CRARAGON_COL_PROCESS_STATUS = 20; // T - Process Status

var CRARAGON_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-craragon";

var CRARAGON_DUPLICATE_WINDOW_SECONDS = 20;
var CRARAGON_AUTO_RETRY_AFTER_MINUTES = 10;
var CRARAGON_PROP_PREFIX = "CRARAGON_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDCRARAGON() {
  return Utilities.getUuid();
}

function isEmptyCRARAGON(value) {
  return value === "" || value === null || value === undefined;
}

function cleanCRARAGON(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerCRARAGON(value) {
  return cleanCRARAGON(value).toLowerCase();
}

function isYesCRARAGON(value) {
  return lowerCRARAGON(value) === "yes";
}

function isStatusEnviadoOkCRARAGON(value) {
  return cleanCRARAGON(value) === "Enviado ✅";
}

function rangeTouchesColumnCRARAGON(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedCRARAGON(value) {
  var s = lowerCRARAGON(value);

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

function dateToMillisCRARAGON(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyCRARAGON(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowCRARAGON(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetCRARAGON() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRARAGON_SHEET_NAME);
}

function getRowSnapshotCRARAGON(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, CRARAGON_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, CRARAGON_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, CRARAGON_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, CRARAGON_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, CRARAGON_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, CRARAGON_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, CRARAGON_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusCRARAGON(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, CRARAGON_COL_STATUS).getValue();

  if (isStatusEnviadoOkCRARAGON(status)) {
    sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionCRARAGON(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesCRARAGON(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesCRARAGON(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesCRARAGON(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesCRARAGON(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyCRARAGON(itemID, action) {
  var safeItemID = cleanCRARAGON(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return CRARAGON_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoCRARAGON(itemID, action) {
  var key = getDuplicateKeyCRARAGON(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < CRARAGON_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendCRARAGON(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyCRARAGON(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < CRARAGON_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyCRARAGON(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, CRARAGON_COL_OPPORT).getValue();

  if (isEmptyCRARAGON(opportunity)) {
    sheet.getRange(row, CRARAGON_COL_ITEM_ID).clearContent();
    sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, CRARAGON_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyCRARAGON(itemID)) {
    itemID = generateUIDCRARAGON();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusCRARAGON(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedCRARAGON(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanCRARAGON(sheet.getRange(row, CRARAGON_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, CRARAGON_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, CRARAGON_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, CRARAGON_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, CRARAGON_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, CRARAGON_COL_AUTORIZACION).getValue();

  if (!isEmptyCRARAGON(timestamp) || statusLooksClosedCRARAGON(status)) {
    sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesCRARAGON(enviarVal) || isYesCRARAGON(autorizacionVal)) {
    sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsCRARAGON(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, CRARAGON_COL_OPPORT).getValue();

    if (isEmptyCRARAGON(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusCRARAGON(sheet, row)) {
      continue;
    }

    ensureRowReadyCRARAGON(sheet, row, forceEnviarYes);

    var data = getRowSnapshotCRARAGON(sheet, row);

    if (isYesCRARAGON(data.enviar) || isYesCRARAGON(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT CRARAGON
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditCRARAGON(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== CRARAGON_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnCRARAGON(range, CRARAGON_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnCRARAGON(range, CRARAGON_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnCRARAGON(range, CRARAGON_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnCRARAGON(range, CRARAGON_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnCRARAGON(range, CRARAGON_COL_STATUS);

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

    var opportunity = sheet.getRange(row, CRARAGON_COL_OPPORT).getValue();

    if (isEmptyCRARAGON(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, CRARAGON_COL_ITEM_ID).clearContent();
        sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusCRARAGON(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyCRARAGON(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesCRARAGON(sheet.getRange(row, CRARAGON_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesCRARAGON(sheet.getRange(row, CRARAGON_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusCRARAGON(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, CRARAGON_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, CRARAGON_COL_STATUS).getValue();

      if (!isEmptyCRARAGON(timestamp) || statusLooksClosedCRARAGON(status)) {
        sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCRARAGON(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NCRARAGON(sheet, row, options) {
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

  var data = getRowSnapshotCRARAGON(sheet, row);

  if (isEmptyCRARAGON(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyCRARAGON(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkCRARAGON(data.status)) {
    sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionCRARAGON(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyCRARAGON(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedCRARAGON(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedCRARAGON(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisCRARAGON(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < CRARAGON_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoCRARAGON(data.itemID, action);

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
function postToN8NCRARAGON(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyCRARAGON(sheet, row, false);

    if (!ready) {
      Logger.log("CRARAGON fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusCRARAGON(sheet, row)) {
      Logger.log('CRARAGON fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NCRARAGON(sheet, row, options);

    if (!validation.ok) {
      Logger.log("CRARAGON fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCRARAGON(currentProcessStatus)) {
        sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowCRARAGON(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendCRARAGON(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("CRARAGON fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCRARAGON(currentStatus)) {
        sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowCRARAGON(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, CRARAGON_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowCRARAGON(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanCRARAGON(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, CRARAGON_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_craragon_opportunity_id"] = opportunityId;

    payload["_craragon_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_craragon_row"] = row;
    payload["_craragon_item_id"] = sheet.getRange(row, CRARAGON_COL_ITEM_ID).getValue();
    payload["_craragon_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(CRARAGON_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST CRARAGON - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusCRARAGON(sheet, row)) {
      Logger.log('CRARAGON fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedCRARAGON(currentProcessStatusAfterPost)) {
      Logger.log("CRARAGON fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowCRARAGON(now)
      );
    } else {
      sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting CRARAGON to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja CRARAGON: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en CR Aragon Test.
 ***************/
function procesarFilasCreadasPorScriptCRARAGON(startRow, numRows) {
  var sheet = getSheetCRARAGON();

  if (!sheet) {
    Logger.log("Hoja CR Aragon Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsCRARAGON(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCRARAGON(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptCRARAGON(row) {
  procesarFilasCreadasPorScriptCRARAGON(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesCRARAGON() {
  var sheet = getSheetCRARAGON();

  if (!sheet) {
    Logger.log("Hoja CR Aragon Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en CR Aragón");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CRARAGON_COL_OPPORT).getValue();

    if (isEmptyCRARAGON(opportunity)) continue;

    if (syncProcessStatusFromStatusCRARAGON(sheet, row)) {
      Logger.log('CRARAGON fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotCRARAGON(sheet, row);

    if (statusLooksClosedCRARAGON(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyCRARAGON(dataBefore.itemID) &&
      isEmptyCRARAGON(dataBefore.enviar) &&
      isEmptyCRARAGON(dataBefore.autorizacion) &&
      isEmptyCRARAGON(dataBefore.timestamp) &&
      !statusLooksClosedCRARAGON(dataBefore.status);

    ensureRowReadyCRARAGON(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NCRARAGON(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("CRARAGON fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila CRARAGON pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesCRARAGON"
    );

    postToN8NCRARAGON(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD CON TRIGGER ANTIGUO
 *
 * No envía a n8n.
 ***************/
function checkCompletadosCRARAGON() {
  var sheet = getSheetCRARAGON();

  if (!sheet) {
    Logger.log("Hoja CR Aragon Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en CR Aragón");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CRARAGON_COL_OPPORT).getValue();

    if (isEmptyCRARAGON(opportunity)) continue;

    var itemID = sheet.getRange(row, CRARAGON_COL_ITEM_ID).getValue();

    if (isEmptyCRARAGON(itemID)) {
      sheet.getRange(row, CRARAGON_COL_ITEM_ID).setValue(generateUIDCRARAGON());
    }

    if (syncProcessStatusFromStatusCRARAGON(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, CRARAGON_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, CRARAGON_COL_STATUS).getValue();

    if (!isEmptyCRARAGON(timestamp) || statusLooksClosedCRARAGON(status)) {
      sheet.getRange(row, CRARAGON_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaCRARAGON(row) {
  var sheet = getSheetCRARAGON();

  if (!sheet) {
    Logger.log("Hoja CR Aragon Test no encontrada");
    return;
  }

  var data = getRowSnapshotCRARAGON(sheet, row);

  Logger.log("===== DIAGNÓSTICO CRARAGON FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedCRARAGON(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedCRARAGON(data.processStatus));

  var validation = shouldSendToN8NCRARAGON(sheet, row, {
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
 ***************/
function recrearTriggerCRARAGON() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditCRARAGON") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditCRARAGON ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditCRARAGON")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditCRARAGON creado correctamente.");
}