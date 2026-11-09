import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrandStore, validateProfile } from '../dist/server/brands.mjs';
import { tempDir } from './helpers/xlsx.mjs';

const profile = (overrides = {}) => ({
  version: 1, name: 'Acme Italia', primaryLanguage: 'it', languages: ['IT', 'en', 'DE_AT'],
  naming: { template: 'TBL-{Nome}-{Lingua}', start: 1 }, sections: 'locale',
  glossary: [{ term: 'AcmeFlex', keep: true }], ...overrides
});

test('salva, elenca e rilegge un profilo con codici lingua normalizzati', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const store = new BrandStore(join(dir, 'brands'));
    assert.deepEqual(await store.list(), []);
    const saved = await store.save(profile());
    assert.equal(saved.primaryLanguage, 'IT');
    assert.deepEqual(saved.languages, ['IT', 'EN', 'DE_AT']);
    assert.deepEqual(await store.list(), [{ name: 'Acme Italia', primaryLanguage: 'IT', languages: ['IT', 'EN', 'DE_AT'] }]);
    assert.equal((await store.get('acme italia')).naming.template, 'TBL-{Nome}-{Lingua}');
    assert.equal(await store.get('Altro'), null);
  } finally { await cleanup(); }
});

test('un profilo non valido indica il campo errato', async () => {
  assert.throws(() => validateProfile(profile({ primaryLanguage: 'XX' })), /primaryLanguage/);
  assert.throws(() => validateProfile(profile({ sections: 'tutte' })), /sections/);
  assert.throws(() => validateProfile(profile({ name: '  ' })), /name/);
  assert.throws(() => validateProfile(profile({ version: 2 })), /version/);
});

test('esporta e importa: round-trip identico, conflitti mai sovrascritti in silenzio', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const sender = new BrandStore(join(dir, 'a'));
    const receiver = new BrandStore(join(dir, 'b'));
    const original = await sender.save(profile({ confirmedMatches: [{ source: 'acquista ora', rowId: 'C1', rowSource: 'acquista ora' }] }));
    const file = join(dir, 'acme.json');
    await sender.exportTo('Acme Italia', file);

    const first = await receiver.importFrom(file);
    assert.equal(first.status, 'imported');
    assert.deepEqual(await receiver.get('Acme Italia'), original);

    await receiver.save(profile({ naming: { template: 'MODIFICATO', start: 5 } }));
    const conflict = await receiver.importFrom(file);
    assert.equal(conflict.status, 'conflict');
    assert.equal((await receiver.get('Acme Italia')).naming.template, 'MODIFICATO');

    assert.equal((await receiver.importFrom(file, { rename: 'Acme Copia' })).status, 'imported');
    assert.equal((await receiver.importFrom(file, { overwrite: true })).status, 'imported');
    assert.equal((await receiver.get('Acme Italia')).naming.template, 'TBL-{Nome}-{Lingua}');
  } finally { await cleanup(); }
});

test('rifiuta file che non sono profili o hanno una versione non supportata', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const store = new BrandStore(join(dir, 'b'));
    const other = join(dir, 'altro.json');
    await writeFile(other, JSON.stringify({ hello: 'world' }));
    await assert.rejects(store.importFrom(other), /non è un profilo brand/);
    await writeFile(other, JSON.stringify({ format: 'figma-auto-fill-brand-profile', version: 99, profile: profile() }));
    await assert.rejects(store.importFrom(other), /Versione del profilo non supportata: 99/);
    await assert.rejects(store.importFrom(join(dir, 'manca.json')), /non leggibile/);
    assert.match(await readFile(other, 'utf8'), /99/);
  } finally { await cleanup(); }
});
