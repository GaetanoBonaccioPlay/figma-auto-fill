import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tempDir } from './helpers/xlsx.mjs';

// Il pacchetto per i designer deve funzionare senza Node installato a mano e senza `npm install`:
// qui si estrae fuori dal repo (nessun node_modules raggiungibile) e si usa davvero.
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const build = await tempDir();
execFileSync('node', ['scripts/package.mjs', '--out', join(build.dir, 'release')], { cwd: new URL('..', import.meta.url).pathname });
const listing = names => names.sort().join('|');

test('lo zip del plugin contiene solo manifest, codice compilato e istruzioni', async () => {
  const files = execFileSync('unzip', ['-Z1', join(build.dir, 'release', `figma-auto-fill-plugin-v${version}.zip`)]).toString().split('\n').filter(name => name && !name.endsWith('/'));
  assert.equal(listing(files), listing([
    'figma-auto-fill-plugin/manifest.json', 'figma-auto-fill-plugin/dist/code.js', 'figma-auto-fill-plugin/dist/ui.html', 'figma-auto-fill-plugin/LEGGIMI.txt'
  ]));
  const out = join(build.dir, 'plugin');
  execFileSync('unzip', ['-q', join(build.dir, 'release', `figma-auto-fill-plugin-v${version}.zip`), '-d', out]);
  const manifest = JSON.parse(await readFile(join(out, 'figma-auto-fill-plugin/manifest.json'), 'utf8'));
  assert.equal(manifest.main, 'dist/code.js');
  assert.equal(manifest.ui, 'dist/ui.html');
  assert.match(await readFile(join(out, 'figma-auto-fill-plugin/LEGGIMI.txt'), 'utf8'), /Import plugin from manifest/);
});

test('la release contiene solo i due file da consegnare', async () => {
  assert.deepEqual((await readdir(join(build.dir, 'release'))).sort(), [`figma-auto-fill-plugin-v${version}.zip`, `figma-auto-fill-v${version}.mcpb`]);
});

test('il pacchetto .mcpb ha manifest valido nei campi richiesti e un solo file server', async () => {
  const out = join(build.dir, 'mcpb');
  execFileSync('unzip', ['-q', join(build.dir, 'release', `figma-auto-fill-v${version}.mcpb`), '-d', out]);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.version, version);
  for (const field of ['name', 'description', 'author', 'server']) assert.ok(manifest[field], field);
  assert.equal(manifest.server.type, 'node');
  assert.deepEqual((await readdir(join(out, 'server'))), ['index.cjs']);
  assert.equal(manifest.server.entry_point, 'server/index.cjs');
  assert.ok(manifest.server.mcp_config.args[0].endsWith('/server/index.cjs'));
  // ADR 0002: i Profili brand vivono nel plugin, il pacchetto non chiede più una cartella.
  assert.equal(manifest.user_config, undefined);
  assert.equal(manifest.server.mcp_config.env?.FIGMA_AUTOFILL_BRANDS_DIR, undefined);
});

test('il server impacchettato parte da solo: strumenti e bridge, e senza plugin i profili danno un errore esplicito', async () => {
  const transport = new StdioClientTransport({
    command: 'node', args: [join(build.dir, 'mcpb', 'server', 'index.cjs')],
    env: { ...process.env, FIGMA_AUTOFILL_PORT: '39081' }, cwd: build.dir
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    assert.equal((await client.listTools()).tools.length, 18);
    assert.deepEqual((await client.listPrompts()).prompts.map(prompt => prompt.name), ['localizza-frame']);
    const status = JSON.parse((await client.callTool({ name: 'bridge_status', arguments: {} })).content[0].text);
    assert.deepEqual([status.connected, status.error], [false, null]);
    const saved = await client.callTool({ name: 'save_brand_profile', arguments: { name: 'Prova' } });
    assert.equal(saved.isError, true);
    assert.match(saved.content[0].text, /plugin Figma Auto Fill non è collegato/);
  } finally { await client.close(); }
});

test.after(() => build.cleanup());
