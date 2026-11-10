import test from 'node:test';
import assert from 'node:assert/strict';
import { Archive, runProfileAction, validateProfile } from '../dist/profiles.mjs';
import { ProfilesController, prefillFrom } from '../dist/profiles-ui.mjs';

// Il codice del plugin finto: stesso archivio e stesse azioni del vero, con la stessa forma dei messaggi.
function harness(bases = [], state) {
  const archive = new Archive(bases.map(validateProfile), state);
  const states = [];
  let controller;
  const reply = message => queueMicrotask(() => controller.handle(message));
  controller = new ProfilesController({
    send: ({ requestId, request }) => {
      try {
        const { data, changed } = runProfileAction(archive, request);
        if (changed) {
          const applied = request.action === 'select' ? archive.selected() : undefined;
          reply({ kind: 'profiles-state', profiles: archive.list(), selected: archive.state.selected, notices: [], ...(applied !== undefined ? { applied, by: 'ui' } : {}) });
        }
        reply({ kind: 'profiles-result', requestId, ok: true, data });
      } catch (error) { reply({ kind: 'profiles-result', requestId, ok: false, error: error.message }); }
    },
    onState: (current, applied) => states.push({ current, applied })
  });
  return { archive, controller, states };
}
const aurora = { version: 2, name: 'Aurora', revision: 2, primaryLanguage: 'EN', languages: ['EN', 'FR', 'DE'], naming: { template: '{Nome}_{Lingua}', start: 3 }, sections: 'locale' };

test('selezionare un profilo precompila nome di output, lingue e section senza bloccarli', async () => {
  const { controller, states } = harness([aurora]);
  await controller.select('Aurora');
  const { applied } = states.at(-1);
  assert.equal(applied.profile.name, 'Aurora');
  assert.deepEqual(prefillFrom(applied.profile), { nameTemplate: '{Nome}_{Lingua}', numberStart: 3, targets: ['EN', 'FR', 'DE'], primary: 'EN', sectionMode: 'locale' });
  assert.equal(controller.origin('Aurora'), 'base');
  // un profilo con il solo nome non tocca nulla; deselezionare non precompila
  assert.deepEqual(prefillFrom(validateProfile({ name: 'Delta' })), {});
  await controller.select(null);
  assert.equal(states.at(-1).applied.profile, null);
  assert.equal(controller.state.selected, null);
});

test('crea un Profilo personale con il solo nome e lo seleziona; errori leggibili', async () => {
  const { controller, archive } = harness([aurora]);
  const created = await controller.create('  Delta ');
  assert.equal(created.name, 'Delta');
  assert.equal(controller.state.selected, 'Delta');
  assert.equal(controller.origin('Delta'), 'personal');
  await assert.rejects(controller.create('aurora'), /Esiste già un profilo "Aurora"/);
  await assert.rejects(controller.create(''), /Indica il nome/);
  await controller.rename('Delta', 'Delta EU');
  assert.deepEqual(archive.list().map(item => item.name), ['Aurora', 'Delta EU']);
  await assert.rejects(controller.remove('Aurora'), /Profilo di base/);
  await controller.remove('Delta EU');
  assert.equal(controller.state.selected, null);
});

test('export: un file .brand.json scaricabile con il profilo completo e la sua origine', async () => {
  const { controller, archive } = harness([aurora]);
  archive.update('Aurora', current => ({ ...current, languages: [...current.languages, 'PT_BR'] }));
  const { filename, content } = await controller.exportProfile('Aurora');
  assert.equal(filename, 'aurora.brand.json');
  const file = JSON.parse(content);
  assert.equal(file.format, 'figma-auto-fill-brand-profile');
  assert.deepEqual(file.origin, { base: 'Aurora', revision: 2 });
  assert.deepEqual(file.profile.languages, ['EN', 'FR', 'DE', 'PT_BR']);
});

test('import: unisci/sostituisci su un Profilo di base, sostituisci/rinomina su un personale, annullabile', async () => {
  const sender = harness([aurora]);
  sender.archive.update('Aurora', current => ({ ...current, languages: [...current.languages, 'PT_BR'] }));
  const { content } = await sender.controller.exportProfile('Aurora');

  const receiver = harness([aurora]);
  const asked = [];
  const plain = await receiver.controller.importText(content, async result => { asked.push(result); return null; });
  assert.deepEqual([plain.status, plain.as, plain.changes, asked.length], ['imported', 'additions', 1, 0], 'senza aggiunte proprie non chiede nulla');
  assert.equal(receiver.controller.state.selected, 'Aurora');
  assert.equal(receiver.controller.hasAdditions('Aurora'), true);

  receiver.archive.update('Aurora', current => ({ ...current, ignoredLayers: ['To:'] }));
  const cancelled = await receiver.controller.importText(content, async result => { asked.push(result.choices); return null; });
  assert.equal(cancelled, null);
  assert.deepEqual(asked.at(-1), ['merge', 'replace']);
  assert.deepEqual(receiver.archive.get('Aurora').ignoredLayers, ['To:'], 'annullato: nulla cambia');
  await receiver.controller.importText(content, async () => ({ mode: 'merge' }));
  assert.deepEqual([receiver.archive.get('Aurora').ignoredLayers, receiver.archive.get('Aurora').languages.includes('PT_BR')], [['To:'], true]);

  const personal = JSON.stringify({ format: 'figma-auto-fill-brand-profile', version: 2, profile: { name: 'Delta', languages: ['EN'] } });
  await receiver.controller.importText(personal, async () => null);
  const renamed = await receiver.controller.importText(personal, async result => { asked.push(result.choices); return { rename: 'Delta 2' }; });
  assert.deepEqual(asked.at(-1), ['replace', 'rename']);
  assert.equal(renamed.name, 'Delta 2');
  assert.equal(receiver.controller.state.selected, 'Delta 2');
});

test('import di un file non valido: messaggio chiaro, archivio invariato', async () => {
  const { controller, archive } = harness([aurora]);
  await assert.rejects(controller.importText('non json', async () => null), /JSON non valido/);
  await assert.rejects(controller.importText(JSON.stringify({ format: 'figma-auto-fill-brand-profile', version: 5, profile: {} }), async () => null), /Versione del profilo non supportata/);
  await assert.rejects(controller.importText(JSON.stringify({ hello: 1 }), async () => null), /non è un profilo brand/);
  assert.deepEqual(archive.state.personal, []);
});

test('la UI ignora i messaggi che non la riguardano e le risposte a richieste sconosciute', () => {
  const { controller, states } = harness([]);
  assert.equal(controller.handle({ kind: 'selection', frames: [] }), false);
  assert.equal(controller.handle({ kind: 'profiles-result', requestId: 'sconosciuta', ok: true, data: null }), true);
  assert.equal(states.length, 0);
});
