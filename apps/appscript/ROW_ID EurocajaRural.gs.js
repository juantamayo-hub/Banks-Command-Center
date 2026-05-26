/***************
 * CONFIG EUROCAJARURAL AUTO
 ***************/
var EUROCAJARURAL_SHEET_NAME = "EuroCajaRural Test";

var EUROCAJARURAL_COL_OPPORT = 1;          // A - Opportunity
var EUROCAJARURAL_COL_ENVIAR = 7;          // G - Enviar
var EUROCAJARURAL_COL_AUTORIZACION = 8;    // H - Autorización
var EUROCAJARURAL_COL_TIMESTAMP = 10;      // J - Timestamp sent
var EUROCAJARURAL_COL_STATUS = 11;         // K - Status
var EUROCAJARURAL_COL_ITEM_ID = 18;        // R - ITEM ID
var EUROCAJARURAL_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var EUROCAJARURAL_COL_PROCESS_STATUS = 20; // T - Process Status

var EUROCAJARURAL_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-eurocajarural";

var EUROCAJARURAL_DUPLICATE_WINDOW_SECONDS = 20;
var EUROCAJARURAL_AUTO_RETRY_AFTER_MINUTES = 10;
var EUROCAJARURAL_PROP_PREFIX = "EUROCAJARURAL_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDEUROCAJARURAL() {
  return Utilities.getUuid();
}

function isEmptyEUROCAJARURAL(value) {
  return value === "" || value === null || value === undefined;
}

