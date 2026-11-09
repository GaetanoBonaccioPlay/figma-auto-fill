import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'figma-auto-fill-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// sheets: [{ name, rows: string[][] }]
export async function writeFixture(path, sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const { name, rows, widths } of sheets) {
    const sheet = workbook.addWorksheet(name);
    rows.forEach(row => sheet.addRow(row));
    (widths ?? []).forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  }
  await workbook.xlsx.writeFile(path);
  return path;
}

export async function readCells(path, sheetName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet(sheetName);
  return { workbook, sheet, text: (row, column) => sheet.getCell(row, column).text };
}
