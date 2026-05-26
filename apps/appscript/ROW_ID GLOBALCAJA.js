/***************
 * CONFIG GLOBALCAJA AUTO
 ***************/
var GLOBALCAJA_SHEET_NAME = "Globalcaja Test";

var GLOBALCAJA_COL_OPPORT = 1;          // A - Opportunity
var GLOBALCAJA_COL_ENVIAR = 7;          // G - Enviar
var GLOBALCAJA_COL_AUTORIZACION = 8;    // H - Autorización
var GLOBALCAJA_COL_TIMESTAMP = 10;      // J - Timestamp sent
var GLOBALCAJA_COL_STATUS = 11;         // K - Status
var GLOBALCAJA_COL_ITEM_ID = 18;        // R - ITEM ID
var GLOBALCAJA_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var GLOBALCAJA_COL_PROCESS_STATUS = 20; // T - Process Status

var GLOBALCAJA_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-globalcaja";

var GLOBALCAJA_DUPLICATE_WINDOW_SECONDS = 20;
var GLOBALCAJA_AUTO_RETRY_AFTER_MINUTES = 10;
var GLOBALCAJA_PROP_PREFIX = "GLOBALCAJA_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDGLOBALCAJA() {
  return Utilities.getUuid();
}

function isEmptyGLOBALCAJA(value) {
  return value === "" || value === null || value === undefined;
}

