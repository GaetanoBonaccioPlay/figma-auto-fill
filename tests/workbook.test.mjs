import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readWorkbook, writeWorkbook } from '../dist/workbook.mjs';

test('template Excel: roundtrip di lingue, tag, multilinea e colonna Traduci', () => {
  const rows = [
    { frame: '260717_Hero_NL', key: 'headline', translate: true, values: { EN: '<b>Sale</b>\nnow', NL: 'Tot 50% korting', FR: '' } },
    { frame: '260717_Hero_NL', key: 'static', translate: false, values: { EN: 'Vans', NL: 'Vans', FR: '' } }
  ];
  const bytes = writeWorkbook(rows, ['EN', 'NL', 'FR']);
  const parsed = readWorkbook(bytes);
  assert.deepEqual(parsed.languages, ['EN', 'NL', 'FR']);
  assert.deepEqual(parsed.rows, rows);
});

test('rifiuta workbook senza righe e codici lingua duplicati', () => {
  assert.throws(() => writeWorkbook([], ['EN']), /Nessun dato/);
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Frame', 'Key', 'Traduci', 'EN', 'en'],
    ['Hero', 'head', 'Sì', 'Sale', 'Sale']
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Translations');
  const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  assert.throws(() => readWorkbook(bytes), /duplicate/);
});
