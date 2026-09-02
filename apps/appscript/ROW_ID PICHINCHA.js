/***************
 * CONFIG PICHINCHA AUTO
 ***************/
var PICHINCHA_SHEET_NAME = "Pichincha";

var PICHINCHA_COL_OPPORT = 1;          // A - Opportunity
var PICHINCHA_COL_ENVIAR = 7;          // G - Enviar
var PICHINCHA_COL_AUTORIZACION = 8;    // H - Autorización
var PICHINCHA_COL_TIMESTAMP = 10;      // J - Timestamp sent
var PICHINCHA_COL_STATUS = 11;         // K - Status
var PICHINCHA_COL_ITEM_ID = 18;        // R - ITEM ID
var PICHINCHA_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var PICHINCHA_COL_PROCESS_STATUS = 20; // T - Process Status

var N8N_WEBHOOK_PICHINCHA = "https://huspy.app.n8n.cloud/webhook/Pichincha";

var PICHINCHA_DUPLICATE_WINDOW_SECONDS = 20;
var PICHINCHA_AUTO_RETRY_AFTER_MINUTES = 10;
var PICHINCHA_PROP_PREFIX = "PICHINCHA_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDPICHINCHA() {
  return Utilities.getUuid();
}

function rangeTouchesColumnPICHINCHA(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function isEmptyPICHINCHA(value) {
  return value === "" || value === null || value === undefined;
}

function cleanPICHINCHA(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerPICHINCHA(value) {
  return cleanPICHINCHA(value).toLowerCase();
}

function isYesPICHINCHA(value) {
  return lowerPICHINCHA(value) === "yes";
}

function isStatusEnviadoOkPICHINCHA(value) {
  return cleanPICHINCHA(value) === "Enviado ✅";
}

function statusLooksClosedPICHINCHA(value) {
  var s = lowerPICHINCHA(value);

  if (s === "") return false;

  // Evita falsos positivos:
  // "No enviado" contiene "enviado", pero NO debe cerrar la fila.
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

function dateToMillisPICHINCHA(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyPICHINCHA(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowPICHINCHA(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetPICHINCHA() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PICHINCHA_SHEET_NAME);
}

function getRowSnapshotPICHINCHA(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, PICHINCHA_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, PICHINCHA_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, PICHINCHA_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, PICHINCHA_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, PICHINCHA_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, PICHINCHA_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, PICHINCHA_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusPICHINCHA(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, PICHINCHA_COL_STATUS).getValue();

  if (isStatusEnviadoOkPICHINCHA(status)) {
    sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionPICHINCHA(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesPICHINCHA(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesPICHINCHA(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesPICHINCHA(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesPICHINCHA(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyPICHINCHA(itemID, action) {
  var safeItemID = cleanPICHINCHA(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return PICHINCHA_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoPICHINCHA(itemID, action) {
  var key = getDuplicateKeyPICHINCHA(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < PICHINCHA_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

function reserveSendPICHINCHA(key) {
  PropertiesService.getScriptProperties().setProperty(key, String(new Date().getTime()));
}

function tryReserveSendPICHINCHA(key) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < PICHINCHA_DUPLICATE_WINDOW_SECONDS * 1000
    ) {
      var diffSeconds = Math.round((nowMillis - lastMillis) / 1000);

      return {
        ok: false,
        reason: "Bloqueado anti-duplicado. Último envío hace " + diffSeconds + "s"
      };
    }

    props.setProperty(key, String(nowMillis));

    return {
      ok: true
    };

  } finally {
    lock.releaseLock();
  }
}

/***************
 * PREPARAR FILA
 ***************/
function ensureRowReadyPICHINCHA(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, PICHINCHA_COL_OPPORT).getValue();

  if (isEmptyPICHINCHA(opportunity)) {
    sheet.getRange(row, PICHINCHA_COL_ITEM_ID).clearContent();
    sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, PICHINCHA_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyPICHINCHA(itemID)) {
    itemID = generateUIDPICHINCHA();
    itemIDCell.setValue(itemID);
  }

  // Si n8n ya marcó K como "Enviado ✅", cerramos T y no tocamos más.
  if (syncProcessStatusFromStatusPICHINCHA(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).getValue();

  // No pisar estados cerrados.
  if (statusLooksClosedPICHINCHA(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanPICHINCHA(sheet.getRange(row, PICHINCHA_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, PICHINCHA_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, PICHINCHA_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, PICHINCHA_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, PICHINCHA_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, PICHINCHA_COL_AUTORIZACION).getValue();

  if (!isEmptyPICHINCHA(timestamp) || statusLooksClosedPICHINCHA(status)) {
    sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesPICHINCHA(enviarVal) || isYesPICHINCHA(autorizacionVal)) {
    sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsPICHINCHA(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, PICHINCHA_COL_OPPORT).getValue();

    if (isEmptyPICHINCHA(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusPICHINCHA(sheet, row)) {
      continue;
    }

    ensureRowReadyPICHINCHA(sheet, row, forceEnviarYes);

    var data = getRowSnapshotPICHINCHA(sheet, row);

    if (isYesPICHINCHA(data.enviar) || isYesPICHINCHA(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditPICHINCHA(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== PICHINCHA_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnPICHINCHA(range, PICHINCHA_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnPICHINCHA(range, PICHINCHA_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnPICHINCHA(range, PICHINCHA_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnPICHINCHA(range, PICHINCHA_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnPICHINCHA(range, PICHINCHA_COL_STATUS);

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

  /***************
   * FASE 1:
   * Preparar todas las filas antes de enviar a n8n.
   ***************/
  for (var r = 0; r < numRows; r++) {
    var row = startRow + r;

    if (row === 1) continue;

    var opportunity = sheet.getRange(row, PICHINCHA_COL_OPPORT).getValue();

    if (isEmptyPICHINCHA(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, PICHINCHA_COL_ITEM_ID).clearContent();
        sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusPICHINCHA(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyPICHINCHA(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (touchesAutorizacion && isYesPICHINCHA(sheet.getRange(row, PICHINCHA_COL_AUTORIZACION).getValue())) {
        preferredAction = "AUTORIZACION";
      } else if (touchesEnviar && isYesPICHINCHA(sheet.getRange(row, PICHINCHA_COL_ENVIAR).getValue())) {
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
      if (syncProcessStatusFromStatusPICHINCHA(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, PICHINCHA_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, PICHINCHA_COL_STATUS).getValue();

      if (!isEmptyPICHINCHA(timestamp) || statusLooksClosedPICHINCHA(status)) {
        sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  /***************
   * FASE 2:
   * Enviar después de que todas tengan UID / Yes.
   ***************/
  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NPICHINCHA(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NPICHINCHA(sheet, row, options) {
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

  var data = getRowSnapshotPICHINCHA(sheet, row);

  if (isEmptyPICHINCHA(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyPICHINCHA(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkPICHINCHA(data.status)) {
    sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionPICHINCHA(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyPICHINCHA(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedPICHINCHA(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedPICHINCHA(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisPICHINCHA(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < PICHINCHA_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoPICHINCHA(data.itemID, action);

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
function postToN8NPICHINCHA(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyPICHINCHA(sheet, row, false);

    if (!ready) {
      Logger.log("Fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusPICHINCHA(sheet, row)) {
      Logger.log('Fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NPICHINCHA(sheet, row, options);

    if (!validation.ok) {
      Logger.log("Fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedPICHINCHA(currentProcessStatus)) {
        sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowPICHINCHA(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    // Reserva corta.
    // Importante: aquí se usa lock solo unos milisegundos.
    // El webhook NO queda dentro del lock.
    var reservation = tryReserveSendPICHINCHA(validation.key);

    if (!reservation.ok) {
      Logger.log("Fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedPICHINCHA(currentStatus)) {
        sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowPICHINCHA(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, PICHINCHA_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowPICHINCHA(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanPICHINCHA(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    payload["_PICHINCHA_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_PICHINCHA_row"] = row;
    payload["_PICHINCHA_item_id"] = sheet.getRange(row, PICHINCHA_COL_ITEM_ID).getValue();
    payload["_PICHINCHA_attempt_at"] = now.toISOString();

    // Este fetch ya NO está dentro de ningún lock.
    // Por eso otros bancos y otras filas pueden seguir procesando.
    var response = UrlFetchApp.fetch(N8N_WEBHOOK_PICHINCHA, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST PICHINCHA - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusPICHINCHA(sheet, row)) {
      Logger.log('Fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedPICHINCHA(currentProcessStatusAfterPost)) {
      Logger.log("Fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowPICHINCHA(now)
      );
    } else {
      sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error posting to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, PICHINCHA_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta es la función que debe llamar el script distribuidor
 * cuando crea filas en Pichincha.
 ***************/
function procesarFilasCreadasPorScriptPICHINCHA(startRow, numRows) {
  var sheet = getSheetPICHINCHA();

  if (!sheet) {
    Logger.log("Hoja Pichincha no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsPICHINCHA(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NPICHINCHA(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptPICHINCHA(row) {
  procesarFilasCreadasPorScriptPICHINCHA(row, 1);
}


/***************
 * CHECKER MANUAL / TRIGGER DE TIEMPO
 *
 * Útil para recuperar filas que entraron por script
 * pero no llamaron procesarFilasCreadasPorScriptPICHINCHA.
 ***************/
function checkPendientesPICHINCHA() {
  var sheet = getSheetPICHINCHA();

  if (!sheet) {
    Logger.log("Hoja Pichincha no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos");
    return;
  }

  var rowsToSend = [];

  /***************
   * FASE 1:
   * Preparar filas incompletas.
   ***************/
  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, PICHINCHA_COL_OPPORT).getValue();

    if (isEmptyPICHINCHA(opportunity)) continue;

    if (syncProcessStatusFromStatusPICHINCHA(sheet, row)) {
      Logger.log('Fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotPICHINCHA(sheet, row);

    if (statusLooksClosedPICHINCHA(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyPICHINCHA(dataBefore.itemID) &&
      isEmptyPICHINCHA(dataBefore.enviar) &&
      isEmptyPICHINCHA(dataBefore.autorizacion) &&
      isEmptyPICHINCHA(dataBefore.timestamp) &&
      !statusLooksClosedPICHINCHA(dataBefore.status);

    ensureRowReadyPICHINCHA(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NPICHINCHA(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("Fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  /***************
   * FASE 2:
   * Enviar después de preparar todas.
   ***************/
  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log("Enviando fila pendiente " + rowsToSend[i] + " a n8n desde checkPendientesPICHINCHA");

    postToN8NPICHINCHA(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * DIAGNÓSTICO POR FILA
 *
 * Ejecuta diagnosticarFilaPICHINCHA(353), por ejemplo.
 ***************/
function diagnosticarFilaPICHINCHA(row) {
  var sheet = getSheetPICHINCHA();

  if (!sheet) {
    Logger.log("Hoja Pichincha no encontrada");
    return;
  }

  var data = getRowSnapshotPICHINCHA(sheet, row);

  Logger.log("===== DIAGNÓSTICO PICHINCHA FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedPICHINCHA(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedPICHINCHA(data.processStatus));

  var validation = shouldSendToN8NPICHINCHA(sheet, row, {
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
 * Úsalo solo si NO tienes ya el trigger onEditPICHINCHA.
 ***************/
function recrearTriggerPICHINCHA() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditPICHINCHA") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditPICHINCHA ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditPICHINCHA")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditPICHINCHA creado correctamente.");
}


/***************
 * CREAR TRIGGER CHECKER OPCIONAL
 *
 * Úsalo solo si quieres revisar pendientes automáticamente.
 ***************/
function crearTriggerCheckerPICHINCHA() {
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "checkPendientesPICHINCHA") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger checkPendientesPICHINCHA ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("checkPendientesPICHINCHA")
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log("Trigger checkPendientesPICHINCHA creado correctamente.");
}