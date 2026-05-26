/***************
 * CONFIG CAIXA POPULAR
 ***************/
var CAIXAPOPULAR_SHEET_NAME = "Caixa Popular Test";

var CAIXAPOPULAR_COL_OPPORT = 1;          // A - Opportunity
var CAIXAPOPULAR_COL_ENVIAR = 7;          // G - Enviar
var CAIXAPOPULAR_COL_AUTORIZACION = 8;    // H - Autorización
var CAIXAPOPULAR_COL_TIMESTAMP = 10;      // J - Timestamp sent
var CAIXAPOPULAR_COL_STATUS = 11;         // K - Status
var CAIXAPOPULAR_COL_ITEM_ID = 18;        // R - ITEM ID
var CAIXAPOPULAR_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var CAIXAPOPULAR_COL_PROCESS_STATUS = 20; // T - Process Status

var CAIXAPOPULAR_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-caixapopular";

var CAIXAPOPULAR_DUPLICATE_WINDOW_SECONDS = 20;
var CAIXAPOPULAR_AUTO_RETRY_AFTER_MINUTES = 10;
var CAIXAPOPULAR_PROP_PREFIX = "CAIXAPOPULAR_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDCAIXAPOPULAR() {
  return Utilities.getUuid();
}

function isEmptyCAIXAPOPULAR(value) {
  return value === "" || value === null || value === undefined;
}

