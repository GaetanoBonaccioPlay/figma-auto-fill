import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cellToMarkup, defaultOutputPath, markupToCell, planUpdates, writeUpdatedWorkbook } from '../dist/server/excel-update.mjs';
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
