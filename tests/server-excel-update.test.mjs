import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, symlinkSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeOutput, cellToMarkup, defaultOutputPath, isGeneratedCopy, markupToCell, planUpdates, writeUpdatedWorkbook } from '../dist/server/excel-update.mjs';
import ExcelJS from 'exceljs';
import { readCells, tempDir, writeFixture } from './helpers/xlsx.mjs';

const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const layer = (key, text) => ({ frameId: '1:1', frame: 'Hero_IT', key, text });
const rows = [
  { row: 2, id: 'H1', source: 'Scopri la nuova collezione', values: { IT: 'Scopri la nuova collezione', EN: 'Discover the new collection', DE: '' } },
  { row: 3, id: 'C1', source: 'Acquista ora', values: { IT: 'Acquista ora', EN: 'Shop now', DE: '' } }
];
const sent = [
  { frame: 'Hero_IT', key: 'headline', translate: true, values: { IT: 'Scopri la nuova collezione', EN: 'Discover the new collection' } },
  { frame: 'Hero_IT', key: 'cta', translate: true, values: { IT: 'Acquista ora', EN: 'Shop now' } },
  { frame: 'Hero_IT', key: 'legal', translate: false, values: { IT: 'Termini &amp; condizioni' } }
];
const base = {
  rows, languageColumns: { IT: 2, EN: 3, DE: 4 }, primary: 'IT', sourceColumn: 2, generated: sent, ai: [], overwrite: [], lastRow: 3,
  matches: [{ layer: layer('headline', 'Scopri la nuova collezione'), row: 2 }, { layer: layer('cta', 'Acquista ora'), row: 3 }],
  orphans: [layer('legal', 'Termini & condizioni')]
};
const figma = translations => [{ id: '1:1', name: 'Hero_IT', textLayers: [], existingTranslations: translations }];
const unchanged = {
  headline: { IT: 'Scopri la nuova collezione', EN: 'Discover the new collection', DE: 'Scopri la nuova collezione' },
  cta: { IT: 'Acquista ora', EN: 'Shop now', DE: 'Acquista ora' },
  legal: { IT: 'Termini &amp; condizioni', EN: 'Termini &amp; condizioni', DE: 'Termini &amp; condizioni' }
};

