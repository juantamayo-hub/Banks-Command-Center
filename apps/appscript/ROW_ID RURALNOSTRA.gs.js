/***************
 * CONFIG RURALNOSTRA AUTO
 ***************/
var RURALNOSTRA_SHEET_NAME = "Ruralnostra";

var RURALNOSTRA_COL_OPPORT = 1;          // A - Opportunity
var RURALNOSTRA_COL_ENVIAR = 7;          // G - Enviar
var RURALNOSTRA_COL_AUTORIZACION = 8;    // H - Autorización
var RURALNOSTRA_COL_TIMESTAMP = 10;      // J - Timestamp sent
var RURALNOSTRA_COL_STATUS = 11;         // K - Status
var RURALNOSTRA_COL_ITEM_ID = 18;        // R - ITEM ID
var RURALNOSTRA_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var RURALNOSTRA_COL_PROCESS_STATUS = 20; // T - Process Status

var RURALNOSTRA_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/Ruralnostra-dossier";

var RURALNOSTRA_DUPLICATE_WINDOW_SECONDS = 20;
var RURALNOSTRA_AUTO_RETRY_AFTER_MINUTES = 10;
var RURALNOSTRA_PROP_PREFIX = "RURALNOSTRA_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDRuralnostra() {
  return Utilities.getUuid();
}

function isEmptyRuralnostra(value) {
  return value === "" || value === null || value === undefined;
}

