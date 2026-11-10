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
const aurora = validateProfile({ name: 'Aurora', revision: 1, primaryLanguage: 'EN', languages: ['EN', 'FR', 'DE'], naming: { template: '{Nome}', start: 1 } });

test('validazione: basta il nome, codici lingua normalizzati, campo errato indicato', () => {
  const minimal = validateProfile({ name: 'Delta' });
  assert.deepEqual(minimal, { version: 2, name: 'Delta', previousNames: [], languages: [], glossary: [], ignoredLayers: [], confirmedMatches: [], excelModels: [] });
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
  const v1 = { version: 1, name: 'Aurora', naming: { template: '{Nome}', start: 1 }, primaryLanguage: 'EN', languages: ['EN', 'FR', 'DE', 'ES', 'IT'], sections: 'none', glossary: [], confirmedMatches: [] };
  const migrated = validateProfile(v1);
  assert.equal(migrated.version, 2);
  assert.deepEqual([migrated.name, migrated.languages, migrated.naming, migrated.sections], [v1.name, v1.languages, v1.naming, 'none']);
  assert.deepEqual(migrated.excelModels, []);
});

test('Profili di base del repository: versione 2 con Modelli Excel dai file reali, senza testi del cliente', async () => {
  for (const [file, sheets] of [['aurora.json', ['main', 'Feuil1']], ['borealis.json', ['sections']]]) {
    const raw = JSON.parse(await readFile(new URL(`./fixtures/base-profiles/${file}`, import.meta.url), 'utf8'));
    assert.equal(raw.version, 2);
    const profile = validateProfile(raw);
    assert.deepEqual(profile.excelModels.map(model => model.sheet), sheets);
    for (const model of profile.excelModels) {
      assert.ok(model.labels.length >= 10, `${file}: etichette sufficienti per riconoscerlo`);
      assert.ok(model.labels.every(label => label.length <= 40 && label.split(' ').length <= 6), `${file}: solo etichette brevi`);
    }
  }
  const [aurora, borealis] = await Promise.all(['aurora.json', 'borealis.json'].map(async file => validateProfile(JSON.parse(await readFile(new URL(`./fixtures/base-profiles/${file}`, import.meta.url), 'utf8')))));
  // Aurora e Borealis hanno Modelli Excel diversi e non si confondono
  for (const model of aurora.excelModels) assert.deepEqual(recognize(model, [aurora, borealis]).candidates.map(item => item.name), ['Aurora']);
  for (const model of borealis.excelModels) assert.deepEqual(recognize(model, [aurora, borealis]).candidates.map(item => item.name), ['Borealis']);
});

test('profilo effettivo: le Aggiunte personali si sommano al base e prevalgono in caso di conflitto', () => {
  const archive = new Archive([aurora]);
  archive.update('Aurora', current => ({ ...current, naming: { template: '{Nome}_{Lingua}', start: 1 }, languages: [...current.languages, 'PT_BR'], ignoredLayers: ['Legal footer'] }));
  const effective = archive.get('Aurora');
  assert.equal(effective.naming.template, '{Nome}_{Lingua}');
  assert.deepEqual(effective.languages, ['EN', 'FR', 'DE', 'PT_BR']);
  assert.equal(archive.base('Aurora').naming.template, '{Nome}', 'il Profilo di base resta intatto');
  const additions = archive.additions('Aurora');
  assert.deepEqual([additions.languages, additions.ignoredLayers, additions.naming.template], [['PT_BR'], ['Legal footer'], '{Nome}_{Lingua}']);
  assert.deepEqual(archive.list().map(item => [item.name, item.origin, item.hasAdditions]), [['Aurora', 'base', true]]);

  // nuova release: il base guadagna IT e un glossario; le aggiunte restano
  const updated = validateProfile({ ...aurora, revision: 2, languages: ['EN', 'FR', 'DE', 'IT'], glossary: [{ term: 'Thermo-Max', keep: true }] });
  const after = new Archive([updated], archive.state);
  after.reconcile();
  assert.deepEqual(after.get('Aurora').languages, ['EN', 'FR', 'DE', 'IT', 'PT_BR']);
  assert.equal(after.get('Aurora').glossary[0].term, 'Thermo-Max');
  assert.equal(after.get('Aurora').naming.template, '{Nome}_{Lingua}');

  // togliere un'esclusione del base e cancellare le aggiunte
  const withIgnored = validateProfile({ ...aurora, ignoredLayers: ['To:', 'Reply to:'] });
  const removing = new Archive([withIgnored]);
  removing.update('Aurora', current => ({ ...current, ignoredLayers: ['To:'] }));
  assert.deepEqual(removing.get('Aurora').ignoredLayers, ['To:']);
  assert.deepEqual(removing.additions('Aurora').removedIgnoredLayers, ['Reply to:']);
  removing.clearAdditions('Aurora');
  assert.deepEqual(removing.get('Aurora').ignoredLayers, ['To:', 'Reply to:']);
  assert.throws(() => removing.remove('Aurora'), /Profilo di base/);
});

