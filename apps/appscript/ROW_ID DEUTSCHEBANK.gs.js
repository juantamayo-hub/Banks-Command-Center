/***************
 * CONFIG DEUTSCHE AUTO
 ***************/
var DEUTSCHE_SHEET_NAME = "Deutsche Bank Test";

var DEUTSCHE_COL_OPPORT = 1;          // A - Opportunity
var DEUTSCHE_COL_ENVIAR = 7;          // G - Enviar
var DEUTSCHE_COL_AUTORIZACION = 8;    // H - Autorización
var DEUTSCHE_COL_TIMESTAMP = 10;      // J - Timestamp sent
var DEUTSCHE_COL_STATUS = 11;         // K - Status
var DEUTSCHE_COL_ITEM_ID = 18;        // R - ITEM ID
var DEUTSCHE_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var DEUTSCHE_COL_PROCESS_STATUS = 20; // T - Process Status

var DEUTSCHE_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-deutsche-bank";

var DEUTSCHE_DUPLICATE_WINDOW_SECONDS = 20;
var DEUTSCHE_AUTO_RETRY_AFTER_MINUTES = 10;
var DEUTSCHE_PROP_PREFIX = "DEUTSCHE_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDDEUTSCHE() {
  return Utilities.getUuid();
}

function rangeTouchesColumnDEUTSCHE(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;

  return targetCol >= startCol && targetCol <= endCol;
}

function isEmptyDEUTSCHE(value) {
  return value === "" || value === null || value === undefined;
}

