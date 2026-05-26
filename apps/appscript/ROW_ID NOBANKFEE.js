/***************
 * CONFIG NO BANK FEE AUTO
 ***************/
var NOBANKFEE_SHEET_NAME = "No Bank Fee Test";

var NOBANKFEE_COL_OPPORT = 1;          // A - Opportunity
var NOBANKFEE_COL_ENVIAR = 7;          // G - Enviar
var NOBANKFEE_COL_AUTORIZACION = 8;    // H - Autorización
var NOBANKFEE_COL_TIMESTAMP = 10;      // J - Timestamp sent
var NOBANKFEE_COL_STATUS = 11;         // K - Status
var NOBANKFEE_COL_ITEM_ID = 18;        // R - ITEM ID
var NOBANKFEE_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var NOBANKFEE_COL_PROCESS_STATUS = 20; // T - Process Status

var NOBANKFEE_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-nobankfee";

var NOBANKFEE_DUPLICATE_WINDOW_SECONDS = 20;
var NOBANKFEE_AUTO_RETRY_AFTER_MINUTES = 10;
var NOBANKFEE_PROP_PREFIX = "NOBANKFEE_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDNOBANKFEE() {
  return Utilities.getUuid();
}

function isEmptyNOBANKFEE(value) {
  return value === "" || value === null || value === undefined;
}

