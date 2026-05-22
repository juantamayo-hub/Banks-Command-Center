function procesarFilasPorTiempoV2() {
  const props = PropertiesService.getScriptProperties();
  const LOCK_KEY = 'LOCK_PROCESAR_FILAS';

  if (props.getProperty(LOCK_KEY) === 'true') {
    Logger.log('⛔ procesarFilasPorTiempoV2 ya está en ejecución. Saliendo.');
    return;
  }

  props.setProperty(LOCK_KEY, 'true');

  try {
    Logger.log('🚀 Inicio del proceso por trigger de tiempo');

    function extractPipedriveId(url) {
      if (!url || typeof url !== 'string') return '';

      const match = url.match(/\/deal\/(\d+)/);
      return match ? match[1] : '';
    }

    function checkDuplicateId(sheet, idValue) {
      const lastRow = sheet.getLastRow();

      if (lastRow <= 1) return false;

      const idColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

      for (let i = 0; i < idColumn.length; i++) {
        if (idColumn[i][0] == idValue) return true;
      }

      return false;
    }

    const HOJA_ORIGEN_NOMBRE = 'n8n Testing Dossiers - Step 1';
    const TIMESTAMP_COLUMNA = 20;
    const MIGRATION_COLUMNA = 31; // EMPIEZA DESDE EL ÚLTIMO DONE AHORA OSCAR =)
    const COLUMNAS_A_LEER = 31;

    const BANCOS_CONFIG = [
      { value: 'Unicaja', sheetName: 'Unicaja Test' },
      { value: 'Santander', sheetName: 'Santander' },
      { value: 'Laboral Kutxa', sheetName: 'Laboral Kutxa Test' },
      { value: 'Kutxabank', sheetName: 'Kutxabank' },
      { value: 'Hipotecas.com', sheetName: 'UCI' },
      { value: 'MyInvestor', sheetName: 'MyInvestor Test' },
      { value: 'CR del Sur', sheetName: 'CR del Sur Test' },
      { value: 'CR Teruel', sheetName: 'CR Teruel Test' },
      { value: 'CR Granada', sheetName: 'CR Granada Test' },
      { value: 'EuroCajaRural', sheetName: 'EuroCajaRural Test' },
      { value: 'Globalcaja', sheetName: 'Globalcaja Test' },
      { value: 'CR Extremadura', sheetName: 'CR Extremadura' },
      { value: 'Sabadell', sheetName: 'Sabadell no residentes' },
      { value: 'Banca 360', sheetName: 'MSF 360 - Sabadell Residentes' },
      { value: 'ING', sheetName: 'ING' },
      { value: 'Bankinter', sheetName: 'Bankinter' },
      { value: 'No Bank Fee', sheetName: 'No Bank Fee Test' },
      { value: 'UCI', sheetName: 'UCI' },
      { value: 'CR Asturias', sheetName: 'CR Asturias Test' },
      { value: 'Ibercaja', sheetName: 'Ibercaja Test' },
      { value: 'Deutsche Bank', sheetName: 'Deutsche Bank Test' },
      { value: 'Cajamar', sheetName: 'Cajamar Test' },
      { value: 'Caixa Popular', sheetName: 'Caixa Popular Test' },
      { value: 'CR Aragón', sheetName: 'CR Aragon Test' },
      { value: 'RURALNOSTRA', sheetName: 'RURALNOSTRA' }
    ];

    const COLUMNA_ENLACE_MAPEO = {
      5: 7,
      8: 10,
      11: 13,
      14: 16,
      17: 19
    };

    const COLUMNAS_BANCO_BUSCAR = Object.keys(COLUMNA_ENLACE_MAPEO).map(Number);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sourceSheet = ss.getSheetByName(HOJA_ORIGEN_NOMBRE);

    if (!sourceSheet) {
      Logger.log('❌ Hoja de origen no encontrada');
      return;
    }

    const FILA_INICIO = obtenerFilaDespuesUltimoDone(
      sourceSheet,
      MIGRATION_COLUMNA
    );

    Logger.log('📍 Empezando desde fila dinámica: ' + FILA_INICIO);

    const lastRow = sourceSheet.getLastRow();

    if (lastRow < FILA_INICIO) {
      Logger.log('ℹ️ No hay filas nuevas para procesar');
      return;
    }

    const allRowData = sourceSheet
      .getRange(FILA_INICIO, 1, lastRow - FILA_INICIO + 1, COLUMNAS_A_LEER)
      .getValues();

    const now = new Date();

    const filasInsertadasPorBanco = {};

    for (let i = 0; i < allRowData.length; i++) {
      const rowData = allRowData[i];
      const rowNumber = i + FILA_INICIO;
      const rowId = rowData[0];

      Logger.log(`➡️ Procesando fila ${rowNumber} | ID: ${rowId}`);

      if (rowData[TIMESTAMP_COLUMNA - 1]) {
        Logger.log(`⏭️ Fila ${rowNumber} ya procesada (timestamp existente)`);
        continue;
      }

      let bankMatches = [];

      for (let colIndex of COLUMNAS_BANCO_BUSCAR) {
        const cellValue = rowData[colIndex - 1];

        if (cellValue && typeof cellValue === 'string') {
          for (const config of BANCOS_CONFIG) {
            if (cellValue.trim().toUpperCase() === config.value.toUpperCase()) {
              bankMatches.push({
                config: config,
                bankColIndex: colIndex
              });
            }
          }
        }
      }

      if (bankMatches.length === 0) {
        Logger.log(`⚠️ Fila ${rowNumber}: ningún banco detectado`);
        continue;
      }

      Logger.log(
        `🏦 Fila ${rowNumber}: bancos detectados → ${bankMatches
          .map(function(b) {
            return b.config.value;
          })
          .join(', ')}`
      );

      let copiedSuccessfully = false;

      for (const match of bankMatches) {
        const destSheet = ss.getSheetByName(match.config.sheetName);

        if (!destSheet) {
          Logger.log(`❌ Hoja destino no encontrada: ${match.config.sheetName}`);
          continue;
        }

        let pipedriveId = '';
        const linkColIndex = COLUMNA_ENLACE_MAPEO[match.bankColIndex];

        if (linkColIndex) {
          const linkCompleto = rowData[linkColIndex - 1];
          pipedriveId = extractPipedriveId(linkCompleto);
        }

        if (checkDuplicateId(destSheet, rowId)) {
          Logger.log(`🔁 ID duplicado en ${match.config.sheetName} | ID: ${rowId}`);
          continue;
        }

        destSheet.appendRow([
          rowData[0],
          rowData[1],
          rowData[match.bankColIndex],
          rowData[3],
          '',
          pipedriveId
        ]);

        const insertedRow = destSheet.getLastRow();

        const valorColumnaX = rowData[23];

        if (
          valorColumnaX !== '' &&
          valorColumnaX !== null &&
          valorColumnaX !== undefined
        ) {
          destSheet.getRange(insertedRow, 21).setValue(valorColumnaX);
        }

        if (!filasInsertadasPorBanco[match.config.sheetName]) {
          filasInsertadasPorBanco[match.config.sheetName] = [];
        }

        filasInsertadasPorBanco[match.config.sheetName].push(insertedRow);

        Logger.log(
          `✅ Copiado ID ${rowId} en hoja ${match.config.sheetName} | fila destino ${insertedRow}`
        );

        copiedSuccessfully = true;
      }

      if (copiedSuccessfully) {
        sourceSheet.getRange(rowNumber, TIMESTAMP_COLUMNA).setValue(now);
        sourceSheet.getRange(rowNumber, MIGRATION_COLUMNA).setValue('Done');

        Logger.log(`🕒 Timestamp y MIGRATION marcados en fila ${rowNumber}`);
      }
    }

    SpreadsheetApp.flush();

    // Aquí se activan los procesos automáticos de los bancos que tengan handler configurado.
    procesarFilasInsertadasEnBancosV2(filasInsertadasPorBanco);

    Logger.log('🏁 Fin del proceso');

  } catch (err) {
    Logger.log('❌ Error general en procesarFilasPorTiempoV2: ' + err);
    throw err;

  } finally {
    props.deleteProperty(LOCK_KEY);
    Logger.log('🔓 Lock liberado');
  }
}