function cleanDEUTSCHE(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerDEUTSCHE(value) {
  return cleanDEUTSCHE(value).toLowerCase();
}

function isYesDEUTSCHE(value) {
  return lowerDEUTSCHE(value) === "yes";
}

function isStatusEnviadoOkDEUTSCHE(value) {
  return cleanDEUTSCHE(value) === "Enviado ✅";
}

function statusLooksClosedDEUTSCHE(value) {
  var s = lowerDEUTSCHE(value);

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

function dateToMillisDEUTSCHE(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyDEUTSCHE(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowDEUTSCHE(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetDEUTSCHE() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DEUTSCHE_SHEET_NAME);
}

function getRowSnapshotDEUTSCHE(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, DEUTSCHE_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, DEUTSCHE_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, DEUTSCHE_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, DEUTSCHE_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, DEUTSCHE_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, DEUTSCHE_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, DEUTSCHE_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusDEUTSCHE(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, DEUTSCHE_COL_STATUS).getValue();

  if (isStatusEnviadoOkDEUTSCHE(status)) {
    sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionDEUTSCHE(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesDEUTSCHE(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesDEUTSCHE(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesDEUTSCHE(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesDEUTSCHE(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyDEUTSCHE(itemID, action) {
  var safeItemID = cleanDEUTSCHE(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return DEUTSCHE_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoDEUTSCHE(itemID, action) {
  var key = getDuplicateKeyDEUTSCHE(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < DEUTSCHE_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function tryReserveSendDEUTSCHE(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyDEUTSCHE(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < DEUTSCHE_DUPLICATE_WINDOW_SECONDS * 1000
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
 * Deutsche SÍ es automático:
 * - Cuando entra desde el script distribuidor, se fuerza G = Yes.
 * - Cuando se pega o escribe manualmente en A, también se fuerza G = Yes.
 ***************/
function ensureRowReadyDEUTSCHE(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, DEUTSCHE_COL_OPPORT).getValue();

  if (isEmptyDEUTSCHE(opportunity)) {
    sheet.getRange(row, DEUTSCHE_COL_ITEM_ID).clearContent();
    sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, DEUTSCHE_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyDEUTSCHE(itemID)) {
    itemID = generateUIDDEUTSCHE();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusDEUTSCHE(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedDEUTSCHE(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanDEUTSCHE(sheet.getRange(row, DEUTSCHE_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, DEUTSCHE_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, DEUTSCHE_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, DEUTSCHE_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, DEUTSCHE_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, DEUTSCHE_COL_AUTORIZACION).getValue();

  if (!isEmptyDEUTSCHE(timestamp) || statusLooksClosedDEUTSCHE(status)) {
    sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesDEUTSCHE(enviarVal) || isYesDEUTSCHE(autorizacionVal)) {
    sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsDEUTSCHE(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, DEUTSCHE_COL_OPPORT).getValue();

    if (isEmptyDEUTSCHE(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusDEUTSCHE(sheet, row)) {
      continue;
    }

    ensureRowReadyDEUTSCHE(sheet, row, forceEnviarYes);

    var data = getRowSnapshotDEUTSCHE(sheet, row);

    if (isYesDEUTSCHE(data.enviar) || isYesDEUTSCHE(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT DEUTSCHE
 *
 * Para edición manual o pegado manual en bloque.
 * Si se toca A, fuerza G = Yes y envía.
 * Si se toca G/H, envía según el Yes editado.
 ***************/
function onEditDEUTSCHE(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== DEUTSCHE_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnDEUTSCHE(range, DEUTSCHE_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnDEUTSCHE(range, DEUTSCHE_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnDEUTSCHE(range, DEUTSCHE_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnDEUTSCHE(range, DEUTSCHE_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnDEUTSCHE(range, DEUTSCHE_COL_STATUS);

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

    var opportunity = sheet.getRange(row, DEUTSCHE_COL_OPPORT).getValue();

    if (isEmptyDEUTSCHE(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, DEUTSCHE_COL_ITEM_ID).clearContent();
        sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusDEUTSCHE(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyDEUTSCHE(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (
        touchesAutorizacion &&
        isYesDEUTSCHE(sheet.getRange(row, DEUTSCHE_COL_AUTORIZACION).getValue())
      ) {
        preferredAction = "AUTORIZACION";
      } else if (
        touchesEnviar &&
        isYesDEUTSCHE(sheet.getRange(row, DEUTSCHE_COL_ENVIAR).getValue())
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
      if (syncProcessStatusFromStatusDEUTSCHE(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, DEUTSCHE_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, DEUTSCHE_COL_STATUS).getValue();

      if (!isEmptyDEUTSCHE(timestamp) || statusLooksClosedDEUTSCHE(status)) {
        sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NDEUTSCHE(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NDEUTSCHE(sheet, row, options) {
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

  var data = getRowSnapshotDEUTSCHE(sheet, row);

  if (isEmptyDEUTSCHE(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyDEUTSCHE(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkDEUTSCHE(data.status)) {
    sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionDEUTSCHE(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyDEUTSCHE(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedDEUTSCHE(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedDEUTSCHE(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisDEUTSCHE(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < DEUTSCHE_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoDEUTSCHE(data.itemID, action);

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
function postToN8NDEUTSCHE(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyDEUTSCHE(sheet, row, false);

    if (!ready) {
      Logger.log("DEUTSCHE fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusDEUTSCHE(sheet, row)) {
      Logger.log('DEUTSCHE fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NDEUTSCHE(sheet, row, options);

    if (!validation.ok) {
      Logger.log("DEUTSCHE fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedDEUTSCHE(currentProcessStatus)) {
        sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowDEUTSCHE(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var reservation = tryReserveSendDEUTSCHE(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("DEUTSCHE fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedDEUTSCHE(currentStatus)) {
        sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowDEUTSCHE(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, DEUTSCHE_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowDEUTSCHE(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanDEUTSCHE(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    payload["_deutsche_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_deutsche_row"] = row;
    payload["_deutsche_item_id"] = sheet.getRange(row, DEUTSCHE_COL_ITEM_ID).getValue();
    payload["_deutsche_attempt_at"] = now.toISOString();

    var response = UrlFetchApp.fetch(DEUTSCHE_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST DEUTSCHE - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusDEUTSCHE(sheet, row)) {
      Logger.log('DEUTSCHE fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedDEUTSCHE(currentProcessStatusAfterPost)) {
      Logger.log("DEUTSCHE fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowDEUTSCHE(now)
      );
    } else {
      sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting DEUTSCHE to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja DEUTSCHE: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta es la función que debe llamar el script distribuidor
 * cuando crea filas en Deutsche Bank Test.
 ***************/
function procesarFilasCreadasPorScriptDEUTSCHE(startRow, numRows) {
  var sheet = getSheetDEUTSCHE();

  if (!sheet) {
    Logger.log("Hoja Deutsche Bank Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsDEUTSCHE(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NDEUTSCHE(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptDEUTSCHE(row) {
  procesarFilasCreadasPorScriptDEUTSCHE(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 *
 * Útil para recuperar filas que entraron por script
 * pero no llamaron procesarFilasCreadasPorScriptDEUTSCHE.
 ***************/
function checkPendientesDEUTSCHE() {
  var sheet = getSheetDEUTSCHE();

  if (!sheet) {
    Logger.log("Hoja Deutsche Bank Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Deutsche");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, DEUTSCHE_COL_OPPORT).getValue();

    if (isEmptyDEUTSCHE(opportunity)) continue;

    if (syncProcessStatusFromStatusDEUTSCHE(sheet, row)) {
      Logger.log('DEUTSCHE fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotDEUTSCHE(sheet, row);

    if (statusLooksClosedDEUTSCHE(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyDEUTSCHE(dataBefore.itemID) &&
      isEmptyDEUTSCHE(dataBefore.enviar) &&
      isEmptyDEUTSCHE(dataBefore.autorizacion) &&
      isEmptyDEUTSCHE(dataBefore.timestamp) &&
      !statusLooksClosedDEUTSCHE(dataBefore.status);

    ensureRowReadyDEUTSCHE(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NDEUTSCHE(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("DEUTSCHE fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log(
      "Enviando fila DEUTSCHE pendiente " +
      rowsToSend[i] +
      " a n8n desde checkPendientesDEUTSCHE"
    );

    postToN8NDEUTSCHE(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD CON TRIGGER ANTIGUO
 *
 * Si ya tienes trigger llamado checkCompletadosDEUTSCHE,
 * esta función no rompe nada. No envía a n8n.
 ***************/
function checkCompletadosDEUTSCHE() {
  var sheet = getSheetDEUTSCHE();

  if (!sheet) {
    Logger.log("Hoja Deutsche Bank Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en Deutsche");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, DEUTSCHE_COL_OPPORT).getValue();

    if (isEmptyDEUTSCHE(opportunity)) continue;

    var itemID = sheet.getRange(row, DEUTSCHE_COL_ITEM_ID).getValue();

    if (isEmptyDEUTSCHE(itemID)) {
      sheet.getRange(row, DEUTSCHE_COL_ITEM_ID).setValue(generateUIDDEUTSCHE());
    }

    if (syncProcessStatusFromStatusDEUTSCHE(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, DEUTSCHE_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, DEUTSCHE_COL_STATUS).getValue();

    if (!isEmptyDEUTSCHE(timestamp) || statusLooksClosedDEUTSCHE(status)) {
      sheet.getRange(row, DEUTSCHE_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 *
 * Ejecuta diagnosticarFilaDEUTSCHE(353), por ejemplo.
 ***************/
function diagnosticarFilaDEUTSCHE(row) {
  var sheet = getSheetDEUTSCHE();

  if (!sheet) {
    Logger.log("Hoja Deutsche Bank Test no encontrada");
    return;
  }

  var data = getRowSnapshotDEUTSCHE(sheet, row);

  Logger.log("===== DIAGNÓSTICO DEUTSCHE FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedDEUTSCHE(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedDEUTSCHE(data.processStatus));

  var validation = shouldSendToN8NDEUTSCHE(sheet, row, {
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
 * Úsalo solo si no tienes ya el trigger onEditDEUTSCHE.
 ***************/
function recrearTriggerDEUTSCHE() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditDEUTSCHE") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditDEUTSCHE ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditDEUTSCHE")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditDEUTSCHE creado correctamente.");
}