test('conversione cella ⇄ markup', () => {
  assert.equal(cellToMarkup('Tom & Jerry <3'), 'Tom &amp; Jerry &lt;3');
  assert.equal(cellToMarkup('Solo <b>oggi</b>'), 'Solo <b>oggi</b>');
  assert.equal(markupToCell('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.equal(markupToCell('Solo <b>oggi</b>'), 'Solo <b>oggi</b>');
});

test('il fallback non finisce nell\'Excel: nessuna scrittura se Figma non è cambiato', () => {
  const plan = planUpdates({ ...base, figma: figma(unchanged) });
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.newRows.map(item => [item.row, item.id, item.cells.map(cell => cell.text)]), [[4, 'Hero_IT/legal', ['Termini & condizioni']]]);
});

test('correzione manuale in cella vuota: scritta; in cella piena: conflitto fino a conferma', () => {
  const edited = {
    ...unchanged,
    cta: { ...unchanged.cta, DE: 'Jetzt kaufen' },
    headline: { ...unchanged.headline, EN: 'Discover our new collection' }
  };
  const plan = planUpdates({ ...base, figma: figma(edited) });
  assert.deepEqual(plan.writes.map(item => [item.row, item.language, item.text, item.source, item.kind]), [[3, 'DE', 'Jetzt kaufen', 'figma:Hero_IT', 'figma']]);
  assert.deepEqual(plan.conflicts.map(item => [item.row, item.language, item.current, item.proposed, item.reason]),
    [[2, 'EN', 'Discover the new collection', 'Discover our new collection', 'cella-piena']]);

  const confirmed = planUpdates({ ...base, figma: figma(edited), overwrite: [{ row: 2, language: 'EN' }] });
  assert.deepEqual(confirmed.conflicts, []);
  assert.deepEqual(confirmed.writes.map(item => [item.row, item.language, item.previous]), [[2, 'EN', 'Discover the new collection'], [3, 'DE', '']]);
});

test('traduzioni AI solo in celle vuote; Figma ha la precedenza; cella piena = conflitto', () => {
  const plan = planUpdates({
    ...base, figma: figma(unchanged),
    ai: [{ row: 2, language: 'DE', text: 'Entdecke die neue Kollektion' }, { row: 3, language: 'EN', text: 'Buy now' }]
  });
  assert.deepEqual(plan.writes.map(item => [item.row, item.language, item.kind, item.source]), [[2, 'DE', 'ai', 'ai']]);
  assert.deepEqual(plan.conflicts.map(item => [item.row, item.language, item.reason]), [[3, 'EN', 'cella-piena']]);
});

test('scrive una copia: originale intatto, riempimento e note, orfani in coda, stili del cliente conservati', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const input = await writeFixture(join(dir, 'cliente.xlsx'), [{
      name: 'Campagna',
      rows: [['ID', 'Italiano', 'English', 'Deutsch'], ['H1', 'Scopri la nuova collezione', 'Discover the new collection', ''], ['C1', 'Acquista ora', 'Shop now', '']],
      widths: [8, 42, 42, 42]
    }, { name: 'Altro', rows: [['x']] }]);
    const before = await hash(input);
    const edited = { ...unchanged, cta: { ...unchanged.cta, DE: 'Jetzt kaufen' } };
    const plan = planUpdates({ ...base, figma: figma(edited), ai: [{ row: 2, language: 'DE', text: 'Entdecke die neue Kollektion' }] });
    const output = defaultOutputPath(input);
    assert.equal(output, join(dir, 'cliente_updated.xlsx'));
    await writeUpdatedWorkbook({ input, output, sheet: 'Campagna', plan, idColumn: 1 });

    assert.equal(await hash(input), before);
    const { workbook, sheet, text } = await readCells(output, 'Campagna');
    assert.equal(text(3, 4), 'Jetzt kaufen');
    assert.equal(text(2, 4), 'Entdecke die neue Kollektion');
    assert.equal(text(2, 3), 'Discover the new collection');
    assert.equal(text(4, 1), 'Hero_IT/legal');
    assert.equal(text(4, 2), 'Termini & condizioni');
    assert.match(String(sheet.getCell(3, 4).note?.texts?.map(item => item.text).join('') ?? sheet.getCell(3, 4).note), /Hero_IT/);
    assert.match(String(sheet.getCell(2, 4).note?.texts?.map(item => item.text).join('') ?? sheet.getCell(2, 4).note), /AI/);
    assert.notEqual(sheet.getCell(3, 4).fill.fgColor.argb, sheet.getCell(2, 4).fill.fgColor.argb);
    assert.equal(sheet.getColumn(2).width, 42);
    assert.ok(workbook.getWorksheet('Altro'));
  } finally { await cleanup(); }
});

test('rifiuta di scrivere sopra l\'originale', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const input = await writeFixture(join(dir, 'c.xlsx'), [{ name: 'S', rows: [['a']] }]);
    await assert.rejects(writeUpdatedWorkbook({ input, output: input, sheet: 'S', plan: { writes: [], conflicts: [], newRows: [] } }), /non può coincidere/);
  } finally { await cleanup(); }
});

