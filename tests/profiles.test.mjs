import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Archive, EMPTY_ARCHIVE, additionsFrom, applyAdditions, extractExcelModel, modelSimilarity, readArchiveState,
  readExportFile, recognize, validateProfile
} from '../dist/profiles.mjs';

const profile = (overrides = {}) => ({
  version: 2, name: 'Acme Italia', primaryLanguage: 'it', languages: ['IT', 'en', 'DE_AT'],
  naming: { template: 'TBL-{Nome}-{Lingua}', start: 1 }, sections: 'locale',
  glossary: [{ term: 'AcmeFlex', keep: true }], ...overrides
});
const columbia = validateProfile({ name: 'Columbia', revision: 1, primaryLanguage: 'EN', languages: ['EN', 'FR', 'DE'], naming: { template: '{Nome}', start: 1 } });

test('validazione: basta il nome, codici lingua normalizzati, campo errato indicato', () => {
  const minimal = validateProfile({ name: 'Nike' });
  assert.deepEqual(minimal, { version: 2, name: 'Nike', previousNames: [], languages: [], glossary: [], ignoredLayers: [], confirmedMatches: [], excelModels: [] });
  const full = validateProfile(profile());
  assert.equal(full.primaryLanguage, 'IT');
  assert.deepEqual(full.languages, ['IT', 'EN', 'DE_AT']);
  assert.throws(() => validateProfile(profile({ primaryLanguage: 'XX' })), /primaryLanguage/);
  assert.throws(() => validateProfile(profile({ sections: 'tutte' })), /sections/);
  assert.throws(() => validateProfile(profile({ name: '  ' })), /name/);
  assert.throws(() => validateProfile(profile({ version: 7 })), /version/);
  assert.throws(() => validateProfile(profile({ ignoredLayers: ['re:('] })), /ignoredLayers\.0.*Espressione regolare non valida/);
  assert.throws(() => validateProfile(profile({ excelModels: [{ headerRow: 1 }] })), /excelModels\.0\.sheet/);
});

test('migrazione: un profilo versione 1 diventa versione 2 senza perdite', () => {
  const v1 = { version: 1, name: 'Columbia', naming: { template: '{Nome}', start: 1 }, primaryLanguage: 'EN', languages: ['EN', 'FR', 'DE', 'ES', 'IT'], sections: 'none', glossary: [], confirmedMatches: [] };
  const migrated = validateProfile(v1);
  assert.equal(migrated.version, 2);
  assert.deepEqual([migrated.name, migrated.languages, migrated.naming, migrated.sections], [v1.name, v1.languages, v1.naming, 'none']);
  assert.deepEqual(migrated.excelModels, []);
});

test('Profili di base del repository: versione 2 con Modelli Excel dai file reali, senza testi del cliente', async () => {
  for (const [file, sheets] of [['columbia.json', ['main', 'Feuil1']], ['the-north-face.json', ['sections']]]) {
    const raw = JSON.parse(await readFile(new URL(`../brand-profiles/${file}`, import.meta.url), 'utf8'));
    assert.equal(raw.version, 2);
    const profile = validateProfile(raw);
    assert.deepEqual(profile.excelModels.map(model => model.sheet), sheets);
    for (const model of profile.excelModels) {
      assert.ok(model.labels.length >= 10, `${file}: etichette sufficienti per riconoscerlo`);
      assert.ok(model.labels.every(label => label.length <= 40 && label.split(' ').length <= 6), `${file}: solo etichette brevi`);
    }
  }
  const [columbia, tnf] = await Promise.all(['columbia.json', 'the-north-face.json'].map(async file => validateProfile(JSON.parse(await readFile(new URL(`../brand-profiles/${file}`, import.meta.url), 'utf8')))));
  // Columbia e The North Face hanno Modelli Excel diversi e non si confondono
  for (const model of columbia.excelModels) assert.deepEqual(recognize(model, [columbia, tnf]).candidates.map(item => item.name), ['Columbia']);
  for (const model of tnf.excelModels) assert.deepEqual(recognize(model, [columbia, tnf]).candidates.map(item => item.name), ['The North Face']);
});

