/***************
 * CONFIG CRGRANADA AUTO
 ***************/
var CRGRANADA_SHEET_NAME = "CR Granada Test";

var CRGRANADA_COL_OPPORT = 1;          // A - Opportunity
var CRGRANADA_COL_ENVIAR = 7;          // G - Enviar
var CRGRANADA_COL_AUTORIZACION = 8;    // H - Autorización
var CRGRANADA_COL_TIMESTAMP = 10;      // J - Timestamp sent
var CRGRANADA_COL_STATUS = 11;         // K - Status
var CRGRANADA_COL_ITEM_ID = 18;        // R - ITEM ID
var CRGRANADA_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var CRGRANADA_COL_PROCESS_STATUS = 20; // T - Process Status

var CRGRANADA_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-crgranada";

var CRGRANADA_DUPLICATE_WINDOW_SECONDS = 20;
var CRGRANADA_AUTO_RETRY_AFTER_MINUTES = 10;
var CRGRANADA_PROP_PREFIX = "CRGRANADA_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDCRGRANADA() {
  return Utilities.getUuid();
}

function isEmptyCRGRANADA(value) {
  return value === "" || value === null || value === undefined;
}

function cleanCRGRANADA(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerCRGRANADA(value) {
  return cleanCRGRANADA(value).toLowerCase();
}

function isYesCRGRANADA(value) {
  return lowerCRGRANADA(value) === "yes";
}

function isStatusEnviadoOkCRGRANADA(value) {
  return cleanCRGRANADA(value) === "Enviado ✅";
}

function rangeTouchesColumnCRGRANADA(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;

  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedCRGRANADA(value) {
  var s = lowerCRGRANADA(value);

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

function dateToMillisCRGRANADA(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyCRGRANADA(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowCRGRANADA(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetCRGRANADA() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRGRANADA_SHEET_NAME);
}

function getRowSnapshotCRGRANADA(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, CRGRANADA_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, CRGRANADA_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, CRGRANADA_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, CRGRANADA_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, CRGRANADA_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, CRGRANADA_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, CRGRANADA_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusCRGRANADA(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, CRGRANADA_COL_STATUS).getValue();

  if (isStatusEnviadoOkCRGRANADA(status)) {
    sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionCRGRANADA(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesCRGRANADA(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesCRGRANADA(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesCRGRANADA(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesCRGRANADA(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyCRGRANADA(itemID, action) {
  var safeItemID = cleanCRGRANADA(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return CRGRANADA_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoCRGRANADA(itemID, action) {
  var key = getDuplicateKeyCRGRANADA(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < CRGRANADA_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendCRGRANADA(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyCRGRANADA(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < CRGRANADA_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyCRGRANADA(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, CRGRANADA_COL_OPPORT).getValue();

  if (isEmptyCRGRANADA(opportunity)) {
    sheet.getRange(row, CRGRANADA_COL_ITEM_ID).clearContent();
    sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, CRGRANADA_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyCRGRANADA(itemID)) {
    itemID = generateUIDCRGRANADA();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusCRGRANADA(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedCRGRANADA(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanCRGRANADA(sheet.getRange(row, CRGRANADA_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, CRGRANADA_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, CRGRANADA_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, CRGRANADA_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, CRGRANADA_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, CRGRANADA_COL_AUTORIZACION).getValue();

  if (!isEmptyCRGRANADA(timestamp) || statusLooksClosedCRGRANADA(status)) {
    sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesCRGRANADA(enviarVal) || isYesCRGRANADA(autorizacionVal)) {
    sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsCRGRANADA(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, CRGRANADA_COL_OPPORT).getValue();

    if (isEmptyCRGRANADA(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusCRGRANADA(sheet, row)) {
      continue;
    }

    ensureRowReadyCRGRANADA(sheet, row, forceEnviarYes);

    var data = getRowSnapshotCRGRANADA(sheet, row);

    if (isYesCRGRANADA(data.enviar) || isYesCRGRANADA(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT CRGRANADA
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditCRGRANADA(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== CRGRANADA_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnCRGRANADA(range, CRGRANADA_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnCRGRANADA(range, CRGRANADA_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnCRGRANADA(range, CRGRANADA_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnCRGRANADA(range, CRGRANADA_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnCRGRANADA(range, CRGRANADA_COL_STATUS);

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

    var opportunity = sheet.getRange(row, CRGRANADA_COL_OPPORT).getValue();

    if (isEmptyCRGRANADA(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, CRGRANADA_COL_ITEM_ID).clearContent();
        sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusCRGRANADA(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyCRGRANADA(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesCRGRANADA(sheet.getRange(row, CRGRANADA_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesCRGRANADA(sheet.getRange(row, CRGRANADA_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusCRGRANADA(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, CRGRANADA_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, CRGRANADA_COL_STATUS).getValue();

      if (!isEmptyCRGRANADA(timestamp) || statusLooksClosedCRGRANADA(status)) {
        sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCRGRANADA(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NCRGRANADA(sheet, row, options) {
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

  var data = getRowSnapshotCRGRANADA(sheet, row);

  if (isEmptyCRGRANADA(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyCRGRANADA(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkCRGRANADA(data.status)) {
    sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionCRGRANADA(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyCRGRANADA(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedCRGRANADA(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedCRGRANADA(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisCRGRANADA(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < CRGRANADA_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoCRGRANADA(data.itemID, action);

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
function postToN8NCRGRANADA(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyCRGRANADA(sheet, row, false);

    if (!ready) {
      Logger.log("CRGRANADA fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusCRGRANADA(sheet, row)) {
      Logger.log('CRGRANADA fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NCRGRANADA(sheet, row, options);

    if (!validation.ok) {
      Logger.log("CRGRANADA fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCRGRANADA(currentProcessStatus)) {
        sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowCRGRANADA(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendCRGRANADA(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("CRGRANADA fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCRGRANADA(currentStatus)) {
        sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowCRGRANADA(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, CRGRANADA_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowCRGRANADA(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanCRGRANADA(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, CRGRANADA_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_crgranada_opportunity_id"] = opportunityId;

    payload["_crgranada_action"] = validation.action;
    payload["_crgranada_row"] = row;
    payload["_crgranada_item_id"] = sheet.getRange(row, CRGRANADA_COL_ITEM_ID).getValue();
    payload["_crgranada_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(CRGRANADA_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST CRGRANADA - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusCRGRANADA(sheet, row)) {
      Logger.log('CRGRANADA fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedCRGRANADA(currentProcessStatusAfterPost)) {
      Logger.log("CRGRANADA fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowCRGRANADA(now)
      );
    } else {
      sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting CRGRANADA to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja CRGRANADA: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en CR Granada Test.
 ***************/
function procesarFilasCreadasPorScriptCRGRANADA(startRow, numRows) {
  var sheet = getSheetCRGRANADA();

  if (!sheet) {
    Logger.log("Hoja CR Granada Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsCRGRANADA(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCRGRANADA(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptCRGRANADA(row) {
  procesarFilasCreadasPorScriptCRGRANADA(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesCRGRANADA() {
  var sheet = getSheetCRGRANADA();

  if (!sheet) {
    Logger.log("Hoja CR Granada Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en CR Granada");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CRGRANADA_COL_OPPORT).getValue();

    if (isEmptyCRGRANADA(opportunity)) continue;

    if (syncProcessStatusFromStatusCRGRANADA(sheet, row)) {
      Logger.log('CRGRANADA fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotCRGRANADA(sheet, row);

    if (statusLooksClosedCRGRANADA(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyCRGRANADA(dataBefore.itemID) &&
      isEmptyCRGRANADA(dataBefore.enviar) &&
      isEmptyCRGRANADA(dataBefore.autorizacion) &&
      isEmptyCRGRANADA(dataBefore.timestamp) &&
      !statusLooksClosedCRGRANADA(dataBefore.status);

    ensureRowReadyCRGRANADA(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NCRGRANADA(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("CRGRANADA fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila CRGRANADA pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesCRGRANADA"
    );

    postToN8NCRGRANADA(sheet, rowsToSend[i], {
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
function checkCompletadosCRGRANADA() {
  var sheet = getSheetCRGRANADA();

  if (!sheet) {
    Logger.log("Hoja CR Granada Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en CR Granada");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CRGRANADA_COL_OPPORT).getValue();

    if (isEmptyCRGRANADA(opportunity)) continue;

    var itemID = sheet.getRange(row, CRGRANADA_COL_ITEM_ID).getValue();

    if (isEmptyCRGRANADA(itemID)) {
      sheet.getRange(row, CRGRANADA_COL_ITEM_ID).setValue(generateUIDCRGRANADA());
    }

    if (syncProcessStatusFromStatusCRGRANADA(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, CRGRANADA_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, CRGRANADA_COL_STATUS).getValue();

    if (!isEmptyCRGRANADA(timestamp) || statusLooksClosedCRGRANADA(status)) {
      sheet.getRange(row, CRGRANADA_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaCRGRANADA(row) {
  var sheet = getSheetCRGRANADA();

  if (!sheet) {
    Logger.log("Hoja CR Granada Test no encontrada");
    return;
  }

  var data = getRowSnapshotCRGRANADA(sheet, row);

  Logger.log("===== DIAGNÓSTICO CRGRANADA FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedCRGRANADA(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedCRGRANADA(data.processStatus));

  var validation = shouldSendToN8NCRGRANADA(sheet, row, {
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
function recrearTriggerCRGRANADA() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditCRGRANADA") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditCRGRANADA ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditCRGRANADA")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditCRGRANADA creado correctamente.");
}