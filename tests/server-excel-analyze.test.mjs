import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { analyzeSheet, analyzeWorkbook, columnLetter, columnNumber, languageFromHeader, readSheets } from '../dist/server/excel-analyze.mjs';
import { tempDir, writeFixture } from './helpers/xlsx.mjs';

test('riconosce lingue da nomi, codici e varianti di paese', () => {
  const cases = {
    Italiano: 'IT', English: 'EN', Deutsch: 'DE', 'Français': 'FR', 'Español': 'ES', Nederlands: 'NL', 'Čeština': 'CS',
    'FR-fr': 'FR_FR', en_gb: 'EN_GB', 'English (UK)': 'EN_GB', 'Deutsch - AT': 'DE_AT', 'Testo italiano': 'IT',
    IT: 'IT', 'Tedesco (Svizzera)': 'DE_CH'
  };
  for (const [header, code] of Object.entries(cases)) assert.equal(languageFromHeader(header)?.code, code, header);
  assert.ok(languageFromHeader('Italiano').confidence > languageFromHeader('IT').confidence);
});

test('non scambia ID, note e stati per lingue', () => {
  for (const header of ['ID', 'No', 'Key', 'Note', 'Stato', 'Commenti', 'Riga', '', 'Frame', 'Character limit']) {
    assert.equal(languageFromHeader(header), null, header);
  }
});

test('colonne: lettere e numeri', () => {
  assert.equal(columnLetter(1), 'A');
  assert.equal(columnLetter(27), 'AA');
  assert.equal(columnNumber('c'), 3);
  assert.equal(columnNumber('AA'), 27);
  assert.throws(() => columnNumber('1A'), /non valido/);
});

test('sceglie il foglio giusto, salta le righe di titolo e ignora le colonne non linguistiche', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const path = await writeFixture(join(dir, 'cliente.xlsx'), [
      { name: 'Istruzioni', rows: [['Leggimi'], ['Compila il foglio campagna']] },
      { name: 'Campagna AW26', rows: [
        ['Campagna AW26 — copy', '', '', '', ''],
        ['ID', 'Italiano', 'English', 'Deutsch', 'FR-fr', 'Note'],
        ['H1', 'Scopri la nuova collezione!', 'Discover the new collection', '', '', 'ok'],
        ['C1', 'Acquista ora', 'Shop now', '', '', ''],
        ['', '', '', '', '', '']
      ] }
    ]);
    const report = analyzeWorkbook(path, await readSheets(path), { primary: 'IT', profileLanguages: ['IT', 'EN', 'ES'] });
    assert.equal(report.analysis.sheet, 'Campagna AW26');
    assert.equal(report.analysis.headerRow, 2);
    assert.deepEqual(report.analysis.languageColumns.map(item => [item.letter, item.code]), [['B', 'IT'], ['C', 'EN'], ['D', 'DE'], ['E', 'FR_FR']]);
    assert.deepEqual(report.analysis.ignoredColumns.map(item => item.header), ['ID', 'Note']);
    assert.equal(report.analysis.idColumn, 1);
    assert.equal(report.analysis.dataRows, 2);
    assert.deepEqual(report.sourceColumn, { column: 2, letter: 'B', code: 'IT' });
    assert.deepEqual(report.differences, { missingInExcel: ['ES'], extraInExcel: ['DE', 'FR_FR'] });
    assert.ok(report.warnings.some(warning => /vale l'Excel/.test(warning)));
    assert.equal(report.sheets.length, 2);
  } finally { await cleanup(); }
});

test('segnala lingua principale assente, foglio inesistente e lingue duplicate', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const path = await writeFixture(join(dir, 'c.xlsx'), [
      { name: 'S', rows: [['English', 'English (copy)', 'Deutsch'], ['a', 'b', 'c']] }
    ]);
    const sheets = await readSheets(path);
    const report = analyzeWorkbook(path, sheets, { primary: 'IT' });
    assert.equal(report.sourceColumn, null);
    assert.ok(report.warnings.some(warning => /Nessuna colonna per la lingua principale IT/.test(warning)));
    assert.ok(report.warnings.some(warning => /EN in più colonne/.test(warning)));
    assert.throws(() => analyzeWorkbook(path, sheets, { sheet: 'Altro' }), /Foglio "Altro" non trovato/);
    assert.deepEqual(analyzeSheet({ name: 'vuoto', rows: [['a', 'b']] }).languageColumns, []);
  } finally { await cleanup(); }
});
