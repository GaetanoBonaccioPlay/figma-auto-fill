import test from 'node:test';
import assert from 'node:assert/strict';
import { isIgnoredLayer, matchLayers, normalizeText, similarity } from '../dist/server/match.mjs';

const layer = (frameId, key, text) => ({ frameId, frame: `Frame ${frameId}`, key, text });
const row = (n, source, id) => ({ row: n, id, source, values: { IT: source } });

test('normalizza spazi, maiuscole, punteggiatura finale e tag', () => {
  assert.equal(normalizeText('  Scopri <b>la</b>   NUOVA collezione!! '), 'scopri la nuova collezione');
  assert.equal(normalizeText('Rock &amp; roll…'), 'rock & roll');
  assert.equal(normalizeText('Perché?'), 'perché');
});

test('similarità tra 0 e 1', () => {
  assert.equal(similarity('ciao', 'ciao'), 1);
  assert.equal(similarity('', 'ciao'), 0);
  assert.ok(similarity('spedizione gratuita sopra 50 euro', 'spedizione gratuita sopra 60 euro') > 0.9);
  assert.ok(similarity('ciao', 'xyzw') < 0.3);
});

test('esatti (anche molti-a-uno), simili, orfani, multi-livello e confermati', () => {
  const layers = [
    layer('A', 'headline', 'Scopri la nuova collezione'),
    layer('A', 'cta', 'Acquista ora'),
    layer('B', 'cta', 'ACQUISTA  ORA!'),
    layer('B', 'shipping', 'Spedizione gratuita sopra 60 euro'),
    layer('B', 'title', 'Titolo sotto'),
    layer('B', 'subtitle', 'Sottotitolo sotto'),
    layer('B', 'misc', 'Qualcosa di completamente diverso'),
    layer('B', 'promo', 'Offerta lampo'),
    layer('B', 'blank', '   ')
  ];
  const rows = [
    row(2, 'Scopri la nuova collezione!', 'H1'),
    row(3, 'Acquista ora', 'C1'),
    row(4, 'Spedizione gratuita sopra 50 euro', 'S1'),
    row(5, 'Titolo sotto\nSottotitolo sotto', 'M1'),
    row(6, 'Promo di stagione', 'P1')
  ];
  const confirmed = [
    { source: 'offerta lampo', rowId: 'P1', rowSource: 'promo di stagione' },
    { source: 'vecchio testo', rowId: 'GONE', rowSource: 'vecchio testo' }
  ];
  const result = matchLayers({ layers, rows, confirmed });

  assert.deepEqual(result.exact.map(item => [item.layer.key, item.layer.frameId, item.row, item.via]), [
    ['headline', 'A', 2, 'text'], ['cta', 'A', 3, 'text'], ['cta', 'B', 3, 'text'], ['promo', 'B', 6, 'confirmed']
  ]);
  assert.equal(result.similar.length, 1);
  assert.equal(result.similar[0].layer.key, 'shipping');
  assert.equal(result.similar[0].row, 4);
  assert.ok(result.similar[0].score >= 0.8 && result.similar[0].score < 1);
  assert.deepEqual(result.multiLevel.map(cell => [cell.row, cell.layers.map(item => item.key)]), [[5, ['title', 'subtitle']]]);
  assert.deepEqual(result.orphans.map(item => [item.layer.key, item.reason, item.row]), [
    ['title', 'multi-level', 5], ['subtitle', 'multi-level', 5], ['misc', 'no-match', undefined]
  ]);
  assert.equal(result.skippedEmpty, 1);
});

test('un abbinamento confermato che punta a una riga sparita è obsoleto e ignorato', () => {
  const result = matchLayers({
    layers: [layer('A', 'x', 'Offerta lampo')],
    rows: [row(2, 'Tutt\'altro testo', 'Z1')],
    confirmed: [{ source: 'offerta lampo', rowId: 'GONE', rowSource: 'promo' }]
  });
  assert.equal(result.exact.length, 0);
  assert.equal(result.staleConfirmed.length, 1);
  assert.equal(result.orphans[0].reason, 'no-match');
});

test('una riga con a capo che coincide con un unico livello multilinea è abbinata, non multi-livello', () => {
  const result = matchLayers({
    layers: [layer('A', 'body', 'Prima riga\nSeconda riga')],
    rows: [row(2, 'Prima riga\nSeconda riga')]
  });
  assert.equal(result.exact.length, 1);
  assert.equal(result.multiLevel.length, 0);
});