test('solo le righe usate: le altre vengono tolte dalla copia, intestazione e note conservate', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const input = await writeFixture(join(dir, 'cliente.xlsx'), [
      { name: 'Campagna', rows: [
        ['ID', 'Italiano', 'English', 'Deutsch'],
        ['H1', 'Scopri la nuova collezione', 'Discover the new collection', ''],
        ['X1', 'Riga non usata', 'Unused row', ''],
        ['C1', 'Acquista ora', 'Shop now', ''],
        ['X2', 'Altra riga non usata', 'Another unused row', '']
      ] },
      { name: 'Altro', rows: [['a'], ['b'], ['c']] }
    ]);
    const clientNotes = new ExcelJS.Workbook();
    await clientNotes.xlsx.readFile(input);
    clientNotes.getWorksheet('Campagna').getCell(4, 2).note = 'Nota del cliente: non cambiare';
    await clientNotes.xlsx.writeFile(input);
    const before = await hash(input);
    const edited = { ...unchanged, cta: { ...unchanged.cta, DE: 'Jetzt kaufen' } };
    const plan = planUpdates({ ...base, rows: [...rows.slice(0, 1), { ...rows[1], row: 4 }], lastRow: 5, figma: figma(edited),
      matches: [{ layer: layer('headline', 'Scopri la nuova collezione'), row: 2 }, { layer: layer('cta', 'Acquista ora'), row: 4 }], orphans: [] });
    const output = join(dir, 'cliente_updated.xlsx');
    const result = await writeUpdatedWorkbook({ input, output, sheet: 'Campagna', plan, idColumn: 1, keepRows: [2, 4], headerRow: 1 });
    assert.deepEqual(result, { removedRows: 2, copyNotes: null }, 'nessuna formula né cella unita: nessun avviso');
    assert.equal(await hash(input), before);

    const { workbook, sheet, text } = await readCells(output, 'Campagna');
    assert.equal(sheet.rowCount, 3, 'intestazione + 2 righe usate');
    assert.deepEqual([1, 2, 3].map(row => text(row, 1)), ['ID', 'H1', 'C1']);
    assert.equal(text(3, 4), 'Jetzt kaufen', 'la scrittura segue la riga anche dopo la rinumerazione');
    assert.match(String(sheet.getCell(3, 4).note?.texts?.map(item => item.text).join('') ?? sheet.getCell(3, 4).note), /Hero_IT/);
    assert.equal(workbook.getWorksheet('Altro').rowCount, 3, 'gli altri fogli non si toccano');
    const noteText = cell => String(cell.note?.texts?.map(item => item.text).join('') ?? cell.note);
    assert.match(noteText(sheet.getCell(3, 2)), /Nota del cliente/, 'le note del cliente seguono la loro riga');

    const full = await writeUpdatedWorkbook({ input, output: join(dir, 'completo.xlsx'), sheet: 'Campagna', plan });
    assert.deepEqual(full, { removedRows: 0, copyNotes: null });
    assert.equal((await readCells(join(dir, 'completo.xlsx'), 'Campagna')).sheet.rowCount, 5);
  } finally { await cleanup(); }
});

const emptyPlan = { writes: [], conflicts: [], newRows: [] };
const fingerprint = async path => { const info = await stat(path); return `${await hash(path)}|${info.size}|${info.mtimeMs}|${info.ino}`; };

test('l\'originale non si sovrascrive mai, comunque si scriva il percorso di output', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const input = await writeFixture(join(dir, 'cliente.xlsx'), [{ name: 'S', rows: [['ID', 'Italiano'], ['a', 'uno']] }]);
    const other = await writeFixture(join(dir, 'altro.xlsx'), [{ name: 'S', rows: [['x']] }]);
    await mkdir(join(dir, 'sub'));
    symlinkSync(input, join(dir, 'link.xlsx'));
    linkSync(input, join(dir, 'hard.xlsx'));
    const caseVariant = join(dir, 'CLIENTE.xlsx');
    const sameFile = /non può coincidere con l'Excel originale/;
    const hostile = [
      [input, sameFile],
      [`${dir}/sub/../cliente.xlsx`, sameFile],
      [join(dir, 'link.xlsx'), sameFile],
      [join(dir, 'hard.xlsx'), sameFile],
      [join(dir, 'altro.xlsx'), /esiste già e non è una copia generata/],
      [join(dir, 'copia.xls'), /estensione \.xlsx/],
      [join(dir, 'manca', 'copia.xlsx'), /Cartella di destinazione non trovata/]
    ];
    if (existsSync(caseVariant)) hostile.push([caseVariant, sameFile]); // disco senza distinzione maiuscole/minuscole
    const before = [await fingerprint(input), await fingerprint(other)];
    for (const [output, message] of hostile) {
      await assert.rejects(assertSafeOutput(input, output, false), message, output);
      await assert.rejects(writeUpdatedWorkbook({ input, output, sheet: 'S', plan: emptyPlan }), message, output);
      // anche con il permesso di sovrascrivere, l'originale (in qualsiasi forma) non si scrive mai
      if (message === sameFile) {
        await assert.rejects(writeUpdatedWorkbook({ input, output, sheet: 'S', plan: emptyPlan, allowOverwrite: true }), message, `allowOverwrite: ${output}`);
      }
    }
    assert.deepEqual([await fingerprint(input), await fingerprint(other)], before, 'originale e altro file identici (contenuto, dimensione, data, inode)');
    // le copie con nome nuovo sono ammesse e non lasciano file temporanei
    const copy = join(dir, 'nuova.xlsx');
    await assertSafeOutput(input, copy, false);
    await writeUpdatedWorkbook({ input, output: copy, sheet: 'S', plan: emptyPlan });
    assert.equal(await isGeneratedCopy(copy), true);
    assert.equal(await isGeneratedCopy(input), false, 'l\'originale non ha il marcatore');
    assert.equal((await readdir(dir)).some(name => name.includes('.tmp-')), false, 'nessun file temporaneo');
    assert.equal(await fingerprint(input), before[0]);
  } finally { await cleanup(); }
});

