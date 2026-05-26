/***************
 * CONFIG MYINVESTOR AUTO
 ***************/
var MYINVESTOR_SHEET_NAME = "MyInvestor Test";

var MYINVESTOR_COL_OPPORT = 1;          // A - Opportunity
var MYINVESTOR_COL_ENVIAR = 7;          // G - Enviar
var MYINVESTOR_COL_AUTORIZACION = 8;    // H - Autorización
var MYINVESTOR_COL_TIMESTAMP = 10;      // J - Timestamp sent
var MYINVESTOR_COL_STATUS = 11;         // K - Status
var MYINVESTOR_COL_ITEM_ID = 18;        // R - ITEM ID
var MYINVESTOR_COL_LAST_SENT = 19;      // S - Last sent / TEST TIME
var MYINVESTOR_COL_PROCESS_STATUS = 20; // T - Process Status

var MYINVESTOR_WEBHOOK_URL = "https://huspy.app.n8n.cloud/webhook/send-dossier-MyInvestor";

var MYINVESTOR_DUPLICATE_WINDOW_SECONDS = 20;
var MYINVESTOR_AUTO_RETRY_AFTER_MINUTES = 10;
var MYINVESTOR_PROP_PREFIX = "MYINVESTOR_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDMYINVESTOR() {
  return Utilities.getUuid();
}

function isEmptyMYINVESTOR(value) {
  return value === "" || value === null || value === undefined;
}

