/***************
 * CONFIG CRDELSUR AUTO
 ***************/
var CRDELSUR_SHEET_NAME = "CR del Sur Test";

var CRDELSUR_COL_OPPORT = 1;          // A - Opportunity
var CRDELSUR_COL_ENVIAR = 7;          // G - Enviar
var CRDELSUR_COL_AUTORIZACION = 8;    // H - Autorización
var CRDELSUR_COL_TIMESTAMP = 10;      // J - Timestamp sent
var CRDELSUR_COL_STATUS = 11;         // K - Status
var CRDELSUR_COL_ITEM_ID = 18;        // R - ITEM ID
var CRDELSUR_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var CRDELSUR_COL_PROCESS_STATUS = 20; // T - Process Status

var CRDELSUR_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-crdelsur";

var CRDELSUR_DUPLICATE_WINDOW_SECONDS = 20;
var CRDELSUR_AUTO_RETRY_AFTER_MINUTES = 10;
var CRDELSUR_PROP_PREFIX = "CRDELSUR_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDCRDELSUR() {
  return Utilities.getUuid();
}

function isEmptyCRDELSUR(value) {
  return value === "" || value === null || value === undefined;
}

function cleanCRDELSUR(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerCRDELSUR(value) {
  return cleanCRDELSUR(value).toLowerCase();
}

function isYesCRDELSUR(value) {
  return lowerCRDELSUR(value) === "yes";
}

function isStatusEnviadoOkCRDELSUR(value) {
  return cleanCRDELSUR(value) === "Enviado ✅";
}

function rangeTouchesColumnCRDELSUR(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;

  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedCRDELSUR(value) {
  var s = lowerCRDELSUR(value);

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

function dateToMillisCRDELSUR(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyCRDELSUR(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowCRDELSUR(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetCRDELSUR() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRDELSUR_SHEET_NAME);
}

function getRowSnapshotCRDELSUR(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, CRDELSUR_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, CRDELSUR_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, CRDELSUR_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, CRDELSUR_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, CRDELSUR_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, CRDELSUR_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, CRDELSUR_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusCRDELSUR(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, CRDELSUR_COL_STATUS).getValue();

  if (isStatusEnviadoOkCRDELSUR(status)) {
    sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionCRDELSUR(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesCRDELSUR(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesCRDELSUR(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesCRDELSUR(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesCRDELSUR(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyCRDELSUR(itemID, action) {
  var safeItemID = cleanCRDELSUR(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return CRDELSUR_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoCRDELSUR(itemID, action) {
  var key = getDuplicateKeyCRDELSUR(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < CRDELSUR_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendCRDELSUR(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyCRDELSUR(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < CRDELSUR_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyCRDELSUR(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, CRDELSUR_COL_OPPORT).getValue();

  if (isEmptyCRDELSUR(opportunity)) {
    sheet.getRange(row, CRDELSUR_COL_ITEM_ID).clearContent();
    sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, CRDELSUR_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyCRDELSUR(itemID)) {
    itemID = generateUIDCRDELSUR();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusCRDELSUR(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedCRDELSUR(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanCRDELSUR(sheet.getRange(row, CRDELSUR_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, CRDELSUR_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, CRDELSUR_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, CRDELSUR_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, CRDELSUR_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, CRDELSUR_COL_AUTORIZACION).getValue();

  if (!isEmptyCRDELSUR(timestamp) || statusLooksClosedCRDELSUR(status)) {
    sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesCRDELSUR(enviarVal) || isYesCRDELSUR(autorizacionVal)) {
    sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsCRDELSUR(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, CRDELSUR_COL_OPPORT).getValue();

    if (isEmptyCRDELSUR(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusCRDELSUR(sheet, row)) {
      continue;
    }

    ensureRowReadyCRDELSUR(sheet, row, forceEnviarYes);

    var data = getRowSnapshotCRDELSUR(sheet, row);

    if (isYesCRDELSUR(data.enviar) || isYesCRDELSUR(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT CRDELSUR
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditCRDELSUR(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== CRDELSUR_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnCRDELSUR(range, CRDELSUR_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnCRDELSUR(range, CRDELSUR_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnCRDELSUR(range, CRDELSUR_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnCRDELSUR(range, CRDELSUR_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnCRDELSUR(range, CRDELSUR_COL_STATUS);

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

    var opportunity = sheet.getRange(row, CRDELSUR_COL_OPPORT).getValue();

    if (isEmptyCRDELSUR(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, CRDELSUR_COL_ITEM_ID).clearContent();
        sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusCRDELSUR(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyCRDELSUR(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesCRDELSUR(sheet.getRange(row, CRDELSUR_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesCRDELSUR(sheet.getRange(row, CRDELSUR_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusCRDELSUR(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, CRDELSUR_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, CRDELSUR_COL_STATUS).getValue();

      if (!isEmptyCRDELSUR(timestamp) || statusLooksClosedCRDELSUR(status)) {
        sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCRDELSUR(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NCRDELSUR(sheet, row, options) {
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

  var data = getRowSnapshotCRDELSUR(sheet, row);

  if (isEmptyCRDELSUR(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyCRDELSUR(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkCRDELSUR(data.status)) {
    sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionCRDELSUR(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyCRDELSUR(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedCRDELSUR(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedCRDELSUR(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisCRDELSUR(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < CRDELSUR_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoCRDELSUR(data.itemID, action);

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
function postToN8NCRDELSUR(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyCRDELSUR(sheet, row, false);

    if (!ready) {
      Logger.log("CRDELSUR fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusCRDELSUR(sheet, row)) {
      Logger.log('CRDELSUR fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NCRDELSUR(sheet, row, options);

    if (!validation.ok) {
      Logger.log("CRDELSUR fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCRDELSUR(currentProcessStatus)) {
        sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowCRDELSUR(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendCRDELSUR(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("CRDELSUR fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCRDELSUR(currentStatus)) {
        sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowCRDELSUR(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, CRDELSUR_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowCRDELSUR(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanCRDELSUR(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, CRDELSUR_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_crdelsur_opportunity_id"] = opportunityId;

    payload["_crdelsur_action"] = validation.action;
    payload["_crdelsur_row"] = row;
    payload["_crdelsur_item_id"] = sheet.getRange(row, CRDELSUR_COL_ITEM_ID).getValue();
    payload["_crdelsur_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(CRDELSUR_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST CRDELSUR - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusCRDELSUR(sheet, row)) {
      Logger.log('CRDELSUR fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedCRDELSUR(currentProcessStatusAfterPost)) {
      Logger.log("CRDELSUR fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowCRDELSUR(now)
      );
    } else {
      sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting CRDELSUR to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja CRDELSUR: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en CR del Sur Test.
 ***************/
function procesarFilasCreadasPorScriptCRDELSUR(startRow, numRows) {
  var sheet = getSheetCRDELSUR();

  if (!sheet) {
    Logger.log("Hoja CR del Sur Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsCRDELSUR(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCRDELSUR(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptCRDELSUR(row) {
  procesarFilasCreadasPorScriptCRDELSUR(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesCRDELSUR() {
  var sheet = getSheetCRDELSUR();

  if (!sheet) {
    Logger.log("Hoja CR del Sur Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en CR del Sur");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CRDELSUR_COL_OPPORT).getValue();

    if (isEmptyCRDELSUR(opportunity)) continue;

    if (syncProcessStatusFromStatusCRDELSUR(sheet, row)) {
      Logger.log('CRDELSUR fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotCRDELSUR(sheet, row);

    if (statusLooksClosedCRDELSUR(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyCRDELSUR(dataBefore.itemID) &&
      isEmptyCRDELSUR(dataBefore.enviar) &&
      isEmptyCRDELSUR(dataBefore.autorizacion) &&
      isEmptyCRDELSUR(dataBefore.timestamp) &&
      !statusLooksClosedCRDELSUR(dataBefore.status);

    ensureRowReadyCRDELSUR(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NCRDELSUR(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("CRDELSUR fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila CRDELSUR pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesCRDELSUR"
    );

    postToN8NCRDELSUR(sheet, rowsToSend[i], {
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
function checkCompletadosCRDELSUR() {
  var sheet = getSheetCRDELSUR();

  if (!sheet) {
    Logger.log("Hoja CR del Sur Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en CR del Sur");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CRDELSUR_COL_OPPORT).getValue();

    if (isEmptyCRDELSUR(opportunity)) continue;

    var itemID = sheet.getRange(row, CRDELSUR_COL_ITEM_ID).getValue();

    if (isEmptyCRDELSUR(itemID)) {
      sheet.getRange(row, CRDELSUR_COL_ITEM_ID).setValue(generateUIDCRDELSUR());
    }

    if (syncProcessStatusFromStatusCRDELSUR(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, CRDELSUR_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, CRDELSUR_COL_STATUS).getValue();

    if (!isEmptyCRDELSUR(timestamp) || statusLooksClosedCRDELSUR(status)) {
      sheet.getRange(row, CRDELSUR_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaCRDELSUR(row) {
  var sheet = getSheetCRDELSUR();

  if (!sheet) {
    Logger.log("Hoja CR del Sur Test no encontrada");
    return;
  }

  var data = getRowSnapshotCRDELSUR(sheet, row);

  Logger.log("===== DIAGNÓSTICO CRDELSUR FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedCRDELSUR(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedCRDELSUR(data.processStatus));

  var validation = shouldSendToN8NCRDELSUR(sheet, row, {
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
function recrearTriggerCRDELSUR() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditCRDELSUR") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditCRDELSUR ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditCRDELSUR")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditCRDELSUR creado correctamente.");
}