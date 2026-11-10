import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadBaseProfiles } from '../scripts/base-profiles.mjs';
import { validateProfile } from '../dist/profiles.mjs';
import { tempDir } from './helpers/xlsx.mjs';

test('il repository pubblico non contiene Profili di base dei clienti; quelli di prova sono validi', async () => {
  // brand-profiles/ ha solo il README: il plugin distribuito parte senza Profili di base.
  assert.deepEqual(await loadBaseProfiles(new URL('../brand-profiles', import.meta.url).pathname, validateProfile), []);
  const profiles = await loadBaseProfiles(new URL('./fixtures/base-profiles', import.meta.url).pathname, validateProfile);
  assert.deepEqual(profiles.map(item => item.name), ['Aurora', 'Borealis']);
  const code = await readFile(new URL('../dist/code.js', import.meta.url), 'utf8');
  for (const profile of profiles) assert.ok(!code.includes(JSON.stringify(profile.name)), `${profile.name} nel bundle distribuito`);
});

test('un Profilo di base non valido o un nome duplicato fanno fallire la build con file e campo', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    await writeFile(join(dir, 'a.json'), JSON.stringify({ version: 2, name: 'Acme', primaryLanguage: 'XX' }));
    await assert.rejects(loadBaseProfiles(dir, validateProfile), /Profilo di base non valido \(.*a\.json\).*primaryLanguage/);
    await writeFile(join(dir, 'a.json'), JSON.stringify({ version: 2, name: 'Acme' }));
    await writeFile(join(dir, 'b.json'), JSON.stringify({ version: 2, name: 'acme' }));
    await assert.rejects(loadBaseProfiles(dir, validateProfile), /b\.json.*già usato/);
    await writeFile(join(dir, 'b.json'), JSON.stringify({ version: 2, name: 'Beta', confirmedMatches: [{ source: 'acquista ora', rowSource: 'acquista ora' }] }));
    await assert.rejects(loadBaseProfiles(dir, validateProfile), /b\.json.*confirmedMatches deve essere vuoto.*testi del cliente/);
    await writeFile(join(dir, 'b.json'), '{ rotto');
    await assert.rejects(loadBaseProfiles(dir, validateProfile), /b\.json/);
  } finally { await cleanup(); }
  assert.deepEqual(await loadBaseProfiles(join(dir, 'inesistente'), validateProfile), []);
});