function cleanGLOBALCAJA(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerGLOBALCAJA(value) {
  return cleanGLOBALCAJA(value).toLowerCase();
}

function isYesGLOBALCAJA(value) {
  return lowerGLOBALCAJA(value) === "yes";
}

function isStatusEnviadoOkGLOBALCAJA(value) {
  return cleanGLOBALCAJA(value) === "Enviado ✅";
}

function rangeTouchesColumnGLOBALCAJA(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;

  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedGLOBALCAJA(value) {
  var s = lowerGLOBALCAJA(value);

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

function dateToMillisGLOBALCAJA(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyGLOBALCAJA(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowGLOBALCAJA(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetGLOBALCAJA() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GLOBALCAJA_SHEET_NAME);
}

function getRowSnapshotGLOBALCAJA(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, GLOBALCAJA_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, GLOBALCAJA_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, GLOBALCAJA_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, GLOBALCAJA_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, GLOBALCAJA_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, GLOBALCAJA_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, GLOBALCAJA_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusGLOBALCAJA(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, GLOBALCAJA_COL_STATUS).getValue();

  if (isStatusEnviadoOkGLOBALCAJA(status)) {
    sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionGLOBALCAJA(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesGLOBALCAJA(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesGLOBALCAJA(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesGLOBALCAJA(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesGLOBALCAJA(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyGLOBALCAJA(itemID, action) {
  var safeItemID = cleanGLOBALCAJA(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return GLOBALCAJA_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoGLOBALCAJA(itemID, action) {
  var key = getDuplicateKeyGLOBALCAJA(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < GLOBALCAJA_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendGLOBALCAJA(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyGLOBALCAJA(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < GLOBALCAJA_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyGLOBALCAJA(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, GLOBALCAJA_COL_OPPORT).getValue();

  if (isEmptyGLOBALCAJA(opportunity)) {
    sheet.getRange(row, GLOBALCAJA_COL_ITEM_ID).clearContent();
    sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, GLOBALCAJA_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyGLOBALCAJA(itemID)) {
    itemID = generateUIDGLOBALCAJA();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusGLOBALCAJA(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedGLOBALCAJA(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanGLOBALCAJA(sheet.getRange(row, GLOBALCAJA_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, GLOBALCAJA_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, GLOBALCAJA_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, GLOBALCAJA_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, GLOBALCAJA_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, GLOBALCAJA_COL_AUTORIZACION).getValue();

  if (!isEmptyGLOBALCAJA(timestamp) || statusLooksClosedGLOBALCAJA(status)) {
    sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesGLOBALCAJA(enviarVal) || isYesGLOBALCAJA(autorizacionVal)) {
    sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsGLOBALCAJA(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, GLOBALCAJA_COL_OPPORT).getValue();

    if (isEmptyGLOBALCAJA(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusGLOBALCAJA(sheet, row)) {
      continue;
    }

    ensureRowReadyGLOBALCAJA(sheet, row, forceEnviarYes);

    var data = getRowSnapshotGLOBALCAJA(sheet, row);

    if (isYesGLOBALCAJA(data.enviar) || isYesGLOBALCAJA(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT GLOBALCAJA
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditGLOBALCAJA(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== GLOBALCAJA_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnGLOBALCAJA(range, GLOBALCAJA_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnGLOBALCAJA(range, GLOBALCAJA_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnGLOBALCAJA(range, GLOBALCAJA_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnGLOBALCAJA(range, GLOBALCAJA_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnGLOBALCAJA(range, GLOBALCAJA_COL_STATUS);

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

    var opportunity = sheet.getRange(row, GLOBALCAJA_COL_OPPORT).getValue();

    if (isEmptyGLOBALCAJA(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, GLOBALCAJA_COL_ITEM_ID).clearContent();
        sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusGLOBALCAJA(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyGLOBALCAJA(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesGLOBALCAJA(sheet.getRange(row, GLOBALCAJA_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesGLOBALCAJA(sheet.getRange(row, GLOBALCAJA_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusGLOBALCAJA(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, GLOBALCAJA_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, GLOBALCAJA_COL_STATUS).getValue();

      if (!isEmptyGLOBALCAJA(timestamp) || statusLooksClosedGLOBALCAJA(status)) {
        sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NGLOBALCAJA(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NGLOBALCAJA(sheet, row, options) {
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

  var data = getRowSnapshotGLOBALCAJA(sheet, row);

  if (isEmptyGLOBALCAJA(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyGLOBALCAJA(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkGLOBALCAJA(data.status)) {
    sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionGLOBALCAJA(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyGLOBALCAJA(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedGLOBALCAJA(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedGLOBALCAJA(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisGLOBALCAJA(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < GLOBALCAJA_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoGLOBALCAJA(data.itemID, action);

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
function postToN8NGLOBALCAJA(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyGLOBALCAJA(sheet, row, false);

    if (!ready) {
      Logger.log("GLOBALCAJA fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusGLOBALCAJA(sheet, row)) {
      Logger.log('GLOBALCAJA fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NGLOBALCAJA(sheet, row, options);

    if (!validation.ok) {
      Logger.log("GLOBALCAJA fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedGLOBALCAJA(currentProcessStatus)) {
        sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowGLOBALCAJA(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendGLOBALCAJA(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("GLOBALCAJA fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedGLOBALCAJA(currentStatus)) {
        sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowGLOBALCAJA(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, GLOBALCAJA_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowGLOBALCAJA(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanGLOBALCAJA(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, GLOBALCAJA_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_globalcaja_opportunity_id"] = opportunityId;

    payload["_globalcaja_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_globalcaja_row"] = row;
    payload["_globalcaja_item_id"] = sheet.getRange(row, GLOBALCAJA_COL_ITEM_ID).getValue();
    payload["_globalcaja_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(GLOBALCAJA_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST GLOBALCAJA - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusGLOBALCAJA(sheet, row)) {
      Logger.log('GLOBALCAJA fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedGLOBALCAJA(currentProcessStatusAfterPost)) {
      Logger.log("GLOBALCAJA fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowGLOBALCAJA(now)
      );
    } else {
      sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting GLOBALCAJA to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja GLOBALCAJA: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en Globalcaja Test.
 ***************/
function procesarFilasCreadasPorScriptGLOBALCAJA(startRow, numRows) {
  var sheet = getSheetGLOBALCAJA();

  if (!sheet) {
    Logger.log("Hoja Globalcaja Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsGLOBALCAJA(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NGLOBALCAJA(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptGLOBALCAJA(row) {
  procesarFilasCreadasPorScriptGLOBALCAJA(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesGLOBALCAJA() {
  var sheet = getSheetGLOBALCAJA();

  if (!sheet) {
    Logger.log("Hoja Globalcaja Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Globalcaja");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, GLOBALCAJA_COL_OPPORT).getValue();

    if (isEmptyGLOBALCAJA(opportunity)) continue;

    if (syncProcessStatusFromStatusGLOBALCAJA(sheet, row)) {
      Logger.log('GLOBALCAJA fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotGLOBALCAJA(sheet, row);

    if (statusLooksClosedGLOBALCAJA(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyGLOBALCAJA(dataBefore.itemID) &&
      isEmptyGLOBALCAJA(dataBefore.enviar) &&
      isEmptyGLOBALCAJA(dataBefore.autorizacion) &&
      isEmptyGLOBALCAJA(dataBefore.timestamp) &&
      !statusLooksClosedGLOBALCAJA(dataBefore.status);

    ensureRowReadyGLOBALCAJA(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NGLOBALCAJA(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("GLOBALCAJA fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila GLOBALCAJA pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesGLOBALCAJA"
    );

    postToN8NGLOBALCAJA(sheet, rowsToSend[i], {
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
function checkCompletadosGLOBALCAJA() {
  var sheet = getSheetGLOBALCAJA();

  if (!sheet) {
    Logger.log("Hoja Globalcaja Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Globalcaja");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, GLOBALCAJA_COL_OPPORT).getValue();

    if (isEmptyGLOBALCAJA(opportunity)) continue;

    var itemID = sheet.getRange(row, GLOBALCAJA_COL_ITEM_ID).getValue();

    if (isEmptyGLOBALCAJA(itemID)) {
      sheet.getRange(row, GLOBALCAJA_COL_ITEM_ID).setValue(generateUIDGLOBALCAJA());
    }

    if (syncProcessStatusFromStatusGLOBALCAJA(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, GLOBALCAJA_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, GLOBALCAJA_COL_STATUS).getValue();

    if (!isEmptyGLOBALCAJA(timestamp) || statusLooksClosedGLOBALCAJA(status)) {
      sheet.getRange(row, GLOBALCAJA_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaGLOBALCAJA(row) {
  var sheet = getSheetGLOBALCAJA();

  if (!sheet) {
    Logger.log("Hoja Globalcaja Test no encontrada");
    return;
  }

  var data = getRowSnapshotGLOBALCAJA(sheet, row);

  Logger.log("===== DIAGNÓSTICO GLOBALCAJA FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedGLOBALCAJA(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedGLOBALCAJA(data.processStatus));

  var validation = shouldSendToN8NGLOBALCAJA(sheet, row, {
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
function recrearTriggerGLOBALCAJA() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditGLOBALCAJA") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditGLOBALCAJA ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditGLOBALCAJA")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditGLOBALCAJA creado correctamente.");
}