test('la soglia di similarità è configurabile', () => {
  const input = { layers: [layer('A', 'x', 'Spedizione gratuita sopra 60 euro')], rows: [row(2, 'Spedizione gratuita sopra 50 euro')] };
  assert.equal(matchLayers(input).similar.length, 1);
  assert.equal(matchLayers({ ...input, threshold: 0.99 }).similar.length, 0);
});

test('livelli ignorati: per nome, per testo normalizzato o con espressione regolare', () => {
  const patterns = ['To:', 'reply to', 're:^\\d{1,2} [a-z]+ \\d{4}', 'Logo'];
  const ignored = (key, text) => isIgnoredLayer({ key, text }, patterns);
  assert.equal(ignored('To:', 'To:'), true);
  assert.equal(ignored('Reply to:', 'Reply to:'), true, 'il testo si confronta senza punteggiatura finale');
  assert.equal(ignored('29 June 2022 18.00', '29 June 2022 18.00'), true, 'regex sul nome');
  assert.equal(ignored('data', '3 JULY 2026 09.00'), true, 'regex sul testo, senza distinzione di maiuscole');
  assert.equal(ignored('logo', 'Borealis'), true, 'per nome, senza distinzione di maiuscole');
  assert.equal(ignored('headline', 'FALL WINTER 2027'), false);
  assert.equal(ignored('toast', 'Toast'), false, 'nessuna corrispondenza parziale');
  assert.equal(isIgnoredLayer({ key: 'x', text: 'y' }, []), false);
});

test('stesso testo in più righe: traduzioni in conflitto = ambiguo, altrimenti vale la riga più completa', () => {
  const values = (source, en, de = '') => ({ IT: source, EN: en, DE: de });
  const rows = [
    { row: 2, id: 'B1', source: 'Acquista ora', values: values('Acquista ora', 'Shop now') },
    { row: 9, id: 'B2', source: 'Acquista ora', values: values('Acquista ora', 'Buy now') },
    { row: 3, source: 'Scopri', values: values('Scopri', '') },
    { row: 7, source: 'Scopri', values: values('Scopri', 'Discover', 'Entdecke') },
    { row: 4, source: 'Spedizione', values: values('Spedizione', 'Shipping') },
    { row: 8, source: 'Spedizione', values: values('Spedizione', 'SHIPPING') }
  ];
  const layers = [layer('A', 'cta', 'Acquista ora'), layer('B', 'cta', 'Acquista ora'), layer('A', 'intro', 'Scopri'), layer('A', 'ship', 'Spedizione')];
  const result = matchLayers({ layers, rows });
  assert.deepEqual(result.ambiguous.map(item => [item.layer.frameId, item.rows]), [['A', [2, 9]], ['B', [2, 9]]]);
  assert.deepEqual(result.exact.map(item => [item.layer.key, item.row]), [['intro', 7], ['ship', 4]]);
  assert.equal(result.similar.length, 0, 'un ambiguo non diventa un simile');
  // Un testo solo simile alle righe in conflitto (refuso) è ambiguo anche lui, con le stesse righe.
  const typo = matchLayers({ layers: [layer('C', 'cta', 'Acquista orra')], rows });
  assert.deepEqual([typo.similar.length, typo.ambiguous.map(item => item.rows)], [0, [[2, 9]]]);

  // Un Abbinamento confermato con l'ID della riga risolve l'ambiguità; senza ID no, e non è obsoleto.
  const remembered = matchLayers({ layers: layers.slice(0, 1), rows, confirmed: [{ source: 'acquista ora', rowId: 'B2', rowSource: 'acquista ora' }] });
  assert.deepEqual(remembered.exact.map(item => [item.row, item.via]), [[9, 'confirmed']]);
  const withoutId = matchLayers({ layers: layers.slice(0, 1), rows, confirmed: [{ source: 'acquista ora', rowSource: 'acquista ora' }] });
  assert.deepEqual([withoutId.ambiguous.length, withoutId.staleConfirmed.length], [1, 0]);
});

test('una regex catastrofica nei Livelli esclusi non blocca il server: si interrompe e dice quale voce togliere', () => {
  const started = Date.now();
  assert.throws(() => isIgnoredLayer({ key: 'x', text: `${'a'.repeat(40)}!` }, ['re:^(a|aa)+$']), /troppo lenta.*exclude_layers/);
  assert.ok(Date.now() - started < 1000, `durata ${Date.now() - started} ms`);
});
