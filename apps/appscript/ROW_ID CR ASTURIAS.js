/***************
 * CONFIG CRASTURIAS AUTO
 ***************/
var CRASTURIAS_SHEET_NAME = "CR Asturias Test";

var CRASTURIAS_COL_OPPORT = 1;          // A - Opportunity
var CRASTURIAS_COL_ENVIAR = 7;          // G - Enviar
var CRASTURIAS_COL_AUTORIZACION = 8;    // H - Autorización
var CRASTURIAS_COL_TIMESTAMP = 10;      // J - Timestamp sent
var CRASTURIAS_COL_STATUS = 11;         // K - Status
var CRASTURIAS_COL_ITEM_ID = 18;        // R - ITEM ID
var CRASTURIAS_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var CRASTURIAS_COL_PROCESS_STATUS = 20; // T - Process Status

var CRASTURIAS_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-crasturias";

var CRASTURIAS_DUPLICATE_WINDOW_SECONDS = 20;
var CRASTURIAS_AUTO_RETRY_AFTER_MINUTES = 10;
var CRASTURIAS_PROP_PREFIX = "CRASTURIAS_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDCRASTURIAS() {
  return Utilities.getUuid();
}

function isEmptyCRASTURIAS(value) {
  return value === "" || value === null || value === undefined;
}

