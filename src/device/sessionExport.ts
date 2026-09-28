export interface RecapRow {name: string; hands: number; chips: number}

function csvText(value: string): string {
  // Quoting alone does not stop spreadsheet applications from evaluating formulas.
  const text = /^\s*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? "'" + value : value
  return '"' + text.replace(/"/g, '""') + '"'
}

export function sessionCsv(rows: RecapRow[]): string {
  return '\ufeffSpieler,Gewonnene Hände,Chips aus Pots\n' + rows.map(row => `${csvText(row.name)},${row.hands},${row.chips}`).join('\n')
}