test('profilo effettivo: le Aggiunte personali si sommano al base e prevalgono in caso di conflitto', () => {
  const archive = new Archive([columbia]);
  archive.update('Columbia', current => ({ ...current, naming: { template: '{Nome}_{Lingua}', start: 1 }, languages: [...current.languages, 'PT_BR'], ignoredLayers: ['Legal footer'] }));
  const effective = archive.get('Columbia');
  assert.equal(effective.naming.template, '{Nome}_{Lingua}');
  assert.deepEqual(effective.languages, ['EN', 'FR', 'DE', 'PT_BR']);
  assert.equal(archive.base('Columbia').naming.template, '{Nome}', 'il Profilo di base resta intatto');
  const additions = archive.additions('Columbia');
  assert.deepEqual([additions.languages, additions.ignoredLayers, additions.naming.template], [['PT_BR'], ['Legal footer'], '{Nome}_{Lingua}']);
  assert.deepEqual(archive.list().map(item => [item.name, item.origin, item.hasAdditions]), [['Columbia', 'base', true]]);

  // nuova release: il base guadagna IT e un glossario; le aggiunte restano
  const updated = validateProfile({ ...columbia, revision: 2, languages: ['EN', 'FR', 'DE', 'IT'], glossary: [{ term: 'Omni-Heat', keep: true }] });
  const after = new Archive([updated], archive.state);
  after.reconcile();
  assert.deepEqual(after.get('Columbia').languages, ['EN', 'FR', 'DE', 'IT', 'PT_BR']);
  assert.equal(after.get('Columbia').glossary[0].term, 'Omni-Heat');
  assert.equal(after.get('Columbia').naming.template, '{Nome}_{Lingua}');

  // togliere un'esclusione del base e cancellare le aggiunte
  const withIgnored = validateProfile({ ...columbia, ignoredLayers: ['To:', 'Reply to:'] });
  const removing = new Archive([withIgnored]);
  removing.update('Columbia', current => ({ ...current, ignoredLayers: ['To:'] }));
  assert.deepEqual(removing.get('Columbia').ignoredLayers, ['To:']);
  assert.deepEqual(removing.additions('Columbia').removedIgnoredLayers, ['Reply to:']);
  removing.clearAdditions('Columbia');
  assert.deepEqual(removing.get('Columbia').ignoredLayers, ['To:', 'Reply to:']);
  assert.throws(() => removing.remove('Columbia'), /Profilo di base/);
});

test('differenze e round-trip: additionsFrom e applyAdditions sono inversi', () => {
  const changed = validateProfile({
    ...columbia, sections: 'base', languages: ['EN', 'DE', 'NL'],
    confirmedMatches: [{ source: 'shop now', rowSource: 'shop now' }], glossary: [{ term: 'Omni', keep: true }]
  });
  const additions = additionsFrom(changed, columbia);
  assert.deepEqual(additions.languages, ['NL']);
  const back = applyAdditions(columbia, additions);
  assert.equal(back.sections, 'base');
  assert.deepEqual(back.confirmedMatches, changed.confirmedMatches);
  assert.deepEqual(back.glossary, changed.glossary);
});

test('Profili personali: creazione con il solo nome, rinomina, cancellazione, nessun doppione', () => {
  const archive = new Archive([columbia]);
  assert.equal(archive.create('Nike').name, 'Nike');
  assert.throws(() => archive.create('nike'), /Esiste già/);
  assert.throws(() => archive.create('Columbia'), /Esiste già/);
  archive.select('Nike');
  assert.equal(archive.rename('Nike', 'Nike EU').name, 'Nike EU');
  assert.equal(archive.state.selected, 'Nike EU');
  assert.throws(() => archive.rename('Columbia', 'X'), /Profilo di base/);
  archive.remove('Nike EU');
  assert.equal(archive.state.selected, null);
  assert.deepEqual(archive.list().map(item => item.name), ['Columbia']);
});

test('Profilo di base rinominato o rimosso: le aggiunte seguono il nuovo nome o diventano un Profilo personale', () => {
  const archive = new Archive([columbia]);
  archive.update('Columbia', current => ({ ...current, languages: [...current.languages, 'PT_BR'] }));
  archive.select('Columbia');
  const stored = JSON.parse(JSON.stringify(archive.state));

  const renamed = new Archive([validateProfile({ ...columbia, name: 'Columbia Sportswear', previousNames: ['Columbia'] })], readArchiveState(stored));
  const renameNotices = renamed.reconcile();
  assert.match(renameNotices[0], /ora si chiama "Columbia Sportswear"/);
  assert.deepEqual(renamed.get('Columbia Sportswear').languages, ['EN', 'FR', 'DE', 'PT_BR']);
  assert.equal(renamed.state.selected, 'Columbia Sportswear');

  const removed = new Archive([], readArchiveState(stored));
  const notices = removed.reconcile();
  assert.match(notices[0], /non è più disponibile.*profilo personale "Columbia"/);
  assert.deepEqual(removed.list().map(item => [item.name, item.origin]), [['Columbia', 'personal']]);
  assert.deepEqual(removed.get('Columbia').languages, ['EN', 'FR', 'DE', 'PT_BR']);
  assert.equal(removed.get('Columbia').naming.template, '{Nome}');
  assert.equal(removed.state.selected, 'Columbia');
  assert.deepEqual(removed.reconcile(), [], 'l\'avviso compare una volta sola');
});

