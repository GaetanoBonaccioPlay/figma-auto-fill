import * as XLSX from 'xlsx';
import { FIXED_HEADERS, normalizeLanguage, SHEET_NAME, type TranslationRow } from './core';

export function writeWorkbook(rows: TranslationRow[], languages: string[]): Uint8Array {
  if (!rows.length) throw new Error('Nessun dato Excel da scaricare');
  const unique = [...new Set(languages.map(normalizeLanguage))];
  const data: (string | number)[][] = [
    [...FIXED_HEADERS, ...unique],
    ...rows.map(row => [row.frame, row.key, row.translate ? 'Sì' : 'No', ...unique.map(code => row.values[code] ?? '')])
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = [{ wch: 35 }, { wch: 28 }, { wch: 12 }, ...unique.map(() => ({ wch: 45 }))];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}

export function readWorkbook(bytes: ArrayBuffer | Uint8Array): { rows: TranslationRow[]; languages: string[] } {
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Foglio ${SHEET_NAME} non trovato`);
  const cells = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(sheet, { header: 1, defval: '', raw: false });
  if (!cells.length) throw new Error('Il foglio Translations è vuoto');
  const headers = cells[0].map(value => String(value).trim());
  if (FIXED_HEADERS.some((header, index) => headers[index] !== header)) throw new Error(`Le prime colonne devono essere: ${FIXED_HEADERS.join(', ')}`);
  const languages = headers.slice(3).map(normalizeLanguage);
  if (!languages.length || new Set(languages).size !== languages.length) throw new Error('Colonne lingua mancanti o duplicate');
  const rows: TranslationRow[] = [];
  for (let index = 1; index < cells.length; index++) {
    const cellsInRow = cells[index];
    if (!cellsInRow || cellsInRow.every(value => String(value).trim() === '')) continue;
    const frame = String(cellsInRow[0] ?? '').trim();
    const key = String(cellsInRow[1] ?? '').trim();
    const rawTranslate = String(cellsInRow[2] ?? '').trim().toLowerCase();
    if (!frame || !key) throw new Error(`Riga ${index + 1}: Frame e Key sono obbligatori`);
    if (!['sì', 'si', 'yes', 'true', '1', 'no', 'false', '0', ''].includes(rawTranslate)) throw new Error(`Riga ${index + 1}: Traduci deve essere Sì o No`);
    const values = Object.fromEntries(languages.map((lang, offset) => [lang, String(cellsInRow[offset + 3] ?? '')])) as Record<string, string>;
    rows.push({ frame, key, translate: ['sì', 'si', 'yes', 'true', '1'].includes(rawTranslate), values });
  }
  if (!rows.length) throw new Error('Nessuna riga nel foglio Translations');
  return { rows, languages };
}