test('differenze e round-trip: additionsFrom e applyAdditions sono inversi', () => {
  const changed = validateProfile({
    ...aurora, sections: 'base', languages: ['EN', 'DE', 'NL'],
    confirmedMatches: [{ source: 'shop now', rowSource: 'shop now' }], glossary: [{ term: 'Thermo', keep: true }]
  });
  const additions = additionsFrom(changed, aurora);
  assert.deepEqual(additions.languages, ['NL']);
  const back = applyAdditions(aurora, additions);
  assert.equal(back.sections, 'base');
  assert.deepEqual(back.confirmedMatches, changed.confirmedMatches);
  assert.deepEqual(back.glossary, changed.glossary);
});

test('Profili personali: creazione con il solo nome, rinomina, cancellazione, nessun doppione', () => {
  const archive = new Archive([aurora]);
  assert.equal(archive.create('Delta').name, 'Delta');
  assert.throws(() => archive.create('delta'), /Esiste già/);
  assert.throws(() => archive.create('Aurora'), /Esiste già/);
  archive.select('Delta');
  assert.equal(archive.rename('Delta', 'Delta EU').name, 'Delta EU');
  assert.equal(archive.state.selected, 'Delta EU');
  assert.throws(() => archive.rename('Aurora', 'X'), /Profilo di base/);
  archive.remove('Delta EU');
  assert.equal(archive.state.selected, null);
  assert.deepEqual(archive.list().map(item => item.name), ['Aurora']);
});

test('Profilo di base rinominato o rimosso: le aggiunte seguono il nuovo nome o diventano un Profilo personale', () => {
  const archive = new Archive([aurora]);
  archive.update('Aurora', current => ({ ...current, languages: [...current.languages, 'PT_BR'] }));
  archive.select('Aurora');
  const stored = JSON.parse(JSON.stringify(archive.state));

  const renamed = new Archive([validateProfile({ ...aurora, name: 'Aurora Gear', previousNames: ['Aurora'] })], readArchiveState(stored));
  const renameNotices = renamed.reconcile();
  assert.match(renameNotices[0], /ora si chiama "Aurora Gear"/);
  assert.deepEqual(renamed.get('Aurora Gear').languages, ['EN', 'FR', 'DE', 'PT_BR']);
  assert.equal(renamed.state.selected, 'Aurora Gear');

  const removed = new Archive([], readArchiveState(stored));
  const notices = removed.reconcile();
  assert.match(notices[0], /non è più disponibile.*profilo personale "Aurora"/);
  assert.deepEqual(removed.list().map(item => [item.name, item.origin]), [['Aurora', 'personal']]);
  assert.deepEqual(removed.get('Aurora').languages, ['EN', 'FR', 'DE', 'PT_BR']);
  assert.equal(removed.get('Aurora').naming.template, '{Nome}');
  assert.equal(removed.state.selected, 'Aurora');
  assert.deepEqual(removed.reconcile(), [], 'l\'avviso compare una volta sola');
});

