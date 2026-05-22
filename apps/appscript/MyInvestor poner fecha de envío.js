function marcarFechaMyInvestor() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MyInvestor");
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // encabezados en fila 1

  const rango = sheet.getRange(2, 10, lastRow - 1, 2); // J (10) y K (11)
  const valores = rango.getValues();

  const hoy = Utilities.formatDate(
    new Date(),
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
    "dd/MM/yyyy"
  );

  for (let i = 0; i < valores.length; i++) {
    const fechaJ = valores[i][0]; // Columna J
    const estadoK = valores[i][1]; // Columna K

    if (estadoK === "SENT" && !fechaJ) {
      valores[i][0] = hoy;
    }
  }

  rango.setValues(valores);
}
