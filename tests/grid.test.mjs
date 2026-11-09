import test from 'node:test';
import assert from 'node:assert/strict';
import { fromTsv, toTsv, gridRange, pasteGrid } from '../dist/grid.mjs';

test('copia e incolla TSV con celle multilinea, tab e virgolette', () => {
  const matrix = [['A\nB', 'C\tD'], ['"citazione"', 'Fine']];
  assert.deepEqual(fromTsv(toTsv(matrix)), matrix);
  assert.deepEqual(fromTsv('EN\tNL\r\nHello\tHallo\r\n'), [['EN', 'NL'], ['Hello', 'Hallo']]);
});

test('incolla un intervallo, replica una cella e protegge il MASTER', () => {
  const rows = [
    { frame: 'Master', key: 'headline', translate: true, values: { EN: 'Master text', NL: '' } },
    { frame: 'Other', key: 'headline', translate: true, values: { EN: 'Original', NL: '' } }
  ];
  const languages = ['EN', 'NL'];
  const range = gridRange({ row: 1, col: 1 }, { row: 0, col: 0 });
  const pasted = pasteGrid(rows, languages, range, [['New master', 'Nieuw'], ['New other', 'Ander']], row => row.frame === 'Master');
  assert.deepEqual({ written: pasted.written, skipped: pasted.skipped, outside: pasted.outside }, { written: 2, skipped: 2, outside: 0 });
  assert.equal(rows[0].values.EN, 'Master text');
  assert.equal(rows[1].values.NL, 'Ander');
  const filled = pasteGrid(rows, languages, gridRange({ row: 0, col: 1 }, { row: 1, col: 1 }), [['Same']], () => false);
  assert.equal(filled.written, 2);
  assert.equal(rows[0].values.NL, 'Same');
  assert.equal(rows[1].values.NL, 'Same');
});