function cleanRuralnostra(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerRuralnostra(value) {
  return cleanRuralnostra(value).toLowerCase();
}

function isYesRuralnostra(value) {
  return lowerRuralnostra(value) === "yes";
}

function isStatusEnviadoOkRuralnostra(value) {
  return cleanRuralnostra(value) === "Enviado ✅";
}

function rangeTouchesColumnRuralnostra(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedRuralnostra(value) {
  var s = lowerRuralnostra(value);

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

function dateToMillisRuralnostra(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyRuralnostra(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowRuralnostra(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetRuralnostra() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RURALNOSTRA_SHEET_NAME);
}

function getRowSnapshotRuralnostra(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, RURALNOSTRA_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, RURALNOSTRA_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, RURALNOSTRA_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, RURALNOSTRA_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, RURALNOSTRA_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, RURALNOSTRA_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, RURALNOSTRA_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusRuralnostra(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, RURALNOSTRA_COL_STATUS).getValue();

  if (isStatusEnviadoOkRuralnostra(status)) {
    sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionRuralnostra(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesRuralnostra(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesRuralnostra(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesRuralnostra(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesRuralnostra(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyRuralnostra(itemID, action) {
  var safeItemID = cleanRuralnostra(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return RURALNOSTRA_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoRuralnostra(itemID, action) {
  var key = getDuplicateKeyRuralnostra(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < RURALNOSTRA_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendRuralnostra(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyRuralnostra(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < RURALNOSTRA_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyRuralnostra(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, RURALNOSTRA_COL_OPPORT).getValue();

  if (isEmptyRuralnostra(opportunity)) {
    sheet.getRange(row, RURALNOSTRA_COL_ITEM_ID).clearContent();
    sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, RURALNOSTRA_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyRuralnostra(itemID)) {
    itemID = generateUIDRuralnostra();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusRuralnostra(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedRuralnostra(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanRuralnostra(sheet.getRange(row, RURALNOSTRA_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, RURALNOSTRA_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, RURALNOSTRA_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, RURALNOSTRA_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, RURALNOSTRA_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, RURALNOSTRA_COL_AUTORIZACION).getValue();

  if (!isEmptyRuralnostra(timestamp) || statusLooksClosedRuralnostra(status)) {
    sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesRuralnostra(enviarVal) || isYesRuralnostra(autorizacionVal)) {
    sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsRuralnostra(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, RURALNOSTRA_COL_OPPORT).getValue();

    if (isEmptyRuralnostra(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusRuralnostra(sheet, row)) {
      continue;
    }

    ensureRowReadyRuralnostra(sheet, row, forceEnviarYes);

    var data = getRowSnapshotRuralnostra(sheet, row);

    if (isYesRuralnostra(data.enviar) || isYesRuralnostra(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT RURALNOSTRA
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditRuralnostra(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== RURALNOSTRA_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnRuralnostra(range, RURALNOSTRA_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnRuralnostra(range, RURALNOSTRA_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnRuralnostra(range, RURALNOSTRA_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnRuralnostra(range, RURALNOSTRA_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnRuralnostra(range, RURALNOSTRA_COL_STATUS);

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

    var opportunity = sheet.getRange(row, RURALNOSTRA_COL_OPPORT).getValue();

    if (isEmptyRuralnostra(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, RURALNOSTRA_COL_ITEM_ID).clearContent();
        sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusRuralnostra(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyRuralnostra(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesRuralnostra(sheet.getRange(row, RURALNOSTRA_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesRuralnostra(sheet.getRange(row, RURALNOSTRA_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusRuralnostra(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, RURALNOSTRA_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, RURALNOSTRA_COL_STATUS).getValue();

      if (!isEmptyRuralnostra(timestamp) || statusLooksClosedRuralnostra(status)) {
        sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NRuralnostra(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NRuralnostra(sheet, row, options) {
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

  var data = getRowSnapshotRuralnostra(sheet, row);

  if (isEmptyRuralnostra(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyRuralnostra(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkRuralnostra(data.status)) {
    sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionRuralnostra(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyRuralnostra(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedRuralnostra(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedRuralnostra(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisRuralnostra(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < RURALNOSTRA_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoRuralnostra(data.itemID, action);

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
function postToN8NRuralnostra(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyRuralnostra(sheet, row, false);

    if (!ready) {
      Logger.log("Ruralnostra fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusRuralnostra(sheet, row)) {
      Logger.log('Ruralnostra fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NRuralnostra(sheet, row, options);

    if (!validation.ok) {
      Logger.log("Ruralnostra fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedRuralnostra(currentProcessStatus)) {
        sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowRuralnostra(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendRuralnostra(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("Ruralnostra fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedRuralnostra(currentStatus)) {
        sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowRuralnostra(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, RURALNOSTRA_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowRuralnostra(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanRuralnostra(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, RURALNOSTRA_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_ruralnostra_opportunity_id"] = opportunityId;

    payload["_ruralnostra_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_ruralnostra_row"] = row;
    payload["_ruralnostra_item_id"] = sheet.getRange(row, RURALNOSTRA_COL_ITEM_ID).getValue();
    payload["_ruralnostra_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(RURALNOSTRA_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST Ruralnostra - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusRuralnostra(sheet, row)) {
      Logger.log('Ruralnostra fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedRuralnostra(currentProcessStatusAfterPost)) {
      Logger.log("Ruralnostra fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowRuralnostra(now)
      );
    } else {
      sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting Ruralnostra to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja Ruralnostra: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en Ruralnostra.
 ***************/
function procesarFilasCreadasPorScriptRuralnostra(startRow, numRows) {
  var sheet = getSheetRuralnostra();

  if (!sheet) {
    Logger.log("Hoja Ruralnostra no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsRuralnostra(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NRuralnostra(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptRuralnostra(row) {
  procesarFilasCreadasPorScriptRuralnostra(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 *
 * Útil para recuperar filas que entraron por script
 * pero no llamaron procesarFilasCreadasPorScriptRuralnostra.
 ***************/
function checkPendientesRuralnostra() {
  var sheet = getSheetRuralnostra();

  if (!sheet) {
    Logger.log("Hoja Ruralnostra no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Ruralnostra");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, RURALNOSTRA_COL_OPPORT).getValue();

    if (isEmptyRuralnostra(opportunity)) continue;

    if (syncProcessStatusFromStatusRuralnostra(sheet, row)) {
      Logger.log('Ruralnostra fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotRuralnostra(sheet, row);

    if (statusLooksClosedRuralnostra(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyRuralnostra(dataBefore.itemID) &&
      isEmptyRuralnostra(dataBefore.enviar) &&
      isEmptyRuralnostra(dataBefore.autorizacion) &&
      isEmptyRuralnostra(dataBefore.timestamp) &&
      !statusLooksClosedRuralnostra(dataBefore.status);

    ensureRowReadyRuralnostra(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NRuralnostra(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("Ruralnostra fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila Ruralnostra pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesRuralnostra"
    );

    postToN8NRuralnostra(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD CON TRIGGER ANTIGUO
 *
 * Si ya tienes trigger llamado checkCompletadosRuralnostra,
 * esta función no rompe nada. No envía a n8n.
 ***************/
function checkCompletadosRuralnostra() {
  var sheet = getSheetRuralnostra();

  if (!sheet) {
    Logger.log("Hoja Ruralnostra no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Ruralnostra");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, RURALNOSTRA_COL_OPPORT).getValue();

    if (isEmptyRuralnostra(opportunity)) continue;

    var itemID = sheet.getRange(row, RURALNOSTRA_COL_ITEM_ID).getValue();

    if (isEmptyRuralnostra(itemID)) {
      sheet.getRange(row, RURALNOSTRA_COL_ITEM_ID).setValue(generateUIDRuralnostra());
    }

    if (syncProcessStatusFromStatusRuralnostra(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, RURALNOSTRA_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, RURALNOSTRA_COL_STATUS).getValue();

    if (!isEmptyRuralnostra(timestamp) || statusLooksClosedRuralnostra(status)) {
      sheet.getRange(row, RURALNOSTRA_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 *
 * Ejecuta diagnosticarFilaRuralnostra(353), por ejemplo.
 ***************/
function diagnosticarFilaRuralnostra(row) {
  var sheet = getSheetRuralnostra();

  if (!sheet) {
    Logger.log("Hoja Ruralnostra no encontrada");
    return;
  }

  var data = getRowSnapshotRuralnostra(sheet, row);

  Logger.log("===== DIAGNÓSTICO Ruralnostra FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedRuralnostra(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedRuralnostra(data.processStatus));

  var validation = shouldSendToN8NRuralnostra(sheet, row, {
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
 * Úsalo solo si no tienes ya el trigger onEditRuralnostra.
 ***************/
function recrearTriggerRuralnostra() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditRuralnostra") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditRuralnostra ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditRuralnostra")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditRuralnostra creado correctamente.");
}