test('export/import: file completo con origine, novità come aggiunte, scelte su conflitto', () => {
  const sender = new Archive([aurora]);
  sender.update('Aurora', current => ({ ...current, languages: [...current.languages, 'PT_BR'] }));
  const file = JSON.parse(JSON.stringify(sender.exportFile('Aurora')));
  assert.deepEqual(file.origin, { base: 'Aurora', revision: 1 });
  assert.deepEqual(file.profile.languages, ['EN', 'FR', 'DE', 'PT_BR']);
  assert.deepEqual(readExportFile(file).languages, file.profile.languages, 'stesso formato dei Profili di base');

  // collega senza il Profilo di base: diventa personale con lo stesso profilo effettivo
  const stranger = new Archive([]);
  const asPersonal = stranger.importFile(file);
  assert.deepEqual([asPersonal.status, asPersonal.as], ['imported', 'personal']);
  assert.deepEqual(stranger.get('Aurora').languages, sender.get('Aurora').languages);
  assert.equal(stranger.get('Aurora').revision, undefined);
  assert.equal(stranger.importFile(file).status, 'choose');
  assert.deepEqual(stranger.importFile(file, { rename: 'Aurora copia' }).name, 'Aurora copia');

  // collega con il base e aggiunte proprie: unisci o sostituisci
  const colleague = new Archive([aurora]);
  colleague.update('Aurora', current => ({ ...current, ignoredLayers: ['To:'] }));
  const ask = colleague.importFile(file);
  assert.deepEqual([ask.status, ask.choices], ['choose', ['merge', 'replace']]);
  colleague.importFile(file, { mode: 'merge' });
  assert.deepEqual([colleague.get('Aurora').languages.includes('PT_BR'), colleague.get('Aurora').ignoredLayers], [true, ['To:']]);
  colleague.importFile(file, { mode: 'replace' });
  assert.deepEqual(colleague.get('Aurora').ignoredLayers, []);

  assert.throws(() => readExportFile({ format: 'altro' }), /non è un profilo brand esportato/);
  assert.throws(() => readExportFile({ format: 'figma-auto-fill-brand-profile', version: 9 }), /Versione del profilo non supportata/);
  assert.throws(() => readExportFile([1, 2]), /non è un profilo brand/);
});

test('Livelli esclusi: regex con quantificatori annidati o troppo lunghe rifiutate; nell\'archivio salvato si toglie solo la voce', () => {
  assert.throws(() => validateProfile({ name: 'X', ignoredLayers: ['re:^(a+)+$'] }), /ignoredLayers\.0.*quantificatori annidati/);
  assert.throws(() => validateProfile({ name: 'X', ignoredLayers: [`re:${'a'.repeat(201)}`] }), /troppo lunga/);
  assert.deepEqual(validateProfile({ name: 'X', ignoredLayers: ['re:^\\d{1,2} \\w+ \\d{4}', 're:^(to|cc):$'] }).ignoredLayers.length, 2);
  const state = readArchiveState({ personal: [{ name: 'Vecchio', ignoredLayers: ['To:', 're:(\\w*)*$'] }], additions: [], selected: null });
  assert.deepEqual(state.personal.map(item => [item.name, item.ignoredLayers]), [['Vecchio', ['To:']]]);
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
    ['001', 'Subject line', 'Gear up for winter', 'Équipez-vous', 'Approved by the client marketing team on Monday morning', 'Welkom bij Aurora', 'Jetzt kaufen'],
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
  const col = validateProfile({ name: 'Aurora', excelModels: [model('Copy', ['Subject line', 'Preheader', 'CTA', 'Footer'])] });
  const borealis = validateProfile({ name: 'Borealis', excelModels: [model('Sheet1', ['Headline', 'Body copy', 'Button', 'Legal'])] });
  // stesse intestazioni generiche, etichette diverse: non si confondono
  const colExcel = model('Copy v2', ['Subject line', 'Preheader', 'CTA', 'Footer', 'Hero']);
  assert.ok(modelSimilarity(colExcel, col.excelModels[0]).score > modelSimilarity(colExcel, borealis.excelModels[0]).score + 0.3);
  const clear = recognize(colExcel, [col, borealis]);
  assert.deepEqual([clear.outcome, clear.candidates.map(item => item.name)], ['clear', ['Aurora']]);
  assert.equal(recognize(model('Altro', ['Titolo', 'Sottotitolo']), [col, borealis]).outcome, 'none');
  const both = recognize(model('Mix', ['Subject line', 'CTA', 'Headline', 'Button']), [col, borealis]);
  assert.equal(both.outcome, 'ambiguous');
  assert.equal(both.candidates.length, 2);
});
