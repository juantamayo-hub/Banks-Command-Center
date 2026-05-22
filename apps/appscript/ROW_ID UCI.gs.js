/***************
 * CONFIG UCI AUTO
 ***************/
var UCI_SHEET_NAME = "UCI";

var UCI_COL_OPPORT = 1;          // A - Opportunity
var UCI_COL_ENVIAR = 7;          // G - Enviar
var UCI_COL_AUTORIZACION = 8;    // H - Autorización
var UCI_COL_TIMESTAMP = 10;      // J - Timestamp sent
var UCI_COL_STATUS = 11;         // K - Status
var UCI_COL_ITEM_ID = 18;        // R - ITEM ID
var UCI_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var UCI_COL_PROCESS_STATUS = 20; // T - Process Status

var UCI_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-hipotecascom";

var UCI_DUPLICATE_WINDOW_SECONDS = 20;
var UCI_AUTO_RETRY_AFTER_MINUTES = 10;
var UCI_PROP_PREFIX = "UCI_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDUCI() {
  return Utilities.getUuid();
}

function isEmptyUCI(value) {
  return value === "" || value === null || value === undefined;
}

function cleanUCI(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerUCI(value) {
  return cleanUCI(value).toLowerCase();
}

function isYesUCI(value) {
  return lowerUCI(value) === "yes";
}

function isStatusEnviadoOkUCI(value) {
  return cleanUCI(value) === "Enviado ✅";
}

function rangeTouchesColumnUCI(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedUCI(value) {
  var s = lowerUCI(value);

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

function dateToMillisUCI(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyUCI(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowUCI(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetUCI() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(UCI_SHEET_NAME);
}

function getRowSnapshotUCI(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, UCI_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, UCI_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, UCI_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, UCI_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, UCI_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, UCI_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, UCI_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, UCI_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusUCI(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, UCI_COL_STATUS).getValue();

  if (isStatusEnviadoOkUCI(status)) {
    sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionUCI(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesUCI(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesUCI(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesUCI(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesUCI(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyUCI(itemID, action) {
  var safeItemID = cleanUCI(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return UCI_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoUCI(itemID, action) {
  var key = getDuplicateKeyUCI(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < UCI_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendUCI(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyUCI(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < UCI_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyUCI(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, UCI_COL_OPPORT).getValue();

  if (isEmptyUCI(opportunity)) {
    sheet.getRange(row, UCI_COL_ITEM_ID).clearContent();
    sheet.getRange(row, UCI_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, UCI_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyUCI(itemID)) {
    itemID = generateUIDUCI();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusUCI(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, UCI_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedUCI(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanUCI(sheet.getRange(row, UCI_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, UCI_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, UCI_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, UCI_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, UCI_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, UCI_COL_AUTORIZACION).getValue();

  if (!isEmptyUCI(timestamp) || statusLooksClosedUCI(status)) {
    sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesUCI(enviarVal) || isYesUCI(autorizacionVal)) {
    sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsUCI(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, UCI_COL_OPPORT).getValue();

    if (isEmptyUCI(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusUCI(sheet, row)) {
      continue;
    }

    ensureRowReadyUCI(sheet, row, forceEnviarYes);

    var data = getRowSnapshotUCI(sheet, row);

    if (isYesUCI(data.enviar) || isYesUCI(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT UCI
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditUCI(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== UCI_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnUCI(range, UCI_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnUCI(range, UCI_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnUCI(range, UCI_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnUCI(range, UCI_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnUCI(range, UCI_COL_STATUS);

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

    var opportunity = sheet.getRange(row, UCI_COL_OPPORT).getValue();

    if (isEmptyUCI(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, UCI_COL_ITEM_ID).clearContent();
        sheet.getRange(row, UCI_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusUCI(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyUCI(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesUCI(sheet.getRange(row, UCI_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesUCI(sheet.getRange(row, UCI_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusUCI(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, UCI_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, UCI_COL_STATUS).getValue();

      if (!isEmptyUCI(timestamp) || statusLooksClosedUCI(status)) {
        sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NUCI(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NUCI(sheet, row, options) {
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

  var data = getRowSnapshotUCI(sheet, row);

  if (isEmptyUCI(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyUCI(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkUCI(data.status)) {
    sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionUCI(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyUCI(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedUCI(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedUCI(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisUCI(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < UCI_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoUCI(data.itemID, action);

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
function postToN8NUCI(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyUCI(sheet, row, false);

    if (!ready) {
      Logger.log("UCI fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusUCI(sheet, row)) {
      Logger.log('UCI fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NUCI(sheet, row, options);

    if (!validation.ok) {
      Logger.log("UCI fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, UCI_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedUCI(currentProcessStatus)) {
        sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowUCI(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendUCI(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("UCI fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, UCI_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedUCI(currentStatus)) {
        sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowUCI(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, UCI_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowUCI(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanUCI(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    var opportunityId = sheet.getRange(row, UCI_COL_OPPORT).getValue();

    payload["Opportunity ID"] = opportunityId;
    payload["Opportunity"] = opportunityId;
    payload["_uci_opportunity_id"] = opportunityId;

    payload["_uci_action"] = validation.action;
    payload["_uci_row"] = row;
    payload["_uci_item_id"] = sheet.getRange(row, UCI_COL_ITEM_ID).getValue();
    payload["_uci_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(UCI_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST UCI - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusUCI(sheet, row)) {
      Logger.log('UCI fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, UCI_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedUCI(currentProcessStatusAfterPost)) {
      Logger.log("UCI fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowUCI(now)
      );
    } else {
      sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting UCI to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, UCI_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja UCI: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta función debe llamarla el script distribuidor
 * cuando crea filas en UCI.
 ***************/
function procesarFilasCreadasPorScriptUCI(startRow, numRows) {
  var sheet = getSheetUCI();

  if (!sheet) {
    Logger.log("Hoja UCI no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsUCI(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NUCI(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptUCI(row) {
  procesarFilasCreadasPorScriptUCI(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 ***************/
function checkPendientesUCI() {
  var sheet = getSheetUCI();

  if (!sheet) {
    Logger.log("Hoja UCI no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en UCI");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, UCI_COL_OPPORT).getValue();

    if (isEmptyUCI(opportunity)) continue;

    if (syncProcessStatusFromStatusUCI(sheet, row)) {
      Logger.log('UCI fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotUCI(sheet, row);

    if (statusLooksClosedUCI(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyUCI(dataBefore.itemID) &&
      isEmptyUCI(dataBefore.enviar) &&
      isEmptyUCI(dataBefore.autorizacion) &&
      isEmptyUCI(dataBefore.timestamp) &&
      !statusLooksClosedUCI(dataBefore.status);

    ensureRowReadyUCI(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NUCI(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("UCI fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila UCI pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesUCI"
    );

    postToN8NUCI(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * DIAGNÓSTICO POR FILA
 ***************/
function diagnosticarFilaUCI(row) {
  var sheet = getSheetUCI();

  if (!sheet) {
    Logger.log("Hoja UCI no encontrada");
    return;
  }

  var data = getRowSnapshotUCI(sheet, row);

  Logger.log("===== DIAGNÓSTICO UCI FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedUCI(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedUCI(data.processStatus));

  var validation = shouldSendToN8NUCI(sheet, row, {
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
function recrearTriggerUCI() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditUCI") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditUCI ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditUCI")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditUCI creado correctamente.");
}