function cleanCAIXAPOPULAR(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerCAIXAPOPULAR(value) {
  return cleanCAIXAPOPULAR(value).toLowerCase();
}

function isYesCAIXAPOPULAR(value) {
  return lowerCAIXAPOPULAR(value) === "yes";
}

function isStatusEnviadoOkCAIXAPOPULAR(value) {
  return cleanCAIXAPOPULAR(value) === "Enviado ✅";
}

function rangeTouchesColumnCAIXAPOPULAR(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedCAIXAPOPULAR(value) {
  var s = lowerCAIXAPOPULAR(value);

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

function dateToMillisCAIXAPOPULAR(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyCAIXAPOPULAR(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowCAIXAPOPULAR(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetCAIXAPOPULAR() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CAIXAPOPULAR_SHEET_NAME);
}

function getRowSnapshotCAIXAPOPULAR(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, CAIXAPOPULAR_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, CAIXAPOPULAR_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, CAIXAPOPULAR_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, CAIXAPOPULAR_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, CAIXAPOPULAR_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, CAIXAPOPULAR_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, CAIXAPOPULAR_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, CAIXAPOPULAR_COL_STATUS).getValue();

  if (isStatusEnviadoOkCAIXAPOPULAR(status)) {
    sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionCAIXAPOPULAR(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesCAIXAPOPULAR(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesCAIXAPOPULAR(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesCAIXAPOPULAR(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesCAIXAPOPULAR(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyCAIXAPOPULAR(itemID, action) {
  var safeItemID = cleanCAIXAPOPULAR(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return CAIXAPOPULAR_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoCAIXAPOPULAR(itemID, action) {
  var key = getDuplicateKeyCAIXAPOPULAR(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < CAIXAPOPULAR_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendCAIXAPOPULAR(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyCAIXAPOPULAR(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < CAIXAPOPULAR_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyCAIXAPOPULAR(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, CAIXAPOPULAR_COL_OPPORT).getValue();

  if (isEmptyCAIXAPOPULAR(opportunity)) {
    sheet.getRange(row, CAIXAPOPULAR_COL_ITEM_ID).clearContent();
    sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, CAIXAPOPULAR_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyCAIXAPOPULAR(itemID)) {
    itemID = generateUIDCAIXAPOPULAR();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedCAIXAPOPULAR(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanCAIXAPOPULAR(sheet.getRange(row, CAIXAPOPULAR_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, CAIXAPOPULAR_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, CAIXAPOPULAR_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, CAIXAPOPULAR_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, CAIXAPOPULAR_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, CAIXAPOPULAR_COL_AUTORIZACION).getValue();

  if (!isEmptyCAIXAPOPULAR(timestamp) || statusLooksClosedCAIXAPOPULAR(status)) {
    sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesCAIXAPOPULAR(enviarVal) || isYesCAIXAPOPULAR(autorizacionVal)) {
    sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsCAIXAPOPULAR(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, CAIXAPOPULAR_COL_OPPORT).getValue();

    if (isEmptyCAIXAPOPULAR(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row)) {
      continue;
    }

    ensureRowReadyCAIXAPOPULAR(sheet, row, forceEnviarYes);

    var data = getRowSnapshotCAIXAPOPULAR(sheet, row);

    if (isYesCAIXAPOPULAR(data.enviar) || isYesCAIXAPOPULAR(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT CAIXAPOPULAR
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditCAIXAPOPULAR(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== CAIXAPOPULAR_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnCAIXAPOPULAR(range, CAIXAPOPULAR_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnCAIXAPOPULAR(range, CAIXAPOPULAR_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnCAIXAPOPULAR(range, CAIXAPOPULAR_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnCAIXAPOPULAR(range, CAIXAPOPULAR_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnCAIXAPOPULAR(range, CAIXAPOPULAR_COL_STATUS);

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

    var opportunity = sheet.getRange(row, CAIXAPOPULAR_COL_OPPORT).getValue();

    if (isEmptyCAIXAPOPULAR(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, CAIXAPOPULAR_COL_ITEM_ID).clearContent();
        sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyCAIXAPOPULAR(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesCAIXAPOPULAR(sheet.getRange(row, CAIXAPOPULAR_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesCAIXAPOPULAR(sheet.getRange(row, CAIXAPOPULAR_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, CAIXAPOPULAR_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, CAIXAPOPULAR_COL_STATUS).getValue();

      if (!isEmptyCAIXAPOPULAR(timestamp) || statusLooksClosedCAIXAPOPULAR(status)) {
        sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCAIXAPOPULAR(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NCAIXAPOPULAR(sheet, row, options) {
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

  var data = getRowSnapshotCAIXAPOPULAR(sheet, row);

  if (isEmptyCAIXAPOPULAR(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyCAIXAPOPULAR(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkCAIXAPOPULAR(data.status)) {
    sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionCAIXAPOPULAR(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyCAIXAPOPULAR(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedCAIXAPOPULAR(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedCAIXAPOPULAR(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisCAIXAPOPULAR(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < CAIXAPOPULAR_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoCAIXAPOPULAR(data.itemID, action);

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
function postToN8NCAIXAPOPULAR(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyCAIXAPOPULAR(sheet, row, false);

    if (!ready) {
      Logger.log("CAIXAPOPULAR fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row)) {
      Logger.log('CAIXAPOPULAR fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NCAIXAPOPULAR(sheet, row, options);

    if (!validation.ok) {
      Logger.log("CAIXAPOPULAR fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCAIXAPOPULAR(currentProcessStatus)) {
        sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowCAIXAPOPULAR(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendCAIXAPOPULAR(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("CAIXAPOPULAR fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCAIXAPOPULAR(currentStatus)) {
        sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowCAIXAPOPULAR(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, CAIXAPOPULAR_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowCAIXAPOPULAR(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanCAIXAPOPULAR(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, CAIXAPOPULAR_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_caixapopular_opportunity_id"] = opportunityId;

    payload["_caixapopular_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_caixapopular_row"] = row;
    payload["_caixapopular_item_id"] = sheet.getRange(row, CAIXAPOPULAR_COL_ITEM_ID).getValue();
    payload["_caixapopular_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(CAIXAPOPULAR_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST CAIXAPOPULAR - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row)) {
      Logger.log('CAIXAPOPULAR fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedCAIXAPOPULAR(currentProcessStatusAfterPost)) {
      Logger.log("CAIXAPOPULAR fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowCAIXAPOPULAR(now)
      );
    } else {
      sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting CAIXAPOPULAR to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja CAIXAPOPULAR: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en Caixa Popular Test.
 ***************/
function procesarFilasCreadasPorScriptCAIXAPOPULAR(startRow, numRows) {
  var sheet = getSheetCAIXAPOPULAR();

  if (!sheet) {
    Logger.log("Hoja Caixa Popular Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsCAIXAPOPULAR(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCAIXAPOPULAR(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptCAIXAPOPULAR(row) {
  procesarFilasCreadasPorScriptCAIXAPOPULAR(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesCAIXAPOPULAR() {
  var sheet = getSheetCAIXAPOPULAR();

  if (!sheet) {
    Logger.log("Hoja Caixa Popular Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Caixa Popular");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CAIXAPOPULAR_COL_OPPORT).getValue();

    if (isEmptyCAIXAPOPULAR(opportunity)) continue;

    if (syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row)) {
      Logger.log('CAIXAPOPULAR fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotCAIXAPOPULAR(sheet, row);

    if (statusLooksClosedCAIXAPOPULAR(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyCAIXAPOPULAR(dataBefore.itemID) &&
      isEmptyCAIXAPOPULAR(dataBefore.enviar) &&
      isEmptyCAIXAPOPULAR(dataBefore.autorizacion) &&
      isEmptyCAIXAPOPULAR(dataBefore.timestamp) &&
      !statusLooksClosedCAIXAPOPULAR(dataBefore.status);

    ensureRowReadyCAIXAPOPULAR(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NCAIXAPOPULAR(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("CAIXAPOPULAR fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila CAIXAPOPULAR pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesCAIXAPOPULAR"
    );

    postToN8NCAIXAPOPULAR(sheet, rowsToSend[i], {
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
function checkCompletadosCAIXAPOPULAR() {
  var sheet = getSheetCAIXAPOPULAR();

  if (!sheet) {
    Logger.log("Hoja Caixa Popular Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Caixa Popular");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CAIXAPOPULAR_COL_OPPORT).getValue();

    if (isEmptyCAIXAPOPULAR(opportunity)) continue;

    var itemID = sheet.getRange(row, CAIXAPOPULAR_COL_ITEM_ID).getValue();

    if (isEmptyCAIXAPOPULAR(itemID)) {
      sheet.getRange(row, CAIXAPOPULAR_COL_ITEM_ID).setValue(generateUIDCAIXAPOPULAR());
    }

    if (syncProcessStatusFromStatusCAIXAPOPULAR(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, CAIXAPOPULAR_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, CAIXAPOPULAR_COL_STATUS).getValue();

    if (!isEmptyCAIXAPOPULAR(timestamp) || statusLooksClosedCAIXAPOPULAR(status)) {
      sheet.getRange(row, CAIXAPOPULAR_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaCAIXAPOPULAR(row) {
  var sheet = getSheetCAIXAPOPULAR();

  if (!sheet) {
    Logger.log("Hoja Caixa Popular Test no encontrada");
    return;
  }

  var data = getRowSnapshotCAIXAPOPULAR(sheet, row);

  Logger.log("===== DIAGNÓSTICO CAIXAPOPULAR FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedCAIXAPOPULAR(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedCAIXAPOPULAR(data.processStatus));

  var validation = shouldSendToN8NCAIXAPOPULAR(sheet, row, {
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
function recrearTriggerCAIXAPOPULAR() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "onEditCAIXAPOPULAR") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditCAIXAPOPULAR ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditCAIXAPOPULAR")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditCAIXAPOPULAR creado correctamente.");
}