function contarCeldasY() {
  const FILA_INICIO = 1518; // ← CAMBIA AQUÍ la fila desde la que quieres empezar

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('[BAYTECA] Make Response - Step 1');
  if (!sheet) {
    throw new Error('No se encontró la hoja');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < FILA_INICIO) return;

  // Columnas a evaluar: E, H, K, N, Q
  const columnas = [5, 8, 11, 14, 17]; // índices reales (1-based)
  const resultados = [];

  for (let row = FILA_INICIO; row <= lastRow; row++) {
    let contador = 0;

    columnas.forEach(col => {
      const valor = sheet.getRange(row, col).getValue();
      if (valor !== '' && valor !== null) {
        contador++;
      }
    });

    resultados.push([contador]);
  }

  // Columna Y = 25
  sheet.getRange(FILA_INICIO, 25, resultados.length, 1).setValues(resultados);
}
