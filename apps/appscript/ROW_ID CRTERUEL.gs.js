/***************
 * CONFIG TERUEL AUTO
 ***************/
var TERUEL_SHEET_NAME = "CR Teruel Test";

var TERUEL_COL_OPPORT = 1;          // A - Opportunity
var TERUEL_COL_ENVIAR = 7;          // G - Enviar
var TERUEL_COL_AUTORIZACION = 8;    // H - Autorización
var TERUEL_COL_TIMESTAMP = 10;      // J - Timestamp sent
var TERUEL_COL_STATUS = 11;         // K - Status
var TERUEL_COL_ITEM_ID = 18;        // R - ITEM ID
var TERUEL_COL_TEST_TIME = 19;      // S - TEST TIME / Last attempt
var TERUEL_COL_PROCESS_STATUS = 20; // T - Process Status

var N8N_WEBHOOK_TERUEL = "https://huspy.app.n8n.cloud/webhook/send-dossier-crteruel";

var TERUEL_DUPLICATE_WINDOW_SECONDS = 20;
var TERUEL_AUTO_RETRY_AFTER_MINUTES = 10;
var TERUEL_PROP_PREFIX = "TERUEL_LAST_SEND_";


/***************
 * HELPERS
 ***************/
function generateUIDTERUEL() {
  return Utilities.getUuid();
}

function rangeTouchesColumnTERUEL(range, targetCol) {
  var startCol = range.getColumn();
  var endCol = startCol + range.getNumColumns() - 1;
  return targetCol >= startCol && targetCol <= endCol;
}

function isEmptyTERUEL(value) {
  return value === "" || value === null || value === undefined;
}

function cleanTERUEL(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lowerTERUEL(value) {
  return cleanTERUEL(value).toLowerCase();
}

function isYesTERUEL(value) {
  return lowerTERUEL(value) === "yes";
}

function isStatusEnviadoOkTERUEL(value) {
  return cleanTERUEL(value) === "Enviado ✅";
}

function statusLooksClosedTERUEL(value) {
  var s = lowerTERUEL(value);

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

function dateToMillisTERUEL(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.getTime();
  }

  if (isEmptyTERUEL(value)) return 0;

  var d = new Date(value);

  if (isNaN(d.getTime())) return 0;

  return d.getTime();
}

function formatNowTERUEL(dateObj) {
  return Utilities.formatDate(
    dateObj || new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
}

function getSheetTERUEL() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TERUEL_SHEET_NAME);
}

function getRowSnapshotTERUEL(sheet, row) {
  return {
    row: row,
    opportunity: sheet.getRange(row, TERUEL_COL_OPPORT).getValue(),
    enviar: sheet.getRange(row, TERUEL_COL_ENVIAR).getValue(),
    autorizacion: sheet.getRange(row, TERUEL_COL_AUTORIZACION).getValue(),
    timestamp: sheet.getRange(row, TERUEL_COL_TIMESTAMP).getValue(),
    status: sheet.getRange(row, TERUEL_COL_STATUS).getValue(),
    itemID: sheet.getRange(row, TERUEL_COL_ITEM_ID).getValue(),
    testTime: sheet.getRange(row, TERUEL_COL_TEST_TIME).getValue(),
    processStatus: sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).getValue()
  };
}

function syncProcessStatusFromStatusTERUEL(sheet, row) {
  if (!sheet || row <= 1) return false;

  var status = sheet.getRange(row, TERUEL_COL_STATUS).getValue();

  if (isStatusEnviadoOkTERUEL(status)) {
    sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue("Completado");
    SpreadsheetApp.flush();
    return true;
  }

  return false;
}

