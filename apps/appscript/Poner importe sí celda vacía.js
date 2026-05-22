function verificarYCompletarRespuestas() {
  // 👉 CONFIGURACIÓN: fila desde la que quieres comenzar
  const START_ROW = 2000; // <-- cambia este número cuando quieras

  // Define el nombre exacto de la hoja
  const NOMBRE_HOJA = '[BAYTECA] Make Response - Step 1';

  // Obtiene la hoja de cálculo activa
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(NOMBRE_HOJA);

  // Verifica que la hoja exista
  if (!sheet) {
    Logger.log(`Error: La hoja '${NOMBRE_HOJA}' no fue encontrada.`);
    return;
  }

  // Obtiene el número de la última fila con contenido
  const lastRow = sheet.getLastRow();
  if (lastRow < START_ROW) {
    Logger.log("No hay datos para procesar.");
    return;
  }

  // --- Rango de trabajo ---
  const startRow = START_ROW; // ← ahora es configurable
  const numRows = lastRow - startRow + 1;
  const numColumns = 16; // De C (col 3) a R (col 18)

  const range = sheet.getRange(startRow, 3, numRows, numColumns);
  const values = range.getValues();

  const updatedValues = [];

  // Definición de índices
  const COL_C_SOURCE = 0;
  const COL_E_CHECK = 2;

  const COL_H_CHECK = 5;
  const COL_K_CHECK = 8;
  const COL_N_CHECK = 11;
  const COL_Q_CHECK = 14;

  const COL_F_TARGET = 3;
  const COL_I_TARGET = 6;
  const COL_L_TARGET = 9;
  const COL_O_TARGET = 12;
  const COL_R_TARGET = 15;

  // Procesa fila por fila
  values.forEach((row) => {
    const valueC = row[COL_C_SOURCE]?.toString().trim() || "";
    const valueE = row[COL_E_CHECK]?.toString().trim() || "";

    if (valueC === "" || valueE === "") {
      updatedValues.push(row);
      return;
    }

    let newRow = [...row];

    // F
    if (newRow[COL_F_TARGET]?.toString().trim() === "") {
      newRow[COL_F_TARGET] = valueC;
    }

    // I (requiere H)
    const valueH = row[COL_H_CHECK]?.toString().trim() || "";
    if (valueH !== "" && newRow[COL_I_TARGET]?.toString().trim() === "") {
      newRow[COL_I_TARGET] = valueC;
    }

    // L (requiere K)
    const valueK = row[COL_K_CHECK]?.toString().trim() || "";
    if (valueK !== "" && newRow[COL_L_TARGET]?.toString().trim() === "") {
      newRow[COL_L_TARGET] = valueC;
    }

    // O (requiere N)
    const valueN = row[COL_N_CHECK]?.toString().trim() || "";
    if (valueN !== "" && newRow[COL_O_TARGET]?.toString().trim() === "") {
      newRow[COL_O_TARGET] = valueC;
    }

    // R (requiere Q)
    const valueQ = row[COL_Q_CHECK]?.toString().trim() || "";
    if (valueQ !== "" && newRow[COL_R_TARGET]?.toString().trim() === "") {
      newRow[COL_R_TARGET] = valueC;
    }

    updatedValues.push(newRow);
  });

  // Actualiza todos los valores con un solo setValues
  range.setValues(updatedValues);

  // Log final
  Logger.log("Proceso completado con éxito.");
}