function cleanEUROCAJARURAL(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerEUROCAJARURAL(value) {
  return cleanEUROCAJARURAL(value).toLowerCase();
}

function isYesEUROCAJARURAL(value) {
  return lowerEUROCAJARURAL(value) === "yes";
}

function isStatusEnviadoOkEUROCAJARURAL(value) {
  return cleanEUROCAJARURAL(value) === "Enviado ✅";
}

function rangeTouchesColumnEUROCAJARURAL(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedEUROCAJARURAL(value) {
  var s = lowerEUROCAJARURAL(value);

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

function dateToMillisEUROCAJARURAL(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyEUROCAJARURAL(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowEUROCAJARURAL(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetEUROCAJARURAL() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EUROCAJARURAL_SHEET_NAME);
}

function getRowSnapshotEUROCAJARURAL(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, EUROCAJARURAL_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, EUROCAJARURAL_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, EUROCAJARURAL_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, EUROCAJARURAL_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, EUROCAJARURAL_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, EUROCAJARURAL_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, EUROCAJARURAL_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusEUROCAJARURAL(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, EUROCAJARURAL_COL_STATUS).getValue();

  if (isStatusEnviadoOkEUROCAJARURAL(status)) {
    sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionEUROCAJARURAL(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesEUROCAJARURAL(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesEUROCAJARURAL(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesEUROCAJARURAL(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesEUROCAJARURAL(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyEUROCAJARURAL(itemID, action) {
  var safeItemID = cleanEUROCAJARURAL(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return EUROCAJARURAL_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoEUROCAJARURAL(itemID, action) {
  var key = getDuplicateKeyEUROCAJARURAL(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < EUROCAJARURAL_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendEUROCAJARURAL(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyEUROCAJARURAL(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < EUROCAJARURAL_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyEUROCAJARURAL(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, EUROCAJARURAL_COL_OPPORT).getValue();

  if (isEmptyEUROCAJARURAL(opportunity)) {
    sheet.getRange(row, EUROCAJARURAL_COL_ITEM_ID).clearContent();
    sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, EUROCAJARURAL_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyEUROCAJARURAL(itemID)) {
    itemID = generateUIDEUROCAJARURAL();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusEUROCAJARURAL(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedEUROCAJARURAL(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanEUROCAJARURAL(sheet.getRange(row, EUROCAJARURAL_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, EUROCAJARURAL_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, EUROCAJARURAL_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, EUROCAJARURAL_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, EUROCAJARURAL_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, EUROCAJARURAL_COL_AUTORIZACION).getValue();

  if (!isEmptyEUROCAJARURAL(timestamp) || statusLooksClosedEUROCAJARURAL(status)) {
    sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesEUROCAJARURAL(enviarVal) || isYesEUROCAJARURAL(autorizacionVal)) {
    sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsEUROCAJARURAL(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, EUROCAJARURAL_COL_OPPORT).getValue();

    if (isEmptyEUROCAJARURAL(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusEUROCAJARURAL(sheet, row)) {
      continue;
    }

    ensureRowReadyEUROCAJARURAL(sheet, row, forceEnviarYes);

    var data = getRowSnapshotEUROCAJARURAL(sheet, row);

    if (isYesEUROCAJARURAL(data.enviar) || isYesEUROCAJARURAL(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT EUROCAJARURAL
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditEUROCAJARURAL(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== EUROCAJARURAL_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnEUROCAJARURAL(range, EUROCAJARURAL_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnEUROCAJARURAL(range, EUROCAJARURAL_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnEUROCAJARURAL(range, EUROCAJARURAL_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnEUROCAJARURAL(range, EUROCAJARURAL_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnEUROCAJARURAL(range, EUROCAJARURAL_COL_STATUS);

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

    var opportunity = sheet.getRange(row, EUROCAJARURAL_COL_OPPORT).getValue();

    if (isEmptyEUROCAJARURAL(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, EUROCAJARURAL_COL_ITEM_ID).clearContent();
        sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusEUROCAJARURAL(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyEUROCAJARURAL(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesEUROCAJARURAL(sheet.getRange(row, EUROCAJARURAL_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesEUROCAJARURAL(sheet.getRange(row, EUROCAJARURAL_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusEUROCAJARURAL(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, EUROCAJARURAL_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, EUROCAJARURAL_COL_STATUS).getValue();

      if (!isEmptyEUROCAJARURAL(timestamp) || statusLooksClosedEUROCAJARURAL(status)) {
        sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NEUROCAJARURAL(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NEUROCAJARURAL(sheet, row, options) {
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

  var data = getRowSnapshotEUROCAJARURAL(sheet, row);

  if (isEmptyEUROCAJARURAL(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyEUROCAJARURAL(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkEUROCAJARURAL(data.status)) {
    sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionEUROCAJARURAL(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyEUROCAJARURAL(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedEUROCAJARURAL(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedEUROCAJARURAL(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisEUROCAJARURAL(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < EUROCAJARURAL_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoEUROCAJARURAL(data.itemID, action);

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
function postToN8NEUROCAJARURAL(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyEUROCAJARURAL(sheet, row, false);

    if (!ready) {
      Logger.log("EUROCAJARURAL fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusEUROCAJARURAL(sheet, row)) {
      Logger.log('EUROCAJARURAL fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NEUROCAJARURAL(sheet, row, options);

    if (!validation.ok) {
      Logger.log("EUROCAJARURAL fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedEUROCAJARURAL(currentProcessStatus)) {
        sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowEUROCAJARURAL(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendEUROCAJARURAL(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("EUROCAJARURAL fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedEUROCAJARURAL(currentStatus)) {
        sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowEUROCAJARURAL(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, EUROCAJARURAL_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowEUROCAJARURAL(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanEUROCAJARURAL(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, EUROCAJARURAL_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_eurocajarural_opportunity_id"] = opportunityId;

    payload["_eurocajarural_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_eurocajarural_row"] = row;
    payload["_eurocajarural_item_id"] = sheet.getRange(row, EUROCAJARURAL_COL_ITEM_ID).getValue();
    payload["_eurocajarural_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(EUROCAJARURAL_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST EUROCAJARURAL - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusEUROCAJARURAL(sheet, row)) {
      Logger.log('EUROCAJARURAL fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedEUROCAJARURAL(currentProcessStatusAfterPost)) {
      Logger.log("EUROCAJARURAL fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowEUROCAJARURAL(now)
      );
    } else {
      sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting EUROCAJARURAL to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja EUROCAJARURAL: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en EuroCajaRural Test.
 ***************/
function procesarFilasCreadasPorScriptEUROCAJARURAL(startRow, numRows) {
  var sheet = getSheetEUROCAJARURAL();

  if (!sheet) {
    Logger.log("Hoja EuroCajaRural Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsEUROCAJARURAL(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NEUROCAJARURAL(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptEUROCAJARURAL(row) {
  procesarFilasCreadasPorScriptEUROCAJARURAL(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 *
 * Útil para recuperar filas que entraron por script
 * pero no llamaron procesarFilasCreadasPorScriptEUROCAJARURAL.
 ***************/
function checkPendientesEUROCAJARURAL() {
  var sheet = getSheetEUROCAJARURAL();

  if (!sheet) {
    Logger.log("Hoja EuroCajaRural Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en EuroCajaRural");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, EUROCAJARURAL_COL_OPPORT).getValue();

    if (isEmptyEUROCAJARURAL(opportunity)) continue;

    if (syncProcessStatusFromStatusEUROCAJARURAL(sheet, row)) {
      Logger.log('EUROCAJARURAL fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotEUROCAJARURAL(sheet, row);

    if (statusLooksClosedEUROCAJARURAL(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyEUROCAJARURAL(dataBefore.itemID) &&
      isEmptyEUROCAJARURAL(dataBefore.enviar) &&
      isEmptyEUROCAJARURAL(dataBefore.autorizacion) &&
      isEmptyEUROCAJARURAL(dataBefore.timestamp) &&
      !statusLooksClosedEUROCAJARURAL(dataBefore.status);

    ensureRowReadyEUROCAJARURAL(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NEUROCAJARURAL(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("EUROCAJARURAL fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila EUROCAJARURAL pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesEUROCAJARURAL"
    );

    postToN8NEUROCAJARURAL(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD CON TRIGGER ANTIGUO
 *
 * Si ya tienes trigger llamado checkCompletadosEUROCAJARURAL,
 * esta función no rompe nada. No envía a n8n.
 ***************/
function checkCompletadosEUROCAJARURAL() {
  var sheet = getSheetEUROCAJARURAL();

  if (!sheet) {
    Logger.log("Hoja EuroCajaRural Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en EuroCajaRural");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, EUROCAJARURAL_COL_OPPORT).getValue();

    if (isEmptyEUROCAJARURAL(opportunity)) continue;

    var itemID = sheet.getRange(row, EUROCAJARURAL_COL_ITEM_ID).getValue();

    if (isEmptyEUROCAJARURAL(itemID)) {
      sheet.getRange(row, EUROCAJARURAL_COL_ITEM_ID).setValue(generateUIDEUROCAJARURAL());
    }

    if (syncProcessStatusFromStatusEUROCAJARURAL(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, EUROCAJARURAL_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, EUROCAJARURAL_COL_STATUS).getValue();

    if (!isEmptyEUROCAJARURAL(timestamp) || statusLooksClosedEUROCAJARURAL(status)) {
      sheet.getRange(row, EUROCAJARURAL_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 *
 * Ejecuta diagnosticarFilaEUROCAJARURAL(353), por ejemplo.
 ***************/
function diagnosticarFilaEUROCAJARURAL(row) {
  var sheet = getSheetEUROCAJARURAL();

  if (!sheet) {
    Logger.log("Hoja EuroCajaRural Test no encontrada");
    return;
  }

  var data = getRowSnapshotEUROCAJARURAL(sheet, row);

  Logger.log("===== DIAGNÓSTICO EUROCAJARURAL FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedEUROCAJARURAL(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedEUROCAJARURAL(data.processStatus));

  var validation = shouldSendToN8NEUROCAJARURAL(sheet, row, {
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
 * Úsalo solo si no tienes ya el trigger onEditEUROCAJARURAL.
 ***************/
function recrearTriggerEUROCAJARURAL() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditEUROCAJARURAL") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditEUROCAJARURAL ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditEUROCAJARURAL")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditEUROCAJARURAL creado correctamente.");
}