function cleanCRASTURIAS(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerCRASTURIAS(value) {
  return cleanCRASTURIAS(value).toLowerCase();
}

function isYesCRASTURIAS(value) {
  return lowerCRASTURIAS(value) === "yes";
}

function isStatusEnviadoOkCRASTURIAS(value) {
  return cleanCRASTURIAS(value) === "Enviado ✅";
}

function rangeTouchesColumnCRASTURIAS(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;

  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedCRASTURIAS(value) {
  var s = lowerCRASTURIAS(value);

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

function dateToMillisCRASTURIAS(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyCRASTURIAS(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowCRASTURIAS(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetCRASTURIAS() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRASTURIAS_SHEET_NAME);
}

function getRowSnapshotCRASTURIAS(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, CRASTURIAS_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, CRASTURIAS_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, CRASTURIAS_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, CRASTURIAS_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, CRASTURIAS_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, CRASTURIAS_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, CRASTURIAS_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusCRASTURIAS(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, CRASTURIAS_COL_STATUS).getValue();

  if (isStatusEnviadoOkCRASTURIAS(status)) {
    sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionCRASTURIAS(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesCRASTURIAS(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesCRASTURIAS(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesCRASTURIAS(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesCRASTURIAS(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyCRASTURIAS(itemID, action) {
  var safeItemID = cleanCRASTURIAS(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return CRASTURIAS_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoCRASTURIAS(itemID, action) {
  var key = getDuplicateKeyCRASTURIAS(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < CRASTURIAS_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendCRASTURIAS(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyCRASTURIAS(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < CRASTURIAS_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyCRASTURIAS(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, CRASTURIAS_COL_OPPORT).getValue();

  if (isEmptyCRASTURIAS(opportunity)) {
    sheet.getRange(row, CRASTURIAS_COL_ITEM_ID).clearContent();
    sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, CRASTURIAS_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyCRASTURIAS(itemID)) {
    itemID = generateUIDCRASTURIAS();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusCRASTURIAS(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedCRASTURIAS(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanCRASTURIAS(sheet.getRange(row, CRASTURIAS_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, CRASTURIAS_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, CRASTURIAS_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, CRASTURIAS_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, CRASTURIAS_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, CRASTURIAS_COL_AUTORIZACION).getValue();

  if (!isEmptyCRASTURIAS(timestamp) || statusLooksClosedCRASTURIAS(status)) {
    sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesCRASTURIAS(enviarVal) || isYesCRASTURIAS(autorizacionVal)) {
    sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsCRASTURIAS(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, CRASTURIAS_COL_OPPORT).getValue();

    if (isEmptyCRASTURIAS(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusCRASTURIAS(sheet, row)) {
      continue;
    }

    ensureRowReadyCRASTURIAS(sheet, row, forceEnviarYes);

    var data = getRowSnapshotCRASTURIAS(sheet, row);

    if (isYesCRASTURIAS(data.enviar) || isYesCRASTURIAS(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT CRASTURIAS
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditCRASTURIAS(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== CRASTURIAS_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnCRASTURIAS(range, CRASTURIAS_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnCRASTURIAS(range, CRASTURIAS_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnCRASTURIAS(range, CRASTURIAS_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnCRASTURIAS(range, CRASTURIAS_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnCRASTURIAS(range, CRASTURIAS_COL_STATUS);

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

    var opportunity = sheet.getRange(row, CRASTURIAS_COL_OPPORT).getValue();

    if (isEmptyCRASTURIAS(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, CRASTURIAS_COL_ITEM_ID).clearContent();
        sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusCRASTURIAS(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyCRASTURIAS(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesCRASTURIAS(sheet.getRange(row, CRASTURIAS_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesCRASTURIAS(sheet.getRange(row, CRASTURIAS_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusCRASTURIAS(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, CRASTURIAS_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, CRASTURIAS_COL_STATUS).getValue();

      if (!isEmptyCRASTURIAS(timestamp) || statusLooksClosedCRASTURIAS(status)) {
        sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCRASTURIAS(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NCRASTURIAS(sheet, row, options) {
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

  var data = getRowSnapshotCRASTURIAS(sheet, row);

  if (isEmptyCRASTURIAS(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyCRASTURIAS(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkCRASTURIAS(data.status)) {
    sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionCRASTURIAS(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyCRASTURIAS(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedCRASTURIAS(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedCRASTURIAS(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisCRASTURIAS(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < CRASTURIAS_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoCRASTURIAS(data.itemID, action);

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
function postToN8NCRASTURIAS(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyCRASTURIAS(sheet, row, false);

    if (!ready) {
      Logger.log("CRASTURIAS fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusCRASTURIAS(sheet, row)) {
      Logger.log('CRASTURIAS fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NCRASTURIAS(sheet, row, options);

    if (!validation.ok) {
      Logger.log("CRASTURIAS fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCRASTURIAS(currentProcessStatus)) {
        sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowCRASTURIAS(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendCRASTURIAS(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("CRASTURIAS fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCRASTURIAS(currentStatus)) {
        sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowCRASTURIAS(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, CRASTURIAS_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowCRASTURIAS(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanCRASTURIAS(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, CRASTURIAS_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_crasturias_opportunity_id"] = opportunityId;

    payload["_crasturias_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_crasturias_row"] = row;
    payload["_crasturias_item_id"] = sheet.getRange(row, CRASTURIAS_COL_ITEM_ID).getValue();
    payload["_crasturias_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(CRASTURIAS_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST CRASTURIAS - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusCRASTURIAS(sheet, row)) {
      Logger.log('CRASTURIAS fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedCRASTURIAS(currentProcessStatusAfterPost)) {
      Logger.log("CRASTURIAS fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowCRASTURIAS(now)
      );
    } else {
      sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting CRASTURIAS to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja CRASTURIAS: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en CR Asturias Test.
 ***************/
function procesarFilasCreadasPorScriptCRASTURIAS(startRow, numRows) {
  var sheet = getSheetCRASTURIAS();

  if (!sheet) {
    Logger.log("Hoja CR Asturias Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsCRASTURIAS(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCRASTURIAS(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptCRASTURIAS(row) {
  procesarFilasCreadasPorScriptCRASTURIAS(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesCRASTURIAS() {
  var sheet = getSheetCRASTURIAS();

  if (!sheet) {
    Logger.log("Hoja CR Asturias Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en CR Asturias");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CRASTURIAS_COL_OPPORT).getValue();

    if (isEmptyCRASTURIAS(opportunity)) continue;

    if (syncProcessStatusFromStatusCRASTURIAS(sheet, row)) {
      Logger.log('CRASTURIAS fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotCRASTURIAS(sheet, row);

    if (statusLooksClosedCRASTURIAS(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyCRASTURIAS(dataBefore.itemID) &&
      isEmptyCRASTURIAS(dataBefore.enviar) &&
      isEmptyCRASTURIAS(dataBefore.autorizacion) &&
      isEmptyCRASTURIAS(dataBefore.timestamp) &&
      !statusLooksClosedCRASTURIAS(dataBefore.status);

    ensureRowReadyCRASTURIAS(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NCRASTURIAS(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("CRASTURIAS fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila CRASTURIAS pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesCRASTURIAS"
    );

    postToN8NCRASTURIAS(sheet, rowsToSend[i], {
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
function checkCompletadosCRASTURIAS() {
  var sheet = getSheetCRASTURIAS();

  if (!sheet) {
    Logger.log("Hoja CR Asturias Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en CR Asturias");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CRASTURIAS_COL_OPPORT).getValue();

    if (isEmptyCRASTURIAS(opportunity)) continue;

    var itemID = sheet.getRange(row, CRASTURIAS_COL_ITEM_ID).getValue();

    if (isEmptyCRASTURIAS(itemID)) {
      sheet.getRange(row, CRASTURIAS_COL_ITEM_ID).setValue(generateUIDCRASTURIAS());
    }

    if (syncProcessStatusFromStatusCRASTURIAS(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, CRASTURIAS_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, CRASTURIAS_COL_STATUS).getValue();

    if (!isEmptyCRASTURIAS(timestamp) || statusLooksClosedCRASTURIAS(status)) {
      sheet.getRange(row, CRASTURIAS_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaCRASTURIAS(row) {
  var sheet = getSheetCRASTURIAS();

  if (!sheet) {
    Logger.log("Hoja CR Asturias Test no encontrada");
    return;
  }

  var data = getRowSnapshotCRASTURIAS(sheet, row);

  Logger.log("===== DIAGNÓSTICO CRASTURIAS FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedCRASTURIAS(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedCRASTURIAS(data.processStatus));

  var validation = shouldSendToN8NCRASTURIAS(sheet, row, {
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
function recrearTriggerCRASTURIAS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditCRASTURIAS") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditCRASTURIAS ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditCRASTURIAS")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditCRASTURIAS creado correctamente.");
}