test('una copia generata si può rigenerare, un file qualunque con lo stesso nome no', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const input = await writeFixture(join(dir, 'cliente.xlsx'), [{ name: 'S', rows: [['ID', 'Italiano'], ['a', 'uno']] }]);
    const copy = join(dir, 'cliente_updated.xlsx');
    await writeUpdatedWorkbook({ input, output: copy, sheet: 'S', plan: emptyPlan });
    // stessa copia: il marcatore la rende rigenerabile anche da una sessione nuova
    await writeUpdatedWorkbook({ input, output: copy, sheet: 'S', plan: emptyPlan, allowOverwrite: await isGeneratedCopy(copy) });
    // un file del cliente che per caso si chiama *_updated.xlsx non ha il marcatore
    const theirs = await writeFixture(join(dir, 'loro_updated.xlsx'), [{ name: 'S', rows: [['x']] }]);
    const before = await fingerprint(theirs);
    assert.equal(await isGeneratedCopy(theirs), false);
    await assert.rejects(writeUpdatedWorkbook({ input, output: theirs, sheet: 'S', plan: emptyPlan, allowOverwrite: await isGeneratedCopy(theirs) }), /esiste già/);
    assert.equal(await fingerprint(theirs), before);
  } finally { await cleanup(); }
});

test('solo le righe usate su un foglio formattato fino in fondo: scrittura rapida, orfani subito dopo le righe tenute', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Copy');
    sheet.addRow(['ID', 'IT', 'EN']);
    for (let i = 2; i <= 40; i++) sheet.addRow([`R${i}`, `testo ${i}`, `text ${i}`]);
    // Formattazione senza valori fino a riga 60.000: prima la rimozione riga per riga era quadratica (minuti).
    for (let row = 41; row <= 60_000; row++) sheet.getCell(row, 2).style = { font: { name: 'Arial' } };
    const input = join(dir, 'formattato.xlsx');
    await workbook.xlsx.writeFile(input);
    const output = join(dir, 'formattato_updated.xlsx');
    const started = Date.now();
    const plan = { writes: [], conflicts: [], newRows: [{ row: 41, id: 'Hero/legal', source: 'figma:Hero', cells: [{ column: 2, language: 'IT', text: 'orfano' }] }] };
    const { removedRows } = await writeUpdatedWorkbook({ input, output, sheet: 'Copy', plan, idColumn: 1, keepRows: [5, 30], headerRow: 1 });
    assert.ok(Date.now() - started < 15_000, `scrittura troppo lenta: ${Date.now() - started} ms`);
    assert.equal(removedRows, 37);
    const { sheet: copy, text } = await readCells(output, 'Copy');
    assert.deepEqual([text(2, 1), text(3, 1), text(4, 1), text(4, 2)], ['R5', 'R30', 'Hero/legal', 'orfano']);
    assert.ok(copy.rowCount <= 4, `righe rimaste: ${copy.rowCount}`);
  } finally { await cleanup(); }
});