function obtenerFilaDespuesUltimoDone(sheet, migrationColumn) {
  var lastRow = sheet.getLastRow();

  // Si solo hay headers o la hoja está vacía, empieza en fila 2.
  if (lastRow < 2) {
    return 2;
  }

  var values = sheet
    .getRange(2, migrationColumn, lastRow - 1, 1)
    .getValues();

  for (var i = values.length - 1; i >= 0; i--) {
    var value = String(values[i][0] || "").trim().toLowerCase();

    if (value === "done") {
      // values[0] corresponde a fila 2.
      // Si encontró Done en fila real X, devuelve X + 1.
      return i + 3;
    }
  }

  // Si nunca encuentra Done, empieza desde la primera fila de datos.
  return 2;
}

/***************
 * PROCESAR FILAS INSERTADAS POR BANCO
 ***************/
function procesarFilasInsertadasEnBancosV2(filasInsertadasPorBanco) {
  if (!filasInsertadasPorBanco) return;

  Object.keys(filasInsertadasPorBanco).forEach(function(sheetName) {
    var filas = filasInsertadasPorBanco[sheetName];

    if (!filas || filas.length === 0) return;

    filas.sort(function(a, b) {
      return a - b;
    });

    var rangos = agruparFilasConsecutivasV2(filas);

    rangos.forEach(function(rango) {
      var startRow = rango.startRow;
      var numRows = rango.numRows;

      try {
        procesarRangoBancoAutomaticoV2(sheetName, startRow, numRows);

      } catch (err) {
        Logger.log(
          '❌ Error procesando filas insertadas en ' +
          sheetName +
          ' desde fila ' +
          startRow +
          ' | numRows ' +
          numRows +
          ' | Error: ' +
          err
        );
      }
    });
  });
}