function cleanMYINVESTOR(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerMYINVESTOR(value) {
  return cleanMYINVESTOR(value).toLowerCase();
}

function isYesMYINVESTOR(value) {
  return lowerMYINVESTOR(value) === "yes";
}

function isStatusEnviadoOkMYINVESTOR(value) {
  return cleanMYINVESTOR(value) === "Enviado ✅";
}

function rangeTouchesColumnMYINVESTOR(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function statusLooksClosedMYINVESTOR(value) {
  var s = lowerMYINVESTOR(value);

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

function dateToMillisMYINVESTOR(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyMYINVESTOR(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowMYINVESTOR(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetMYINVESTOR() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MYINVESTOR_SHEET_NAME);
}

function getRowSnapshotMYINVESTOR(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, MYINVESTOR_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, MYINVESTOR_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, MYINVESTOR_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, MYINVESTOR_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, MYINVESTOR_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, MYINVESTOR_COL_ITEM_ID).getValue(),
    lastSent: sheet.getRange(row, MYINVESTOR_COL_LAST_SENT).getValue(),
    processStatus: sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusMYINVESTOR(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, MYINVESTOR_COL_STATUS).getValue();

  if (isStatusEnviadoOkMYINVESTOR(status)) {
    sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionMYINVESTOR(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesMYINVESTOR(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesMYINVESTOR(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesMYINVESTOR(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesMYINVESTOR(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyMYINVESTOR(itemID, action) {
  var safeItemID = cleanMYINVESTOR(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return MYINVESTOR_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoMYINVESTOR(itemID, action) {
  var key = getDuplicateKeyMYINVESTOR(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < MYINVESTOR_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

// Reserva corta: usa lock solo para reservar, NO para enviar a n8n.
function tryReserveSendMYINVESTOR(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyMYINVESTOR(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < MYINVESTOR_DUPLICATE_WINDOW_SECONDS * 1000
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
 ***************/
function ensureRowReadyMYINVESTOR(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, MYINVESTOR_COL_OPPORT).getValue();

  if (isEmptyMYINVESTOR(opportunity)) {
    sheet.getRange(row, MYINVESTOR_COL_ITEM_ID).clearContent();
    sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, MYINVESTOR_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyMYINVESTOR(itemID)) {
    itemID = generateUIDMYINVESTOR();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusMYINVESTOR(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedMYINVESTOR(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanMYINVESTOR(sheet.getRange(row, MYINVESTOR_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, MYINVESTOR_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, MYINVESTOR_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, MYINVESTOR_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, MYINVESTOR_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, MYINVESTOR_COL_AUTORIZACION).getValue();

  if (!isEmptyMYINVESTOR(timestamp) || statusLooksClosedMYINVESTOR(status)) {
    sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesMYINVESTOR(enviarVal) || isYesMYINVESTOR(autorizacionVal)) {
    sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsMYINVESTOR(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, MYINVESTOR_COL_OPPORT).getValue();

    if (isEmptyMYINVESTOR(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusMYINVESTOR(sheet, row)) {
      continue;
    }

    ensureRowReadyMYINVESTOR(sheet, row, forceEnviarYes);

    var data = getRowSnapshotMYINVESTOR(sheet, row);

    if (isYesMYINVESTOR(data.enviar) || isYesMYINVESTOR(data.autorizacion)) {
      rowsToSend.push(row);
    }
  }

  SpreadsheetApp.flush();
  return rowsToSend;
}


/***************
 * ON EDIT MYINVESTOR
 *
 * Para edición manual o pegado manual en bloque.
 ***************/
function onEditMYINVESTOR(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== MYINVESTOR_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnMYINVESTOR(range, MYINVESTOR_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnMYINVESTOR(range, MYINVESTOR_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnMYINVESTOR(range, MYINVESTOR_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnMYINVESTOR(range, MYINVESTOR_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnMYINVESTOR(range, MYINVESTOR_COL_STATUS);

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

    var opportunity = sheet.getRange(row, MYINVESTOR_COL_OPPORT).getValue();

    if (isEmptyMYINVESTOR(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, MYINVESTOR_COL_ITEM_ID).clearContent();
        sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusMYINVESTOR(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyMYINVESTOR(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (touchesAutorizacion && isYesMYINVESTOR(sheet.getRange(row, MYINVESTOR_COL_AUTORIZACION).getValue())) {
        preferredAction = "AUTORIZACION";
      } else if (touchesEnviar && isYesMYINVESTOR(sheet.getRange(row, MYINVESTOR_COL_ENVIAR).getValue())) {
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
      if (syncProcessStatusFromStatusMYINVESTOR(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, MYINVESTOR_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, MYINVESTOR_COL_STATUS).getValue();

      if (!isEmptyMYINVESTOR(timestamp) || statusLooksClosedMYINVESTOR(status)) {
        sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  /***************
   * FASE 2:
   * Enviar después de que todas tengan UID / Yes.
   ***************/
  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NMYINVESTOR(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function validateSendMYINVESTOR(sheet, row, options) {
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

  var data = getRowSnapshotMYINVESTOR(sheet, row);

  if (isEmptyMYINVESTOR(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyMYINVESTOR(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkMYINVESTOR(data.status)) {
    sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionMYINVESTOR(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyMYINVESTOR(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedMYINVESTOR(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedMYINVESTOR(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisMYINVESTOR(data.lastSent);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < MYINVESTOR_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoMYINVESTOR(data.itemID, action);

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

// Wrapper de compatibilidad.
function shouldSendToN8NMYINVESTOR(sheet, row, options) {
  return validateSendMYINVESTOR(sheet, row, options).ok;
}


/***************
 * POST A N8N
 ***************/
function postToN8NMYINVESTOR(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyMYINVESTOR(sheet, row, false);

    if (!ready) {
      Logger.log("MYINVESTOR fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusMYINVESTOR(sheet, row)) {
      Logger.log('MYINVESTOR fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = validateSendMYINVESTOR(sheet, row, options);

    if (!validation.ok) {
      Logger.log("MYINVESTOR fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedMYINVESTOR(currentProcessStatus)) {
        sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowMYINVESTOR(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    // Reserva corta.
    // El lock solo se usa aquí, durante milisegundos.
    // El webhook NO queda dentro del lock.
    var reservation = tryReserveSendMYINVESTOR(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("MYINVESTOR fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedMYINVESTOR(currentStatus)) {
        sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowMYINVESTOR(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, MYINVESTOR_COL_LAST_SENT).setValue(now);
    sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowMYINVESTOR(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanMYINVESTOR(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    payload["_MYINVESTOR_action"] = validation.action;
    payload["_source"] = options.source || "sheets";
    payload["_MYINVESTOR_row"] = row;
    payload["_MYINVESTOR_item_id"] = sheet.getRange(row, MYINVESTOR_COL_ITEM_ID).getValue();
    payload["_MYINVESTOR_attempt_at"] = now.toISOString();

    // Este fetch va SIN lock para no bloquear otros bancos.
    var response = UrlFetchApp.fetch(MYINVESTOR_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST MYINVESTOR - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusMYINVESTOR(sheet, row)) {
      Logger.log('MYINVESTOR fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedMYINVESTOR(currentProcessStatusAfterPost)) {
      Logger.log("MYINVESTOR fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowMYINVESTOR(now)
      );
    } else {
      sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue(
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
    Logger.log("Error post MYINVESTOR to n8n en fila " + row + ": " + err);

    try {
      sheet.getRange(row, MYINVESTOR_COL_PROCESS_STATUS).setValue(
        "Error Apps Script - " + String(err).substring(0, 200)
      );
    } catch (innerErr) {
      Logger.log("No se pudo escribir error en hoja MYINVESTOR: " + innerErr);
    }

    return false;
  }
}


/***************
 * FILAS CREADAS POR OTRO SCRIPT
 *
 * Esta es la función que debe llamar el script distribuidor
 * cuando crea filas en MyInvestor Test.
 ***************/
function procesarFilasCreadasPorScriptMYINVESTOR(startRow, numRows) {
  var sheet = getSheetMYINVESTOR();

  if (!sheet) {
    Logger.log("Hoja MyInvestor Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsMYINVESTOR(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NMYINVESTOR(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptMYINVESTOR(row) {
  procesarFilasCreadasPorScriptMYINVESTOR(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 *
 * Útil si quieres recuperar filas que entraron por script
 * pero no llamaron procesarFilasCreadasPorScriptMYINVESTOR.
 ***************/
function checkPendientesMYINVESTOR() {
  var sheet = getSheetMYINVESTOR();

  if (!sheet) {
    Logger.log("Hoja MyInvestor Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos en MYINVESTOR");
    return;
  }

  var rowsToSend = [];

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, MYINVESTOR_COL_OPPORT).getValue();

    if (isEmptyMYINVESTOR(opportunity)) continue;

    if (syncProcessStatusFromStatusMYINVESTOR(sheet, row)) {
      Logger.log('MYINVESTOR fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotMYINVESTOR(sheet, row);

    if (statusLooksClosedMYINVESTOR(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyMYINVESTOR(dataBefore.itemID) &&
      isEmptyMYINVESTOR(dataBefore.enviar) &&
      isEmptyMYINVESTOR(dataBefore.autorizacion) &&
      isEmptyMYINVESTOR(dataBefore.timestamp) &&
      !statusLooksClosedMYINVESTOR(dataBefore.status);

    ensureRowReadyMYINVESTOR(sheet, row, shouldForceYes);

    var validation = validateSendMYINVESTOR(sheet, row, {
      mode: "auto",
      preferredAction: "ENVIAR"
    });

    if (validation.ok) {
      rowsToSend.push(row);
    } else {
      Logger.log("MYINVESTOR fila " + row + " no enviada desde checker: " + validation.reason);
    }
  }

  SpreadsheetApp.flush();

  for (var i = 0; i < rowsToSend.length; i++) {
    Logger.log("Enviando fila MYINVESTOR pendiente " + rowsToSend[i] + " a n8n desde checkPendientesMYINVESTOR");

    postToN8NMYINVESTOR(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD CON TRIGGER ANTIGUO
 *
 * Si ya tienes trigger llamado checkCompletadosMYINVESTOR,
 * esta función no rompe nada.
 ***************/
function checkCompletadosMYINVESTOR() {
  checkPendientesMYINVESTOR();
}


/***************
 * DIAGNÓSTICO POR FILA
 *
 * Ejecuta diagnosticarFilaMYINVESTOR(353), por ejemplo.
 ***************/
function diagnosticarFilaMYINVESTOR(row) {
  var sheet = getSheetMYINVESTOR();

  if (!sheet) {
    Logger.log("Hoja MyInvestor Test no encontrada");
    return;
  }

  var data = getRowSnapshotMYINVESTOR(sheet, row);

  Logger.log("===== DIAGNÓSTICO MYINVESTOR FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("LAST SENT S: " + data.lastSent);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedMYINVESTOR(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedMYINVESTOR(data.processStatus));

  var validation = validateSendMYINVESTOR(sheet, row, {
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
 * Úsalo solo si no tienes ya el trigger onEditMYINVESTOR.
 ***************/
function recrearTriggerMYINVESTOR() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditMYINVESTOR") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditMYINVESTOR ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditMYINVESTOR")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditMYINVESTOR creado correctamente.");
}


/***************
 * TEST PERMISOS
 ***************/
function testFetchPermisosMYINVESTOR() {
  var r = UrlFetchApp.fetch("https://example.com");
  Logger.log(r.getResponseCode());
}