test('solo le righe usate: celle unite ricreate sulle righe tenute, formule segnalate e mai rotte', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Copy');
    sheet.addRow(['ID', 'IT', 'EN', 'Lunghezza']);
    for (let i = 2; i <= 8; i++) sheet.addRow([`R${i}`, `testo ${i}`, `text ${i}`, null]);
    sheet.getCell('D2').value = { formula: 'LEN(B2)', result: 7 };
    // Formula condivisa con la cella principale in una riga che verrà tolta (riempimento verso il basso in Excel).
    sheet.getCell('D5').value = { sharedFormula: 'D2', result: 7 };
    sheet.mergeCells('B7:C7');   // unione orizzontale in una riga tenuta
    sheet.mergeCells('A3:A4');   // unione verticale: si tiene solo la riga 4, dove il valore non c'è
    sheet.mergeCells('A8:B8');   // unione in una riga tolta
    const input = join(dir, 'unite.xlsx');
    await workbook.xlsx.writeFile(input);
    const output = join(dir, 'unite_updated.xlsx');
    const plan = { writes: [], conflicts: [], newRows: [] };
    const { copyNotes } = await writeUpdatedWorkbook({ input, output, sheet: 'Copy', plan, keepRows: [4, 5, 7], headerRow: 1 });
    assert.deepEqual(copyNotes.formulaCells, ['D3'], 'indirizzo nella copia (D5 nell\'originale)');
    assert.deepEqual(copyNotes.reducedMerges, ['A3:A4']);
    const { sheet: copy, text } = await readCells(output, 'Copy');
    assert.deepEqual(copy.model.merges, ['B4:C4']);
    assert.equal(text(2, 1), 'R3', 'il valore di un\'unione passa alla prima riga tenuta');
    assert.equal(text(4, 2), 'testo 7');
    assert.equal(copy.getCell('C4').isMerged, true);
    assert.deepEqual(copy.getCell('D3').value, { formula: 'LEN(B5)', result: 7 });
    assert.equal(copy.rowCount, 4);
  } finally { await cleanup(); }
});

test('righe aggiunte dopo una cella con solo spazi: ognuna nella sua riga, subito dopo le righe tenute; mai su una riga tolta', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Copy');
    sheet.addRow(['ID', 'IT', 'EN']);
    for (let i = 2; i <= 10; i++) sheet.addRow([`R${i}`, `testo ${i}`, `text ${i}`]);
    sheet.getCell('A11').value = ' ';   // per readSheets la riga 11 è vuota: il piano numera le aggiunte da 11
    const input = join(dir, 'spazi.xlsx');
    await workbook.xlsx.writeFile(input);
    const newRows = Array.from({ length: 9 }, (_, i) => ({ row: 11 + i, id: `Hero/orfano${i}`, source: 'figma:Hero', cells: [{ column: 2, language: 'IT', text: `orfano ${i}` }] }));
    await writeUpdatedWorkbook({ input, output: join(dir, 'spazi_updated.xlsx'), sheet: 'Copy', plan: { writes: [], conflicts: [], newRows }, idColumn: 1, keepRows: [2, 3], headerRow: 1, appendAfter: 10 });
    const { text } = await readCells(join(dir, 'spazi_updated.xlsx'), 'Copy');
    assert.deepEqual(Array.from({ length: 9 }, (_, i) => text(4 + i, 2)), newRows.map((_, i) => `orfano ${i}`));
    assert.deepEqual([text(2, 1), text(3, 1), text(4, 1)], ['R2', 'R3', 'Hero/orfano0']);

    const stray = { writes: [{ row: 7, column: 3, language: 'EN', text: 'AI', previous: '', kind: 'ai', source: 'ai' }], conflicts: [], newRows: [] };
    await assert.rejects(writeUpdatedWorkbook({ input, output: join(dir, 'stray_updated.xlsx'), sheet: 'Copy', plan: stray, keepRows: [2, 3], headerRow: 1, appendAfter: 10 }),
      /Riga 7: non è tra le righe usate/);
  } finally { await cleanup(); }
});

test('formula matrice nella sua riga: resta matrice, con l\'intervallo spostato', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Copy');
    sheet.addRow(['ID', 'IT', 'Somma']);
    for (let i = 2; i <= 6; i++) sheet.addRow([`R${i}`, `testo ${i}`, null]);
    sheet.getCell('C5').value = { formula: 'SUM(LEN(B2:B4))', result: 21, shareType: 'array', ref: 'C5' };
    const input = join(dir, 'matrice.xlsx');
    await workbook.xlsx.writeFile(input);
    await writeUpdatedWorkbook({ input, output: join(dir, 'matrice_updated.xlsx'), sheet: 'Copy', plan: { writes: [], conflicts: [], newRows: [] }, keepRows: [5], headerRow: 1 });
    const { sheet: copy } = await readCells(join(dir, 'matrice_updated.xlsx'), 'Copy');
    const value = copy.getCell('C2').value;
    assert.deepEqual([value.formula, value.shareType, value.ref], ['SUM(LEN(B2:B4))', 'array', 'C2']);
  } finally { await cleanup(); }
});