/***************
 * AQUÍ AGREGAS CADA BANCO AUTOMÁTICO
 *
 * Para agregar un banco nuevo, solo añade un bloque:
 *
 * if (sheetName === "Nombre Hoja Banco") {
 *   Logger.log("🚀 Activando Banco para filas " + startRow + " a " + (startRow + numRows - 1));
 *   procesarFilasCreadasPorScriptBANCO(startRow, numRows);
 *   return;
 * }
 ***************/
function procesarRangoBancoAutomaticoV2(sheetName, startRow, numRows) {
  if (sheetName === 'Unicaja Test') {
    Logger.log(
      '🚀 Activando Unicaja para filas ' +
      startRow +
      ' a ' +
      (startRow + numRows - 1)
    );

    procesarFilasCreadasPorScriptUNICAJA(startRow, numRows);
    return;
  }

  if (sheetName === 'Laboral Kutxa Test') {
    Logger.log(
      '🚀 Activando Laboral Kutxa para filas ' +
      startRow +
      ' a ' +
      (startRow + numRows - 1)
    );

    procesarFilasCreadasPorScriptLABORALK(startRow, numRows);
    return;
  }

  if (sheetName === 'CR Teruel Test') {
  Logger.log(
    '🚀 Activando CR Teruel para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptTERUEL(startRow, numRows);
  return;
}

if (sheetName === 'Ruralnostra') {
  Logger.log(
    '🚀 Activando Ruralnostra para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptRuralnostra(startRow, numRows);
  return;
}

  if (sheetName === 'MyInvestor Test') {
    Logger.log(
      '🚀 Activando MyInvestor para filas ' +
      startRow +
      ' a ' +
      (startRow + numRows - 1)
    );

    procesarFilasCreadasPorScriptMYINVESTOR(startRow, numRows);
    return;
  }

  if (sheetName === 'ING') {
  Logger.log(
    '🚀 Activando ING para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptING(startRow, numRows);
  return;
}

  if (sheetName === 'Deutsche Bank Test') {
    Logger.log(
      '🚀 Activando Deutsche Bank para filas ' +
      startRow +
      ' a ' +
      (startRow + numRows - 1)
    );

    procesarFilasCreadasPorScriptDEUTSCHE(startRow, numRows);
    return;
  }

  if (sheetName === 'CR Aragon Test') {
  Logger.log(
    '🚀 Activando CR Aragón para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptCRARAGON(startRow, numRows);
  return;
}

if (sheetName === 'CR Asturias Test') {
  Logger.log(
    '🚀 Activando CR Asturias para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptCRASTURIAS(startRow, numRows);
  return;
}

if (sheetName === 'CR del Sur Test') {
  Logger.log(
    '🚀 Activando CR del Sur para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptCRDELSUR(startRow, numRows);
  return;
}

if (sheetName === 'Caixa Popular Test') {
  Logger.log(
    '🚀 Activando Caixa Popular para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptCAIXAPOPULAR(startRow, numRows);
  return;
}

if (sheetName === 'No Bank Fee Test') {
  Logger.log(
    '🚀 Activando No Bank Fee para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptNOBANKFEE(startRow, numRows);
  return;
}

if (sheetName === 'Globalcaja Test') {
  Logger.log(
    '🚀 Activando Globalcaja para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptGLOBALCAJA(startRow, numRows);
  return;
}

if (sheetName === 'Cajamar Test') {
  Logger.log(
    '🚀 Activando Cajamar para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptCAJAMAR(startRow, numRows);
  return;
}

if (sheetName === 'UCI') {
  Logger.log(
    '🚀 Activando UCI para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptUCI(startRow, numRows);
  return;
}

  if (sheetName === 'CR Granada Test') {
  Logger.log(
    '🚀 Activando CR Granada para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptCRGRANADA(startRow, numRows);
  return;
}

  if (sheetName === 'EuroCajaRural Test') {
  Logger.log(
    '🚀 Activando EuroCajaRural para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptEUROCAJARURAL(startRow, numRows);
  return;
}

  if (sheetName === 'Ibercaja Test') {
  Logger.log(
    '🚀 Activando Ibercaja para filas ' +
    startRow +
    ' a ' +
    (startRow + numRows - 1)
  );

  procesarFilasCreadasPorScriptIbercaja(startRow, numRows);
  return;
}

  Logger.log(
    'ℹ️ No hay proceso automático configurado para ' +
    sheetName +
    '. Solo se copió la fila.'
  );
}




/***************
 * AGRUPAR FILAS CONSECUTIVAS
 *
 * Convierte [353, 354, 360] en:
 * [
 *   { startRow: 353, numRows: 2 },
 *   { startRow: 360, numRows: 1 }
 * ]
 ***************/
function agruparFilasConsecutivasV2(filas) {
  var rangos = [];

  if (!filas || filas.length === 0) {
    return rangos;
  }

  var startRow = filas[0];
  var previousRow = filas[0];
  var count = 1;

  for (var i = 1; i < filas.length; i++) {
    var currentRow = filas[i];

    if (currentRow === previousRow + 1) {
      count++;
    } else {
      rangos.push({
        startRow: startRow,
        numRows: count
      });

      startRow = currentRow;
      count = 1;
    }

    previousRow = currentRow;
  }

  rangos.push({
    startRow: startRow,
    numRows: count
  });

  return rangos;
}


/***************
 * CHEQUEO PERIÓDICO: DETECTA FILAS SIN MIGRAR
 ***************/
function checkMigracionPendiente() {
  const HOJA_ORIGEN_NOMBRE = 'n8n Testing Dossiers - Step 1';
  const FILA_INICIO = 4740;
  const MIGRATION_COLUMNA = 31; // AE
  const COLUMNAS_A_LEER = 31;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(HOJA_ORIGEN_NOMBRE);

  if (!sourceSheet) {
    Logger.log('❌ Hoja de origen no encontrada');
    return;
  }

  const lastRow = sourceSheet.getLastRow();

  if (lastRow < FILA_INICIO) {
    Logger.log('ℹ️ No hay filas para revisar');
    return;
  }

  const allRowData = sourceSheet
    .getRange(FILA_INICIO, 1, lastRow - FILA_INICIO + 1, COLUMNAS_A_LEER)
    .getValues();

  let pendientes = [];

  for (let i = 0; i < allRowData.length; i++) {
    const rowData = allRowData[i];
    const rowNumber = i + FILA_INICIO;
    const rowId = rowData[0];
    const migration = rowData[MIGRATION_COLUMNA - 1];

    if (rowId && (!migration || migration !== 'Done')) {
      pendientes.push({
        fila: rowNumber,
        id: rowId
      });
    }
  }

  if (pendientes.length === 0) {
    Logger.log('✅ Todas las filas están migradas');
  } else {
    Logger.log(`⚠️ Filas pendientes de migración: ${pendientes.length}`);

    pendientes.forEach(function(p) {
      Logger.log(`   → Fila ${p.fila} | ID: ${p.id}`);
    });
  }
}


/***************
 * RESET LOCK
 ***************/
function resetLockMigracion() {
  const props = PropertiesService.getScriptProperties();

  props.deleteProperty('LOCK_PROCESAR_FILAS');

  Logger.log('🔓 Lock liberado correctamente');
}