/***************
 * CONFIG CAJAMAR AUTO
 ***************/
var CAJAMAR_SHEET_NAME = "Cajamar Test";

var CAJAMAR_COL_OPPORT = 1;          // A - Opportunity
var CAJAMAR_COL_ENVIAR = 7;          // G - Enviar
var CAJAMAR_COL_AUTORIZACION = 8;    // H - Autorización
var CAJAMAR_COL_TIMESTAMP = 10;      // J - Timestamp sent
var CAJAMAR_COL_STATUS = 11;         // K - Status
var CAJAMAR_COL_ITEM_ID = 18;        // R - ITEM ID
var CAJAMAR_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var CAJAMAR_COL_PROCESS_STATUS = 20; // T - Process Status

var CAJAMAR_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-cajamar";

var CAJAMAR_DUPLICATE_WINDOW_SECONDS = 20;
var CAJAMAR_AUTO_RETRY_AFTER_MINUTES = 10;
var CAJAMAR_PROP_PREFIX = "CAJAMAR_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDCAJAMAR() {
  return Utilities.getUuid();
}

function isEmptyCAJAMAR(value) {
  return value === "" || value === null || value === undefined;
}

function cleanCAJAMAR(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerCAJAMAR(value) {
  return cleanCAJAMAR(value).toLowerCase();
}

function isYesCAJAMAR(value) {
  return lowerCAJAMAR(value) === "yes";
}

function isStatusEnviadoOkCAJAMAR(value) {
  return cleanCAJAMAR(value) === "Enviado ✅";
}

function rangeTouchesColumnCAJAMAR(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;

  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedCAJAMAR(value) {
  var s = lowerCAJAMAR(value);

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

function dateToMillisCAJAMAR(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyCAJAMAR(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowCAJAMAR(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetCAJAMAR() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CAJAMAR_SHEET_NAME);
}

function getRowSnapshotCAJAMAR(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, CAJAMAR_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, CAJAMAR_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, CAJAMAR_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, CAJAMAR_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, CAJAMAR_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, CAJAMAR_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, CAJAMAR_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusCAJAMAR(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, CAJAMAR_COL_STATUS).getValue();

  if (isStatusEnviadoOkCAJAMAR(status)) {
    sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionCAJAMAR(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesCAJAMAR(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesCAJAMAR(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesCAJAMAR(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesCAJAMAR(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyCAJAMAR(itemID, action) {
  var safeItemID = cleanCAJAMAR(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return CAJAMAR_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoCAJAMAR(itemID, action) {
  var key = getDuplicateKeyCAJAMAR(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < CAJAMAR_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendCAJAMAR(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyCAJAMAR(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < CAJAMAR_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyCAJAMAR(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, CAJAMAR_COL_OPPORT).getValue();

  if (isEmptyCAJAMAR(opportunity)) {
    sheet.getRange(row, CAJAMAR_COL_ITEM_ID).clearContent();
    sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, CAJAMAR_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyCAJAMAR(itemID)) {
    itemID = generateUIDCAJAMAR();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusCAJAMAR(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedCAJAMAR(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanCAJAMAR(sheet.getRange(row, CAJAMAR_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, CAJAMAR_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, CAJAMAR_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, CAJAMAR_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, CAJAMAR_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, CAJAMAR_COL_AUTORIZACION).getValue();

  if (!isEmptyCAJAMAR(timestamp) || statusLooksClosedCAJAMAR(status)) {
    sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesCAJAMAR(enviarVal) || isYesCAJAMAR(autorizacionVal)) {
    sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsCAJAMAR(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, CAJAMAR_COL_OPPORT).getValue();

    if (isEmptyCAJAMAR(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusCAJAMAR(sheet, row)) {
      continue;
    }

    ensureRowReadyCAJAMAR(sheet, row, forceEnviarYes);

    var data = getRowSnapshotCAJAMAR(sheet, row);

    if (isYesCAJAMAR(data.enviar) || isYesCAJAMAR(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT CAJAMAR
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditCAJAMAR(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== CAJAMAR_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnCAJAMAR(range, CAJAMAR_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnCAJAMAR(range, CAJAMAR_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnCAJAMAR(range, CAJAMAR_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnCAJAMAR(range, CAJAMAR_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnCAJAMAR(range, CAJAMAR_COL_STATUS);

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

    var opportunity = sheet.getRange(row, CAJAMAR_COL_OPPORT).getValue();

    if (isEmptyCAJAMAR(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, CAJAMAR_COL_ITEM_ID).clearContent();
        sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusCAJAMAR(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyCAJAMAR(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesCAJAMAR(sheet.getRange(row, CAJAMAR_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesCAJAMAR(sheet.getRange(row, CAJAMAR_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusCAJAMAR(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, CAJAMAR_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, CAJAMAR_COL_STATUS).getValue();

      if (!isEmptyCAJAMAR(timestamp) || statusLooksClosedCAJAMAR(status)) {
        sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCAJAMAR(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NCAJAMAR(sheet, row, options) {
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

  var data = getRowSnapshotCAJAMAR(sheet, row);

  if (isEmptyCAJAMAR(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyCAJAMAR(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkCAJAMAR(data.status)) {
    sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionCAJAMAR(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyCAJAMAR(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedCAJAMAR(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedCAJAMAR(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisCAJAMAR(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < CAJAMAR_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoCAJAMAR(data.itemID, action);

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
function postToN8NCAJAMAR(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyCAJAMAR(sheet, row, false);

    if (!ready) {
      Logger.log("CAJAMAR fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusCAJAMAR(sheet, row)) {
      Logger.log('CAJAMAR fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NCAJAMAR(sheet, row, options);

    if (!validation.ok) {
      Logger.log("CAJAMAR fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCAJAMAR(currentProcessStatus)) {
        sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowCAJAMAR(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendCAJAMAR(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("CAJAMAR fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedCAJAMAR(currentStatus)) {
        sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowCAJAMAR(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, CAJAMAR_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowCAJAMAR(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanCAJAMAR(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, CAJAMAR_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_cajamar_opportunity_id"] = opportunityId;

    payload["_cajamar_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_cajamar_row"] = row;
    payload["_cajamar_item_id"] = sheet.getRange(row, CAJAMAR_COL_ITEM_ID).getValue();
    payload["_cajamar_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(CAJAMAR_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST CAJAMAR - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusCAJAMAR(sheet, row)) {
      Logger.log('CAJAMAR fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedCAJAMAR(currentProcessStatusAfterPost)) {
      Logger.log("CAJAMAR fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowCAJAMAR(now)
      );
    } else {
      sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting CAJAMAR to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja CAJAMAR: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en Cajamar Test.
 ***************/
function procesarFilasCreadasPorScriptCAJAMAR(startRow, numRows) {
  var sheet = getSheetCAJAMAR();

  if (!sheet) {
    Logger.log("Hoja Cajamar Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsCAJAMAR(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NCAJAMAR(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptCAJAMAR(row) {
  procesarFilasCreadasPorScriptCAJAMAR(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesCAJAMAR() {
  var sheet = getSheetCAJAMAR();

  if (!sheet) {
    Logger.log("Hoja Cajamar Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Cajamar");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CAJAMAR_COL_OPPORT).getValue();

    if (isEmptyCAJAMAR(opportunity)) continue;

    if (syncProcessStatusFromStatusCAJAMAR(sheet, row)) {
      Logger.log('CAJAMAR fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotCAJAMAR(sheet, row);

    if (statusLooksClosedCAJAMAR(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyCAJAMAR(dataBefore.itemID) &&
      isEmptyCAJAMAR(dataBefore.enviar) &&
      isEmptyCAJAMAR(dataBefore.autorizacion) &&
      isEmptyCAJAMAR(dataBefore.timestamp) &&
      !statusLooksClosedCAJAMAR(dataBefore.status);

    ensureRowReadyCAJAMAR(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NCAJAMAR(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("CAJAMAR fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila CAJAMAR pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesCAJAMAR"
    );

    postToN8NCAJAMAR(sheet, rowsToSend[i], {
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
function checkCompletadosCAJAMAR() {
  var sheet = getSheetCAJAMAR();

  if (!sheet) {
    Logger.log("Hoja Cajamar Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Cajamar");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, CAJAMAR_COL_OPPORT).getValue();

    if (isEmptyCAJAMAR(opportunity)) continue;

    var itemID = sheet.getRange(row, CAJAMAR_COL_ITEM_ID).getValue();

    if (isEmptyCAJAMAR(itemID)) {
      sheet.getRange(row, CAJAMAR_COL_ITEM_ID).setValue(generateUIDCAJAMAR());
    }

    if (syncProcessStatusFromStatusCAJAMAR(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, CAJAMAR_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, CAJAMAR_COL_STATUS).getValue();

    if (!isEmptyCAJAMAR(timestamp) || statusLooksClosedCAJAMAR(status)) {
      sheet.getRange(row, CAJAMAR_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaCAJAMAR(row) {
  var sheet = getSheetCAJAMAR();

  if (!sheet) {
    Logger.log("Hoja Cajamar Test no encontrada");
    return;
  }

  var data = getRowSnapshotCAJAMAR(sheet, row);

  Logger.log("===== DIAGNÓSTICO CAJAMAR FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedCAJAMAR(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedCAJAMAR(data.processStatus));

  var validation = shouldSendToN8NCAJAMAR(sheet, row, {
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
function recrearTriggerCAJAMAR() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditCAJAMAR") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditCAJAMAR ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditCAJAMAR")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditCAJAMAR creado correctamente.");
}