function cleanNOBANKFEE(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerNOBANKFEE(value) {
  return cleanNOBANKFEE(value).toLowerCase();
}

function isYesNOBANKFEE(value) {
  return lowerNOBANKFEE(value) === "yes";
}

function isStatusEnviadoOkNOBANKFEE(value) {
  return cleanNOBANKFEE(value) === "Enviado ✅";
}

function rangeTouchesColumnNOBANKFEE(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedNOBANKFEE(value) {
  var s = lowerNOBANKFEE(value);

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

function dateToMillisNOBANKFEE(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyNOBANKFEE(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowNOBANKFEE(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetNOBANKFEE() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOBANKFEE_SHEET_NAME);
}

function getRowSnapshotNOBANKFEE(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, NOBANKFEE_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, NOBANKFEE_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, NOBANKFEE_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, NOBANKFEE_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, NOBANKFEE_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, NOBANKFEE_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, NOBANKFEE_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusNOBANKFEE(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, NOBANKFEE_COL_STATUS).getValue();

  if (isStatusEnviadoOkNOBANKFEE(status)) {
    sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionNOBANKFEE(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesNOBANKFEE(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesNOBANKFEE(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesNOBANKFEE(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesNOBANKFEE(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyNOBANKFEE(itemID, action) {
  var safeItemID = cleanNOBANKFEE(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return NOBANKFEE_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoNOBANKFEE(itemID, action) {
  var key = getDuplicateKeyNOBANKFEE(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < NOBANKFEE_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendNOBANKFEE(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyNOBANKFEE(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < NOBANKFEE_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyNOBANKFEE(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, NOBANKFEE_COL_OPPORT).getValue();

  if (isEmptyNOBANKFEE(opportunity)) {
    sheet.getRange(row, NOBANKFEE_COL_ITEM_ID).clearContent();
    sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, NOBANKFEE_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyNOBANKFEE(itemID)) {
    itemID = generateUIDNOBANKFEE();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusNOBANKFEE(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedNOBANKFEE(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanNOBANKFEE(sheet.getRange(row, NOBANKFEE_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, NOBANKFEE_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, NOBANKFEE_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, NOBANKFEE_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, NOBANKFEE_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, NOBANKFEE_COL_AUTORIZACION).getValue();

  if (!isEmptyNOBANKFEE(timestamp) || statusLooksClosedNOBANKFEE(status)) {
    sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesNOBANKFEE(enviarVal) || isYesNOBANKFEE(autorizacionVal)) {
    sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsNOBANKFEE(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, NOBANKFEE_COL_OPPORT).getValue();

    if (isEmptyNOBANKFEE(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusNOBANKFEE(sheet, row)) {
      continue;
    }

    ensureRowReadyNOBANKFEE(sheet, row, forceEnviarYes);

    var data = getRowSnapshotNOBANKFEE(sheet, row);

    if (isYesNOBANKFEE(data.enviar) || isYesNOBANKFEE(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT NOBANKFEE
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditNOBANKFEE(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== NOBANKFEE_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnNOBANKFEE(range, NOBANKFEE_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnNOBANKFEE(range, NOBANKFEE_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnNOBANKFEE(range, NOBANKFEE_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnNOBANKFEE(range, NOBANKFEE_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnNOBANKFEE(range, NOBANKFEE_COL_STATUS);

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

    var opportunity = sheet.getRange(row, NOBANKFEE_COL_OPPORT).getValue();

    if (isEmptyNOBANKFEE(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, NOBANKFEE_COL_ITEM_ID).clearContent();
        sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusNOBANKFEE(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyNOBANKFEE(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesNOBANKFEE(sheet.getRange(row, NOBANKFEE_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesNOBANKFEE(sheet.getRange(row, NOBANKFEE_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusNOBANKFEE(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, NOBANKFEE_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, NOBANKFEE_COL_STATUS).getValue();

      if (!isEmptyNOBANKFEE(timestamp) || statusLooksClosedNOBANKFEE(status)) {
        sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NNOBANKFEE(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NNOBANKFEE(sheet, row, options) {
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

  var data = getRowSnapshotNOBANKFEE(sheet, row);

  if (isEmptyNOBANKFEE(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyNOBANKFEE(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkNOBANKFEE(data.status)) {
    sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionNOBANKFEE(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyNOBANKFEE(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedNOBANKFEE(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedNOBANKFEE(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisNOBANKFEE(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < NOBANKFEE_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoNOBANKFEE(data.itemID, action);

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
function postToN8NNOBANKFEE(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyNOBANKFEE(sheet, row, false);

    if (!ready) {
      Logger.log("NOBANKFEE fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusNOBANKFEE(sheet, row)) {
      Logger.log('NOBANKFEE fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NNOBANKFEE(sheet, row, options);

    if (!validation.ok) {
      Logger.log("NOBANKFEE fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedNOBANKFEE(currentProcessStatus)) {
        sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowNOBANKFEE(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendNOBANKFEE(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("NOBANKFEE fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedNOBANKFEE(currentStatus)) {
        sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowNOBANKFEE(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, NOBANKFEE_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowNOBANKFEE(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanNOBANKFEE(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, NOBANKFEE_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_nobankfee_opportunity_id"] = opportunityId;

    payload["_nobankfee_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_nobankfee_row"] = row;
    payload["_nobankfee_item_id"] = sheet.getRange(row, NOBANKFEE_COL_ITEM_ID).getValue();
    payload["_nobankfee_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(NOBANKFEE_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST NOBANKFEE - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusNOBANKFEE(sheet, row)) {
      Logger.log('NOBANKFEE fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedNOBANKFEE(currentProcessStatusAfterPost)) {
      Logger.log("NOBANKFEE fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowNOBANKFEE(now)
      );
    } else {
      sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting NOBANKFEE to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja NOBANKFEE: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en No Bank Fee Test.
 ***************/
function procesarFilasCreadasPorScriptNOBANKFEE(startRow, numRows) {
  var sheet = getSheetNOBANKFEE();

  if (!sheet) {
    Logger.log("Hoja No Bank Fee Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsNOBANKFEE(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NNOBANKFEE(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptNOBANKFEE(row) {
  procesarFilasCreadasPorScriptNOBANKFEE(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesNOBANKFEE() {
  var sheet = getSheetNOBANKFEE();

  if (!sheet) {
    Logger.log("Hoja No Bank Fee Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en No Bank Fee");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, NOBANKFEE_COL_OPPORT).getValue();

    if (isEmptyNOBANKFEE(opportunity)) continue;

    if (syncProcessStatusFromStatusNOBANKFEE(sheet, row)) {
      Logger.log('NOBANKFEE fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotNOBANKFEE(sheet, row);

    if (statusLooksClosedNOBANKFEE(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyNOBANKFEE(dataBefore.itemID) &&
      isEmptyNOBANKFEE(dataBefore.enviar) &&
      isEmptyNOBANKFEE(dataBefore.autorizacion) &&
      isEmptyNOBANKFEE(dataBefore.timestamp) &&
      !statusLooksClosedNOBANKFEE(dataBefore.status);

    ensureRowReadyNOBANKFEE(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NNOBANKFEE(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("NOBANKFEE fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila NOBANKFEE pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesNOBANKFEE"
    );

    postToN8NNOBANKFEE(sheet, rowsToSend[i], {
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
function checkCompletadosNOBANKFEE() {
  var sheet = getSheetNOBANKFEE();

  if (!sheet) {
    Logger.log("Hoja No Bank Fee Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en No Bank Fee");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, NOBANKFEE_COL_OPPORT).getValue();

    if (isEmptyNOBANKFEE(opportunity)) continue;

    var itemID = sheet.getRange(row, NOBANKFEE_COL_ITEM_ID).getValue();

    if (isEmptyNOBANKFEE(itemID)) {
      sheet.getRange(row, NOBANKFEE_COL_ITEM_ID).setValue(generateUIDNOBANKFEE());
    }

    if (syncProcessStatusFromStatusNOBANKFEE(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, NOBANKFEE_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, NOBANKFEE_COL_STATUS).getValue();

    if (!isEmptyNOBANKFEE(timestamp) || statusLooksClosedNOBANKFEE(status)) {
      sheet.getRange(row, NOBANKFEE_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaNOBANKFEE(row) {
  var sheet = getSheetNOBANKFEE();

  if (!sheet) {
    Logger.log("Hoja No Bank Fee Test no encontrada");
    return;
  }

  var data = getRowSnapshotNOBANKFEE(sheet, row);

  Logger.log("===== DIAGNÓSTICO NOBANKFEE FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedNOBANKFEE(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedNOBANKFEE(data.processStatus));

  var validation = shouldSendToN8NNOBANKFEE(sheet, row, {
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
function recrearTriggerNOBANKFEE() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "onEditNOBANKFEE") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditNOBANKFEE ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditNOBANKFEE")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditNOBANKFEE creado correctamente.");
}