test('export/import: file completo con origine, novità come aggiunte, scelte su conflitto', () => {
  const sender = new Archive([columbia]);
  sender.update('Columbia', current => ({ ...current, languages: [...current.languages, 'PT_BR'] }));
  const file = JSON.parse(JSON.stringify(sender.exportFile('Columbia')));
  assert.deepEqual(file.origin, { base: 'Columbia', revision: 1 });
  assert.deepEqual(file.profile.languages, ['EN', 'FR', 'DE', 'PT_BR']);
  assert.deepEqual(readExportFile(file).languages, file.profile.languages, 'stesso formato dei Profili di base');

  // collega senza il Profilo di base: diventa personale con lo stesso profilo effettivo
  const stranger = new Archive([]);
  const asPersonal = stranger.importFile(file);
  assert.deepEqual([asPersonal.status, asPersonal.as], ['imported', 'personal']);
  assert.deepEqual(stranger.get('Columbia').languages, sender.get('Columbia').languages);
  assert.equal(stranger.get('Columbia').revision, undefined);
  assert.equal(stranger.importFile(file).status, 'choose');
  assert.deepEqual(stranger.importFile(file, { rename: 'Columbia copia' }).name, 'Columbia copia');

  // collega con il base e aggiunte proprie: unisci o sostituisci
  const colleague = new Archive([columbia]);
  colleague.update('Columbia', current => ({ ...current, ignoredLayers: ['To:'] }));
  const ask = colleague.importFile(file);
  assert.deepEqual([ask.status, ask.choices], ['choose', ['merge', 'replace']]);
  colleague.importFile(file, { mode: 'merge' });
  assert.deepEqual([colleague.get('Columbia').languages.includes('PT_BR'), colleague.get('Columbia').ignoredLayers], [true, ['To:']]);
  colleague.importFile(file, { mode: 'replace' });
  assert.deepEqual(colleague.get('Columbia').ignoredLayers, []);

  assert.throws(() => readExportFile({ format: 'altro' }), /non è un profilo brand esportato/);
  assert.throws(() => readExportFile({ format: 'figma-auto-fill-brand-profile', version: 9 }), /Versione del profilo non supportata/);
  assert.throws(() => readExportFile([1, 2]), /non è un profilo brand/);
});

test('archivio salvato: dati rovinati non bloccano la lettura', () => {
  assert.deepEqual(readArchiveState(null), EMPTY_ARCHIVE);
  const state = readArchiveState({ personal: [{ name: 'Ok' }, { name: '' }], additions: [{ base: 'X' }], selected: 3 });
  assert.deepEqual([state.personal.map(item => item.name), state.additions, state.selected], [['Ok'], [], null]);
});

const sheet = rows => ({ sheet: 'Copy', headerRow: 1, rows, languageColumns: [{ column: 3, code: 'EN' }, { column: 4, code: 'FR' }], idColumn: 1 });

test('Modello Excel: solo struttura ed Etichette ricorrenti, nessun testo del cliente né ID', () => {
  const model = extractExcelModel(sheet([
    ['ID', 'Field', 'EN', 'FR', 'Notes', 'Dutch NLNL', 'AT'],
    ['001', 'Subject line', 'Gear up for winter', 'Équipez-vous', 'Approved by the client marketing team on Monday morning', 'Welkom bij Columbia', 'Jetzt kaufen'],
    ['002', 'CTA', 'Shop now', 'Acheter', 'ok', 'Shop nu', ''],
    ['003', 'CTA', 'Shop', 'Acheter', '12/11/2026', '', '']
  ]));
  assert.deepEqual(model.headers.map(item => [item.header, item.code ?? null]), [['ID', null], ['Field', null], ['EN', 'EN'], ['FR', 'FR'], ['Notes', null], ['Dutch NLNL', null], ['AT', null]]);
  assert.deepEqual(model.labels, ['Subject line', 'CTA']);
  const serialized = JSON.stringify(model);
  // anche le colonne lingua non riconosciute (Dutch NLNL, AT) e le note non devono lasciar passare testi del cliente
  for (const forbidden of ['Gear up', 'Équipez', '001', 'Approved', '12/11', 'Welkom', 'Shop nu', 'Jetzt']) assert.ok(!serialized.includes(forbidden), forbidden);
});

test('riconoscimento: le Etichette ricorrenti pesano più delle intestazioni generiche; tre esiti', () => {
  const model = (name, labels) => ({ sheet: name, headerRow: 1, headers: [{ column: 1, header: 'EN', code: 'EN' }, { column: 2, header: 'FR', code: 'FR' }], labels });
  const col = validateProfile({ name: 'Columbia', excelModels: [model('Copy', ['Subject line', 'Preheader', 'CTA', 'Footer'])] });
  const tnf = validateProfile({ name: 'The North Face', excelModels: [model('Sheet1', ['Headline', 'Body copy', 'Button', 'Legal'])] });
  // stesse intestazioni generiche, etichette diverse: non si confondono
  const colExcel = model('Copy v2', ['Subject line', 'Preheader', 'CTA', 'Footer', 'Hero']);
  assert.ok(modelSimilarity(colExcel, col.excelModels[0]).score > modelSimilarity(colExcel, tnf.excelModels[0]).score + 0.3);
  const clear = recognize(colExcel, [col, tnf]);
  assert.deepEqual([clear.outcome, clear.candidates.map(item => item.name)], ['clear', ['Columbia']]);
  assert.equal(recognize(model('Altro', ['Titolo', 'Sottotitolo']), [col, tnf]).outcome, 'none');
  const both = recognize(model('Mix', ['Subject line', 'CTA', 'Headline', 'Button']), [col, tnf]);
  assert.equal(both.outcome, 'ambiguous');
  assert.equal(both.candidates.length, 2);
});