function resolveActionTERUEL(data, preferredAction) {
  if (preferredAction === "AUTORIZACION" && isYesTERUEL(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (preferredAction === "ENVIAR" && isYesTERUEL(data.enviar)) {
    return "ENVIAR";
  }

  if (isYesTERUEL(data.autorizacion)) {
    return "AUTORIZACION";
  }

  if (isYesTERUEL(data.enviar)) {
    return "ENVIAR";
  }

  return "";
}

function getDuplicateKeyTERUEL(itemID, action) {
  var safeItemID = cleanTERUEL(itemID).replace(/[^a-zA-Z0-9_-]/g, "_");
  return TERUEL_PROP_PREFIX + safeItemID + "_" + action;
}

function getRecentSendInfoTERUEL(itemID, action) {
  var key = getDuplicateKeyTERUEL(itemID, action);
  var props = PropertiesService.getScriptProperties();

  var lastMillis = Number(props.getProperty(key) || 0);
  var nowMillis = new Date().getTime();
  var diffSeconds = lastMillis ? Math.round((nowMillis - lastMillis) / 1000) : null;

  return {
    key: key,
    lastMillis: lastMillis,
    diffSeconds: diffSeconds,
    isRecent: lastMillis && (nowMillis - lastMillis < TERUEL_DUPLICATE_WINDOW_SECONDS * 1000)
  };
}

// Reserva corta: usa lock solo para reservar, NO para enviar a n8n.
function tryReserveSendTERUEL(itemID, action) {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      ok: false,
      reason: "No se pudo reservar envío porque otro proceso está reservando"
    };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var key = getDuplicateKeyTERUEL(itemID, action);

    var lastMillis = Number(props.getProperty(key) || 0);
    var nowMillis = new Date().getTime();

    if (
      lastMillis &&
      nowMillis - lastMillis < TERUEL_DUPLICATE_WINDOW_SECONDS * 1000
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
function ensureRowReadyTERUEL(sheet, row, forceEnviarYes) {
  var msgNoProcesar = 'Cambia a "Yes" la columna "Enviar" para procesar la línea';

  if (!sheet || row <= 1) return false;

  var opportunity = sheet.getRange(row, TERUEL_COL_OPPORT).getValue();

  if (isEmptyTERUEL(opportunity)) {
    sheet.getRange(row, TERUEL_COL_ITEM_ID).clearContent();
    sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).clearContent();
    return false;
  }

  var itemIDCell = sheet.getRange(row, TERUEL_COL_ITEM_ID);
  var itemID = itemIDCell.getValue();

  if (isEmptyTERUEL(itemID)) {
    itemID = generateUIDTERUEL();
    itemIDCell.setValue(itemID);
  }

  if (syncProcessStatusFromStatusTERUEL(sheet, row)) {
    return true;
  }

  var currentProcessStatus = sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).getValue();

  if (statusLooksClosedTERUEL(currentProcessStatus)) {
    SpreadsheetApp.flush();
    return true;
  }

  if (forceEnviarYes) {
    var enviar = cleanTERUEL(sheet.getRange(row, TERUEL_COL_ENVIAR).getValue());

    if (enviar !== "Yes") {
      sheet.getRange(row, TERUEL_COL_ENVIAR).setValue("Yes");
    }
  }

  var timestamp = sheet.getRange(row, TERUEL_COL_TIMESTAMP).getValue();
  var status = sheet.getRange(row, TERUEL_COL_STATUS).getValue();
  var enviarVal = sheet.getRange(row, TERUEL_COL_ENVIAR).getValue();
  var autorizacionVal = sheet.getRange(row, TERUEL_COL_AUTORIZACION).getValue();

  if (!isEmptyTERUEL(timestamp) || statusLooksClosedTERUEL(status)) {
    sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue("Completado");
  } else if (isYesTERUEL(enviarVal) || isYesTERUEL(autorizacionVal)) {
    sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue("Listo para enviar");
  } else {
    sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue(msgNoProcesar);
  }

  SpreadsheetApp.flush();
  return true;
}


/***************
 * PREPARAR VARIAS FILAS PRIMERO
 ***************/
function prepareRowsTERUEL(sheet, startRow, numRows, forceEnviarYes) {
  var rowsToSend = [];

  if (!sheet || !numRows || numRows < 1) {
    return rowsToSend;
  }

  for (var i = 0; i < numRows; i++) {
    var row = startRow + i;

    if (row <= 1) continue;

    var opportunity = sheet.getRange(row, TERUEL_COL_OPPORT).getValue();

    if (isEmptyTERUEL(opportunity)) {
      continue;
    }

    if (syncProcessStatusFromStatusTERUEL(sheet, row)) {
      continue;
    }

    ensureRowReadyTERUEL(sheet, row, forceEnviarYes);

    var data = getRowSnapshotTERUEL(sheet, row);

    if (isYesTERUEL(data.enviar) || isYesTERUEL(data.autorizacion)) {
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
function onEditTERUEL(e) {
  if (!e || !e.source || !e.range) return;

  var range = e.range;
  var sheet = range.getSheet();

  if (sheet.getName() !== TERUEL_SHEET_NAME) return;

  var touchesOpportunity = rangeTouchesColumnTERUEL(range, TERUEL_COL_OPPORT);
  var touchesEnviar = rangeTouchesColumnTERUEL(range, TERUEL_COL_ENVIAR);
  var touchesAutorizacion = rangeTouchesColumnTERUEL(range, TERUEL_COL_AUTORIZACION);
  var touchesTimestamp = rangeTouchesColumnTERUEL(range, TERUEL_COL_TIMESTAMP);
  var touchesStatus = rangeTouchesColumnTERUEL(range, TERUEL_COL_STATUS);

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

    var opportunity = sheet.getRange(row, TERUEL_COL_OPPORT).getValue();

    if (isEmptyTERUEL(opportunity)) {
      if (touchesOpportunity) {
        sheet.getRange(row, TERUEL_COL_ITEM_ID).clearContent();
        sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).clearContent();
      }

      continue;
    }

    if (touchesStatus && syncProcessStatusFromStatusTERUEL(sheet, row)) {
      continue;
    }

    if (touchesOpportunity || touchesEnviar || touchesAutorizacion) {
      ensureRowReadyTERUEL(sheet, row, touchesOpportunity);

      var preferredAction = "";

      if (touchesAutorizacion && isYesTERUEL(sheet.getRange(row, TERUEL_COL_AUTORIZACION).getValue())) {
        preferredAction = "AUTORIZACION";
      } else if (touchesEnviar && isYesTERUEL(sheet.getRange(row, TERUEL_COL_ENVIAR).getValue())) {
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
      if (syncProcessStatusFromStatusTERUEL(sheet, row)) {
        continue;
      }

      var timestamp = sheet.getRange(row, TERUEL_COL_TIMESTAMP).getValue();
      var status = sheet.getRange(row, TERUEL_COL_STATUS).getValue();

      if (!isEmptyTERUEL(timestamp) || statusLooksClosedTERUEL(status)) {
        sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue("Completado");
      }
    }
  }

  SpreadsheetApp.flush();

  /***************
   * FASE 2:
   * Enviar después de que todas tengan UID / Yes.
   ***************/
  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NTERUEL(sheet, rowsToSend[i].row, {
      mode: rowsToSend[i].mode,
      preferredAction: rowsToSend[i].preferredAction
    });
  }
}


/***************
 * VALIDAR SI SE ENVÍA
 ***************/
function shouldSendToN8NTERUEL(sheet, row, options) {
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

  var data = getRowSnapshotTERUEL(sheet, row);

  if (isEmptyTERUEL(data.opportunity)) {
    return {
      ok: false,
      reason: "No hay Opportunity"
    };
  }

  if (isEmptyTERUEL(data.itemID)) {
    return {
      ok: false,
      reason: "No hay ITEM ID"
    };
  }

  if (isStatusEnviadoOkTERUEL(data.status)) {
    sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue("Completado");

    return {
      ok: false,
      reason: 'Status es "Enviado ✅"; Process Status marcado como Completado'
    };
  }

  var action = resolveActionTERUEL(data, preferredAction);

  if (!action) {
    return {
      ok: false,
      reason: "No hay Enviar=Yes ni Autorización=Yes"
    };
  }

  if (!manualMode) {
    if (!isEmptyTERUEL(data.timestamp)) {
      return {
        ok: false,
        reason: "Ya tiene Timestamp"
      };
    }

    if (statusLooksClosedTERUEL(data.status)) {
      return {
        ok: false,
        reason: "Status ya cerrado"
      };
    }

    if (statusLooksClosedTERUEL(data.processStatus)) {
      return {
        ok: false,
        reason: "Process Status ya cerrado"
      };
    }

    var lastAttemptMillis = dateToMillisTERUEL(data.testTime);

    if (lastAttemptMillis) {
      var nowMillis = new Date().getTime();
      var diffMinutes = (nowMillis - lastAttemptMillis) / 1000 / 60;

      if (diffMinutes < TERUEL_AUTO_RETRY_AFTER_MINUTES) {
        return {
          ok: false,
          reason: "Reintento automático bloqueado por cooldown"
        };
      }
    }
  }

  var recentInfo = getRecentSendInfoTERUEL(data.itemID, action);

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
function postToN8NTERUEL(sheet, row, options) {
  options = options || {};

  try {
    var ready = ensureRowReadyTERUEL(sheet, row, false);

    if (!ready) {
      Logger.log("Fila " + row + " - no enviada: fila no lista");
      return false;
    }

    if (syncProcessStatusFromStatusTERUEL(sheet, row)) {
      Logger.log('Fila ' + row + ' - no enviada: Status es "Enviado ✅"');
      return false;
    }

    var validation = shouldSendToN8NTERUEL(sheet, row, options);

    if (!validation.ok) {
      Logger.log("Fila " + row + " - no enviada: " + validation.reason);

      var currentProcessStatus = sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedTERUEL(currentProcessStatus)) {
        sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue(
          "Bloqueado - " + validation.reason + " - " + formatNowTERUEL(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    // Reserva corta.
    // El lock solo se usa aquí, durante milisegundos.
    // El webhook NO queda dentro del lock.
    var reservation = tryReserveSendTERUEL(
      validation.data.itemID,
      validation.action
    );

    if (!reservation.ok) {
      Logger.log("Fila " + row + " - no enviada: " + reservation.reason);

      var currentStatus = sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).getValue();

      if (!statusLooksClosedTERUEL(currentStatus)) {
        sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue(
          "Pendiente - " + reservation.reason + " - " + formatNowTERUEL(new Date())
        );
      }

      SpreadsheetApp.flush();
      return false;
    }

    var now = new Date();

    sheet.getRange(row, TERUEL_COL_TEST_TIME).setValue(now);
    sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue(
      "Enviando a n8n (" + validation.action + ") - " + formatNowTERUEL(now)
    );

    SpreadsheetApp.flush();

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    var payload = {};

    headers.forEach(function(header, i) {
      var cleanHeader = cleanTERUEL(header);

      if (cleanHeader !== "") {
        payload[cleanHeader] = rowData[i];
      }
    });

    payload["_teruel_action"] = validation.action;
    payload["_teruel_row"] = row;
    payload["_teruel_item_id"] = sheet.getRange(row, TERUEL_COL_ITEM_ID).getValue();
    payload["_teruel_attempt_at"] = now.toISOString();

    // Este fetch va SIN lock para no bloquear otros bancos.
    var response = UrlFetchApp.fetch(N8N_WEBHOOK_TERUEL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log(
      "POST CR Teruel - fila " +
      row +
      " | Acción: " +
      validation.action +
      " | HTTP: " +
      code +
      " | Body: " +
      body
    );

    if (syncProcessStatusFromStatusTERUEL(sheet, row)) {
      Logger.log('Fila ' + row + ' - n8n marcó Status como "Enviado ✅"; Process Status = Completado');
      return true;
    }

    var currentProcessStatusAfterPost = sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).getValue();

    if (statusLooksClosedTERUEL(currentProcessStatusAfterPost)) {
      Logger.log("Fila " + row + " - Process Status ya estaba cerrado; no se sobrescribe.");
      return true;
    }

    if (code >= 200 && code < 300) {
      sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue(
        "Enviado a n8n (" + validation.action + ") - HTTP " + code + " - " + formatNowTERUEL(now)
      );
    } else {
      sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue(
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
      sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue(
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
 * cuando crea filas en CR Teruel Test.
 ***************/
function procesarFilasCreadasPorScriptTERUEL(startRow, numRows) {
  var sheet = getSheetTERUEL();

  if (!sheet) {
    Logger.log("Hoja CR Teruel Test no encontrada");
    return;
  }

  if (!numRows || numRows < 1) {
    numRows = 1;
  }

  var rowsToSend = prepareRowsTERUEL(sheet, startRow, numRows, true);

  for (var i = 0; i < rowsToSend.length; i++) {
    postToN8NTERUEL(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD: UNA SOLA FILA
 ***************/
function procesarFilaCreadaPorScriptTERUEL(row) {
  procesarFilasCreadasPorScriptTERUEL(row, 1);
}


/***************
 * CHECKER DE PENDIENTES
 *
 * Útil si quieres recuperar filas que entraron por script
 * pero no llamaron procesarFilasCreadasPorScriptTERUEL.
 ***************/
function checkPendientesTERUEL() {
  var sheet = getSheetTERUEL();

  if (!sheet) {
    Logger.log("Hoja CR Teruel Test no encontrada");
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
    var opportunity = sheet.getRange(row, TERUEL_COL_OPPORT).getValue();

    if (isEmptyTERUEL(opportunity)) continue;

    if (syncProcessStatusFromStatusTERUEL(sheet, row)) {
      Logger.log('Fila ' + row + ' marcada como Completado porque Status es "Enviado ✅"');
      continue;
    }

    var dataBefore = getRowSnapshotTERUEL(sheet, row);

    if (statusLooksClosedTERUEL(dataBefore.processStatus)) {
      continue;
    }

    var shouldForceYes =
      isEmptyTERUEL(dataBefore.itemID) &&
      isEmptyTERUEL(dataBefore.enviar) &&
      isEmptyTERUEL(dataBefore.autorizacion) &&
      isEmptyTERUEL(dataBefore.timestamp) &&
      !statusLooksClosedTERUEL(dataBefore.status);

    ensureRowReadyTERUEL(sheet, row, shouldForceYes);

    var validation = shouldSendToN8NTERUEL(sheet, row, {
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
    Logger.log("Enviando fila pendiente " + rowsToSend[i] + " a n8n desde checkPendientesTERUEL");

    postToN8NTERUEL(sheet, rowsToSend[i], {
      mode: "auto",
      preferredAction: "ENVIAR"
    });
  }
}


/***************
 * COMPATIBILIDAD CON TU TRIGGER ACTUAL
 *
 * Si ya tienes un trigger CLOCK llamado checkCompletadosTERUEL,
 * esta función no rompe nada.
 *
 * Solo sincroniza completados y genera UID si falta.
 * No fuerza Enviar = Yes y no envía a n8n.
 ***************/
function checkCompletadosTERUEL() {
  var sheet = getSheetTERUEL();

  if (!sheet) {
    Logger.log("Hoja CR Teruel Test no encontrada");
    return;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("Sin datos");
    return;
  }

  for (var row = 2; row <= lastRow; row++) {
    var opportunity = sheet.getRange(row, TERUEL_COL_OPPORT).getValue();

    if (isEmptyTERUEL(opportunity)) continue;

    var itemID = sheet.getRange(row, TERUEL_COL_ITEM_ID).getValue();

    if (isEmptyTERUEL(itemID)) {
      sheet.getRange(row, TERUEL_COL_ITEM_ID).setValue(generateUIDTERUEL());
    }

    if (syncProcessStatusFromStatusTERUEL(sheet, row)) {
      continue;
    }

    var timestamp = sheet.getRange(row, TERUEL_COL_TIMESTAMP).getValue();
    var status = sheet.getRange(row, TERUEL_COL_STATUS).getValue();

    if (!isEmptyTERUEL(timestamp) || statusLooksClosedTERUEL(status)) {
      sheet.getRange(row, TERUEL_COL_PROCESS_STATUS).setValue("Completado");
    }
  }

  SpreadsheetApp.flush();
}


/***************
 * DIAGNÓSTICO POR FILA
 *
 * Ejecuta diagnosticarFilaTERUEL(353), por ejemplo.
 ***************/
function diagnosticarFilaTERUEL(row) {
  var sheet = getSheetTERUEL();

  if (!sheet) {
    Logger.log("Hoja CR Teruel Test no encontrada");
    return;
  }

  var data = getRowSnapshotTERUEL(sheet, row);

  Logger.log("===== DIAGNÓSTICO TERUEL FILA " + row + " =====");
  Logger.log("Opportunity: " + data.opportunity);
  Logger.log("Enviar: " + data.enviar);
  Logger.log("Autorización: " + data.autorizacion);
  Logger.log("Timestamp J: " + data.timestamp);
  Logger.log("Status K: " + data.status);
  Logger.log("ITEM ID R: " + data.itemID);
  Logger.log("TEST TIME S: " + data.testTime);
  Logger.log("Process Status T: " + data.processStatus);
  Logger.log("Status K cerrado?: " + statusLooksClosedTERUEL(data.status));
  Logger.log("Process Status T cerrado?: " + statusLooksClosedTERUEL(data.processStatus));

  var validation = shouldSendToN8NTERUEL(sheet, row, {
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
 * Ejecuta esta función solo si no tienes ya el trigger onEditTERUEL.
 ***************/
function recrearTriggerTERUEL() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();

  var alreadyExists = false;

  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();

    if (handler === "onEditTERUEL") {
      alreadyExists = true;
    }
  });

  if (alreadyExists) {
    Logger.log("El trigger onEditTERUEL ya existe. No se creó otro.");
    return;
  }

  ScriptApp.newTrigger("onEditTERUEL")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log("Trigger onEditTERUEL creado correctamente.");
}