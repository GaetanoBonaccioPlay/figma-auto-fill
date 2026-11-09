import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, symlinkSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WebSocket } from 'ws';
import { BrandStore } from '../dist/server/brands.mjs';
import { Bridge } from '../dist/server/bridge.mjs';
import { createMcpServer, todayStamp } from '../dist/server/tools.mjs';
import { readCells, tempDir, writeFixture } from './helpers/xlsx.mjs';

const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');

const FRAME = {
  id: '1:1', name: 'Hero_IT', label: 'Hero_IT', baseName: 'Hero', width: 1080, height: 1920, sourceLanguage: 'EN',
  textLayers: [
    { id: 't1', key: 'headline', text: 'Scopri la nuova collezione', markup: 'Scopri la nuova collezione' },
    { id: 't2', key: 'cta', text: 'Acquista ora', markup: 'Acquista ora' },
    { id: 't3', key: 'legal', text: 'Termini applicabili', markup: 'Termini applicabili' }
  ]
};

// Gli export che il vero plugin produrrebbe: testo della lingua, altrimenti lingua base, altrimenti principale;
// le righe non attive restano al testo originale. `manual` simula le correzioni fatte a mano in Figma.
function exportsFrom(payload, manual = {}) {
  const result = {};
  for (const row of payload.rows) {
    result[row.key] = {};
    for (const language of payload.targets) {
      const candidates = [language, language.split('_')[0], payload.primary];
      result[row.key][language] = row.translate
        ? row.values[candidates.find(code => row.values[code]?.trim())]
        : row.values[payload.primary];
    }
  }
  for (const [key, languages] of Object.entries(manual)) Object.assign(result[key] ?? (result[key] = {}), languages);
  return result;
}

// Plugin finto: risponde come farebbe il vero, con selezione, piano di generazione ed export correnti.
function fakePlugin(bridge, state) {
  const calls = [];
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
  ws.on('open', () => ws.send(JSON.stringify({ hello: 'figma-auto-fill-plugin' })));
  ws.on('message', raw => {
    const request = JSON.parse(String(raw));
    calls.push(request);
    const reply = data => ws.send(JSON.stringify({ id: request.id, ok: true, data }));
    if (request.command === 'snapshot') {
      const generated = request.payload?.frameIds;
      reply({ frames: [{ ...FRAME, ...(generated ? { existingTranslations: state.exports } : {}) }] });
    } else if (request.command === 'ui-state') {
      if (state.ui) reply(state.ui);
      else ws.send(JSON.stringify({ id: request.id, ok: false, error: 'Questa versione del plugin non espone lo stato della UI' }));
    } else if (request.command === 'plan') {
      reply({ replacements: state.existing, selections: [] });
    } else if (request.command === 'generate') {
      state.generated = request.payload;
      state.exports = exportsFrom(request.payload, state.manual);
      reply({ names: ['Hero_IT', 'Hero_EN', 'Hero_DE'], warnings: ['Hero_IT / cta / DE: usato IT'] });
    }
  });
  return { ws, calls };
}

async function setup() {
  const { dir, cleanup } = await tempDir();
  const bridge = new Bridge({ port: 0 });
  await bridge.start();
  const brands = new BrandStore(join(dir, 'brands'));
  const server = createMcpServer({ bridge, brands, now: () => new Date(2026, 10, 9) });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
  };
  const connectPlugin = async state => {
    const plugin = fakePlugin(bridge, state);
    for (let i = 0; i < 100 && !bridge.connected; i++) await new Promise(resolve => setTimeout(resolve, 10));
    return plugin;
  };
  return { dir, bridge, call, client, connectPlugin, close: async () => { await client.close(); await bridge.close(); await cleanup(); } };
}

test('espone gli strumenti e il prompt localizza-frame con i passi nell\'ordine previsto', async () => {
  const env = await setup();
  try {
    const tools = (await env.client.listTools()).tools.map(tool => tool.name);
    for (const name of ['bridge_status', 'get_selection', 'list_brand_profiles', 'get_brand_profile', 'save_brand_profile', 'export_brand_profile',
      'import_brand_profile', 'analyze_client_excel', 'match_selection', 'confirm_matches', 'generate_exports', 'write_updated_excel',
      'list_empty_cells', 'save_ai_translations']) assert.ok(tools.includes(name), name);
    const prompts = (await env.client.listPrompts()).prompts;
    assert.deepEqual(prompts.map(prompt => prompt.name), ['localizza-frame']);
    const prompt = await env.client.getPrompt({ name: 'localizza-frame', arguments: { brand: 'Acme' } });
    const text = prompt.messages[0].content.text;
    assert.match(text, /Brand: Acme/);
    const order = ['BRAND', 'EXCEL CLIENTE', 'SELEZIONE', 'ABBINAMENTO', 'GENERAZIONE', 'EXCEL AGGIORNATO', 'TRADUZIONE AI'].map(label => text.indexOf(label));
    assert.ok(order.every((position, index) => position > (order[index - 1] ?? -1)), 'i passi devono comparire in ordine');
    assert.match(text, /SOLO se il designer vuole/);
    assert.match(text, /incongruenza.*NON decidere da solo.*fai una domanda/s);
  } finally { await env.close(); }
});

test('senza plugin: stato non collegato ed errore esplicito, senza brand non si analizza', async () => {
  const env = await setup();
  try {
    assert.equal((await env.call('bridge_status')).data.connected, false);
    const selection = await env.call('get_selection');
    assert.equal(selection.isError, true);
    assert.match(selection.text, /non è collegato/);
    const excel = await writeFixture(join(env.dir, 'c.xlsx'), [{ name: 'S', rows: [['Italiano'], ['a']] }]);
    const analysis = await env.call('analyze_client_excel', { path: excel });
    assert.equal(analysis.isError, true);
    assert.match(analysis.text, /Scegli prima il Brand/);
  } finally { await env.close(); }
});

test('dialogo completo: brand → Excel → lingue → abbinamento → generazione (conflitto) → Excel aggiornato → traduzione AI', async () => {
  const env = await setup();
  const state = {
    existing: [{ id: '9:1', name: 'Hero_EN', language: 'EN' }],
    exports: {},
    manual: { cta: { DE: 'Jetzt kaufen' } } // il designer corregge a mano il tedesco dopo la generazione
  };
  try {
    const excel = await writeFixture(join(env.dir, 'cliente.xlsx'), [{
      name: 'Campagna AW26',
      rows: [
        ['ID', 'Italiano', 'English', 'Deutsch', 'Français', 'Note'],
        ['H1', 'Scopri la nuova collezione!', 'Discover the new collection', 'Entdecke die neue Kollektion', '', 'ok'],
        ['C1', 'Acquista ora', 'Shop now', '', '', ''],
        ['X1', 'Testo non usato dai frame', 'Text not used by the frames', '', '', '']
      ]
    }]);
    const original = await hash(excel);

    // 1. Brand
    assert.deepEqual((await env.call('list_brand_profiles')).data.brands, []);
    const brand = await env.call('save_brand_profile', {
      name: 'Acme', primaryLanguage: 'IT', languages: ['IT', 'EN', 'DE', 'FR'], naming: { template: '{Nome}-{Lingua}' }, sections: 'locale',
      glossary: [{ term: 'collezione', translations: { DE: 'Kollektion' } }]
    });
    assert.equal(brand.data.sections, 'locale');
    assert.equal((await env.call('get_brand_profile', { name: 'Acme' })).data.naming.template, '{Nome}-{Lingua}');
    assert.match((await env.call('get_brand_profile', { name: 'Nope' })).text, /non trovato.*Acme/);

    // 2. Excel cliente + conferma lingue
    const analysis = (await env.call('analyze_client_excel', { path: excel })).data;
    assert.deepEqual(analysis.analysis.languageColumns.map(item => `${item.letter}:${item.code}`), ['B:IT', 'C:EN', 'D:DE', 'E:FR']);
    assert.equal(analysis.sourceColumn.letter, 'B');
    assert.deepEqual(analysis.differences, { missingInExcel: [], extraInExcel: [] });

    // 3-4. Selezione e abbinamento
    const plugin = await env.connectPlugin(state);
    assert.equal((await env.call('bridge_status')).data.connected, true);
    assert.equal((await env.call('get_selection')).data.frames[0].textLayers.length, 3);
    const match = (await env.call('match_selection')).data;
    assert.deepEqual(match.summary, { layers: 3, exact: 2, similar: 0, orphans: 1, multiLevel: 0, emptyLayersSkipped: 0, excluded: 0 });
    assert.deepEqual(match.orphans.map(item => item.key), ['legal']);
    // FR non ha traduzioni nelle righe usate dai frame: non serve generarla
    assert.deepEqual(match.languages.needed, ['IT', 'EN', 'DE']);
    assert.deepEqual(match.languages.notNeeded, ['FR']);
    assert.deepEqual(match.languages.coverage.DE, { filled: 1, of: 2, missingRows: [3] });
    const confirm = (await env.call('confirm_matches', { accept_similar: 'all' })).data;
    assert.equal(confirm.matched, 2);

    // 5. Generazione: prima conflitto, poi sostituzione
    const conflict = (await env.call('generate_exports')).data;
    assert.equal(conflict.status, 'conflict');
    assert.deepEqual(conflict.existing, [{ name: 'Hero_EN', language: 'EN' }]);
    assert.equal(state.generated, undefined, 'nessuna generazione senza scelta');
    const done = (await env.call('generate_exports', { on_conflict: 'replace' })).data;
    assert.equal(done.status, 'done');
    assert.equal(done.fallbackCells, 1);
    assert.equal(state.generated.collisionMode, 'replace');
    assert.deepEqual(state.generated.confirmedReplacementIds, ['9:1']);
    assert.equal(state.generated.sectionMode, 'locale');
    assert.deepEqual(state.generated.naming, { template: '{Nome}-{Lingua}', start: 1, date: todayStamp(new Date(2026, 10, 9)) });
    assert.equal(todayStamp(new Date(2026, 10, 9)), '261109');
    assert.deepEqual(state.generated.targets, ['IT', 'EN', 'DE']);
    assert.deepEqual(state.generated.rows.map(row => [row.key, row.translate]), [['headline', true], ['cta', true], ['legal', false]]);
    assert.deepEqual(state.generated.rows[1].values, { IT: 'Acquista ora', EN: 'Shop now' });
    assert.equal(state.generated.rows[0].values.DE, 'Entdecke die neue Kollektion');

    // 6. Excel aggiornato: la correzione DE in Figma finisce nella cella vuota, l'orfano in coda, l'originale resta intatto
    const written = (await env.call('write_updated_excel')).data;
    assert.equal(written.output, join(env.dir, 'cliente_updated.xlsx'));
    assert.deepEqual(written.written.map(item => [item.row, item.column, item.language, item.text, item.source]), [[3, 'D', 'DE', 'Jetzt kaufen', 'figma:Hero_IT']]);
    assert.deepEqual(written.addedRows, [], 'di base gli orfani non vengono aggiunti');
    assert.deepEqual(written.orphansNotAdded.map(item => item.key), ['legal']);
    assert.deepEqual([written.rows.kept, written.rows.removed, written.rows.onlyUsedRows], [2, 1, true]);
    assert.deepEqual(written.conflicts, []);
    assert.equal(await hash(excel), original);
    let cells = await readCells(written.output, 'Campagna AW26');
    assert.equal(cells.sheet.rowCount, 3, 'intestazione + solo le 2 righe usate dai frame');
    assert.equal(cells.text(3, 4), 'Jetzt kaufen');
    assert.equal(cells.text(4, 2), '', 'la riga non usata non c\'è più');

    // su richiesta: orfani in coda e/o tutte le righe del cliente
    const withOrphans = (await env.call('write_updated_excel', { add_orphans: true })).data;
    assert.deepEqual(withOrphans.addedRows, [{ row: 5, id: 'Hero_IT/legal' }]);
    assert.equal(withOrphans.orphansNotAdded, undefined);
    cells = await readCells(withOrphans.output, 'Campagna AW26');
    assert.equal(cells.text(4, 2), 'Termini applicabili');
    const everything = (await env.call('write_updated_excel', { only_used_rows: false })).data;
    assert.deepEqual([everything.rows.removed, everything.rows.onlyUsedRows], [0, false]);
    assert.equal((await readCells(everything.output, 'Campagna AW26')).sheet.rowCount, 4);
    cells = await readCells((await env.call('write_updated_excel')).data.output, 'Campagna AW26');

    // conflitto su cella piena: non toccata finché il designer non conferma
    state.manual = { cta: { DE: 'Jetzt kaufen' }, headline: { EN: 'Discover our new collection' } };
    state.exports = exportsFrom(state.generated, state.manual);
    const conflicted = (await env.call('write_updated_excel')).data;
    assert.deepEqual(conflicted.conflicts.map(item => [item.row, item.language, item.reason]), [[2, 'EN', 'cella-piena']]);
    cells = await readCells(conflicted.output, 'Campagna AW26');
    assert.equal(cells.text(2, 3), 'Discover the new collection');
    const forced = (await env.call('write_updated_excel', { overwrite: [{ row: 2, language: 'EN' }] })).data;
    assert.deepEqual(forced.conflicts, []);
    assert.equal((await readCells(forced.output, 'Campagna AW26')).text(2, 3), 'Discover our new collection');

    // 7. Traduzione AI, solo su richiesta e solo celle vuote
    const empty = (await env.call('list_empty_cells')).data;
    assert.deepEqual(empty.cells.map(cell => `${cell.row}/${cell.language}`), ['2/FR', '3/DE', '3/FR']);
    assert.deepEqual(empty.cells[0].glossary, [{ term: 'collezione', keep: false }]);
    assert.match((await env.call('save_ai_translations', { translations: [{ row: 2, language: 'EN', text: 'x' }] })).text, /non è vuota/);
    assert.match((await env.call('save_ai_translations', { translations: [{ row: 2, language: 'IT', text: 'x' }] })).text, /non traducibile/);
    assert.equal((await env.call('save_ai_translations', { translations: [{ row: 2, language: 'FR', text: 'Découvrez la nouvelle collection' }] })).data.saved, 1);
    assert.equal((await env.call('list_empty_cells')).data.count, 2);
    await env.call('generate_exports', { on_conflict: 'replace' }); // rigenera: le correzioni manuali vengono perse nel finto, come in un nuovo export
    state.manual = { cta: { DE: 'Jetzt kaufen' } };
    state.exports = exportsFrom(state.generated, state.manual);
    assert.deepEqual(state.generated.targets, ['IT', 'EN', 'DE', 'FR'], 'con una Traduzione AI anche FR diventa necessaria');
    assert.equal(state.generated.rows[0].values.FR, 'Découvrez la nouvelle collection');
    const withAi = (await env.call('write_updated_excel', { overwrite: [{ row: 2, language: 'EN' }] })).data;
    assert.ok(withAi.written.some(item => item.language === 'FR' && item.source === 'ai' && item.text === 'Découvrez la nouvelle collection'));
    cells = await readCells(withAi.output, 'Campagna AW26');
    assert.equal(cells.text(2, 5), 'Découvrez la nouvelle collection');
    assert.equal(await hash(excel), original);
    plugin.ws.close();
  } finally { await env.close(); }
});

test('abbinamenti simili: confermati, ricordati nel profilo e riapplicati come esatti', async () => {
  const env = await setup();
  const state = { existing: [], exports: {} };
  try {
    const excel = await writeFixture(join(env.dir, 'c.xlsx'), [{
      name: 'S',
      rows: [['Italiano', 'English'], ['Scopri la nuova collezione 2026', 'Discover the new 2026 collection'], ['Acquista ora', 'Shop now'], ['Termini applicabili\nSconto 20%', 'Terms apply\nSave 20%']]
    }]);
    await env.call('save_brand_profile', { name: 'Acme', primaryLanguage: 'IT', languages: ['IT', 'EN'] });
    await env.call('analyze_client_excel', { path: excel });
    await env.connectPlugin(state);

    const first = (await env.call('match_selection')).data;
    assert.deepEqual([first.summary.exact, first.summary.similar, first.summary.orphans], [1, 1, 1]);
    assert.deepEqual(first.similar.map(item => [item.key, item.row]), [['headline', 2]]);
    assert.ok(first.similar.every(item => item.score >= 0.8 && item.score < 1));
    assert.equal(first.orphans[0].key, 'legal');

    const confirmed = (await env.call('confirm_matches', { accept_similar: [{ frame: 'Hero_IT', key: 'headline' }] })).data;
    assert.equal(confirmed.matched, 2);
    assert.equal(confirmed.rememberedInBrandProfile, 1);
    assert.deepEqual(confirmed.orphans.map(item => item.key), ['legal']);
    assert.equal((await env.call('get_brand_profile', { name: 'Acme' })).data.confirmedMatches.length, 1);

    const second = (await env.call('match_selection')).data;
    assert.deepEqual([second.summary.exact, second.summary.similar], [2, 0]);
    assert.deepEqual(second.exact.map(item => item.via), ['confirmed', 'text']);

    const assigned = (await env.call('confirm_matches', { assign: [{ frame: 'Hero_IT', key: 'legal', row: 4 }] })).data;
    assert.equal(assigned.matched, 3);
    assert.deepEqual(assigned.orphans, []);
  } finally { await env.close(); }
});

test('celle multi-livello: avviso e nessun abbinamento automatico', async () => {
  const env = await setup();
  try {
    const frame = { ...FRAME, textLayers: [
      { id: 'a', key: 'title', text: 'Titolo sopra', markup: 'Titolo sopra' },
      { id: 'b', key: 'sub', text: 'Sottotitolo sopra', markup: 'Sottotitolo sopra' }
    ] };
    const excel = await writeFixture(join(env.dir, 'c.xlsx'), [{ name: 'S', rows: [['Italiano', 'English'], ['Titolo sopra\nSottotitolo sopra', 'Title\nSubtitle']] }]);
    await env.call('save_brand_profile', { name: 'Acme', primaryLanguage: 'IT' });
    await env.call('analyze_client_excel', { path: excel });
    const ws = new WebSocket(`ws://127.0.0.1:${env.bridge.port}`);
    ws.on('open', () => ws.send(JSON.stringify({ hello: 'figma-auto-fill-plugin' })));
    ws.on('message', raw => { const r = JSON.parse(String(raw)); ws.send(JSON.stringify({ id: r.id, ok: true, data: { frames: [frame] } })); });
    for (let i = 0; i < 100 && !env.bridge.connected; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const match = (await env.call('match_selection')).data;
    assert.equal(match.summary.multiLevel, 1);
    assert.equal(match.summary.exact, 0);
    assert.ok(match.warnings.some(warning => /Celle multi-livello/.test(warning)));
    assert.deepEqual(match.orphans.map(item => item.reason), ['multi-level', 'multi-level']);
    const generate = await env.call('generate_exports');
    assert.equal(generate.isError, true);
    assert.match(generate.text, /Nessun livello abbinato/);
    ws.close();
  } finally { await env.close(); }
});

test('usa modello del nome, nome base e section compilati nel plugin, non i default del profilo', async () => {
  const env = await setup();
  const state = {
    existing: [], exports: {},
    ui: {
      naming: { template: '{Data}_{Nome}-{Lingua}-{Paese}', start: 3, date: '261109' },
      baseNames: { '1:1': 'Hero' }, sectionMode: 'base', targets: ['EN', 'DE', 'FR'], primary: 'EN'
    }
  };
  try {
    const excel = await writeFixture(join(env.dir, 'c.xlsx'), [{ name: 'S', rows: [['English', 'French', 'German'], ['Acquista ora', 'Commander', 'Bestellen']] }]);
    await env.call('save_brand_profile', { name: 'TNF', primaryLanguage: 'EN', languages: ['EN', 'FR', 'DE'], naming: { template: '{Nome}' }, sections: 'none' });
    await env.call('analyze_client_excel', { path: excel });
    await env.connectPlugin(state);
    const frameWithCta = { ...FRAME, textLayers: [{ id: 't', key: 'cta', text: 'Acquista ora', markup: 'Acquista ora' }] };
    const original = FRAME.textLayers;
    FRAME.textLayers = frameWithCta.textLayers;
    try {
      await env.call('match_selection');
      const done = (await env.call('generate_exports')).data;
      assert.equal(done.status, 'done');
      assert.deepEqual(state.generated.naming, { template: '{Data}_{Nome}-{Lingua}-{Paese}', start: 3, date: '261109' });
      assert.deepEqual(state.generated.baseNames, { '1:1': 'Hero' });
      assert.equal(state.generated.sectionMode, 'base');
      assert.deepEqual(done.usedSettings, { source: 'plugin', nameTemplate: '{Data}_{Nome}-{Lingua}-{Paese}', baseNames: { '1:1': 'Hero' }, sectionMode: 'base' });

      // lingue del plugin diverse da quelle dell'Excel: nessuna generazione finché il designer non sceglie
      state.ui.targets = ['EN', 'DE'];
      state.generated = null;
      const ask = (await env.call('generate_exports')).data;
      assert.equal(ask.status, 'confirm-languages');
      assert.deepEqual(ask.pluginLanguages, ['EN', 'DE']);
      assert.deepEqual(ask.neededLanguages, ['EN', 'FR', 'DE']);
      assert.equal(state.generated, null, 'nessun export generato prima della risposta');
      const chosen = (await env.call('generate_exports', { languages: ['EN', 'DE'], section_mode: 'locale' })).data;
      assert.equal(chosen.status, 'done');
      assert.deepEqual(state.generated.targets, ['EN', 'DE']);
      assert.equal(state.generated.sectionMode, 'locale', 'un parametro esplicito vince sul plugin');
      state.ui.targets = ['EN', 'DE', 'FR'];

      state.ui = null; // plugin senza stato UI: si ripiega sul profilo brand
      const fallback = (await env.call('generate_exports')).data;
      assert.equal(fallback.usedSettings.source, 'profilo brand');
      assert.equal(state.generated.naming.template, '{Nome}');
      assert.deepEqual(state.generated.baseNames, { '1:1': 'Hero' }, 'senza stato UI vale il nome base del frame');
      assert.equal(state.generated.sectionMode, 'none');
    } finally { FRAME.textLayers = original; }
  } finally { await env.close(); }
});

test('lingue: servono solo quelle con traduzioni nelle righe usate dai frame, non quelle di un disclaimer fuori selezione', async () => {
  const env = await setup();
  const state = { existing: [], exports: {} };
  try {
    const excel = await writeFixture(join(env.dir, 'c.xlsx'), [{
      name: 'S',
      rows: [
        ['English', 'French', 'German', 'FR-CH', 'Dutch'],
        ['Shop now', 'Commander', 'Bestellen', '', ''],
        ['Discover', '', 'Entdecken', '', ''],
        ['Disclaimer: offer valid in selected stores', 'Offre valable', 'Angebot gültig', 'Offre valable en Suisse', 'Aanbieding geldig']
      ]
    }]);
    await env.call('save_brand_profile', { name: 'TNF', primaryLanguage: 'EN', languages: ['EN', 'FR', 'DE'] });
    await env.call('analyze_client_excel', { path: excel });
    await env.connectPlugin(state);
    const original = FRAME.textLayers;
    FRAME.textLayers = [
      { id: 'a', key: 'cta', text: 'Shop now', markup: 'Shop now' },
      { id: 'b', key: 'headline', text: 'Discover', markup: 'Discover' }
    ];
    try {
      const match = (await env.call('match_selection')).data;
      assert.equal(match.summary.exact, 2);
      assert.deepEqual(match.languages.needed, ['EN', 'FR', 'DE']);
      assert.deepEqual(match.languages.notNeeded, ['FR_CH', 'NL']);
      assert.deepEqual(match.languages.coverage.FR, { filled: 1, of: 2, missingRows: [3] });
      await env.call('generate_exports');
      assert.deepEqual(state.generated.targets, ['EN', 'FR', 'DE'], 'il disclaimer non porta FR_CH e NL negli export');
      // il designer può comunque chiederle in modo esplicito
      await env.call('generate_exports', { languages: ['FR', 'NL'] });
      assert.deepEqual(state.generated.targets, ['EN', 'FR', 'NL']);
    } finally { FRAME.textLayers = original; }
  } finally { await env.close(); }
});

test('livelli di contorno: l\'agente li propone, restano nel Profilo brand e non contano come orfani', async () => {
  const env = await setup();
  try {
    const frame = { ...FRAME, textLayers: [
      { id: 'a', key: 'cta', text: 'Acquista ora', markup: 'Acquista ora' },
      { id: 'b', key: 'To:', text: 'To:', markup: 'To:' },
      { id: 'c', key: 'Reply to:', text: 'Reply to:', markup: 'Reply to:' },
      { id: 'd', key: '29 June 2022 18.00', text: '29 June 2022 18.00', markup: '29 June 2022 18.00' }
    ] };
    const excel = await writeFixture(join(env.dir, 'c.xlsx'), [{ name: 'S', rows: [['English', 'French'], ['Acquista ora', 'Commander']] }]);
    await env.call('save_brand_profile', { name: 'TNF', primaryLanguage: 'EN', languages: ['EN', 'FR'] });
    await env.call('analyze_client_excel', { path: excel });
    const ws = new WebSocket(`ws://127.0.0.1:${env.bridge.port}`);
    ws.on('open', () => ws.send(JSON.stringify({ hello: 'figma-auto-fill-plugin' })));
    ws.on('message', raw => { const r = JSON.parse(String(raw)); ws.send(JSON.stringify({ id: r.id, ok: true, data: { frames: [frame] } })); });
    for (let i = 0; i < 100 && !env.bridge.connected; i++) await new Promise(resolve => setTimeout(resolve, 10));

    const first = (await env.call('match_selection')).data;
    assert.deepEqual([first.summary.orphans, first.summary.excluded], [3, 0]);
    assert.match(first.orphansHint, /exclude_layers/);

    const added = (await env.call('exclude_layers', { add: ['To:', 'Reply to:', 're:^\\d{1,2} [a-z]+ \\d{4}'] })).data;
    assert.equal(added.ignoredLayers.length, 3);
    assert.equal((await env.call('generate_exports')).isError, true, 'dopo la modifica serve un nuovo abbinamento');
    assert.deepEqual((await env.call('get_brand_profile', { name: 'TNF' })).data.ignoredLayers, added.ignoredLayers, 'persistite nel profilo');

    const second = (await env.call('match_selection')).data;
    assert.deepEqual([second.summary.exact, second.summary.orphans, second.summary.excluded], [1, 0, 3]);
    assert.deepEqual(second.excluded.map(item => item.key), ['To:', 'Reply to:', '29 June 2022 18.00']);
    assert.equal(second.orphansHint, undefined);

    // una sessione nuova con lo stesso Brand parte già con le esclusioni
    await env.call('get_brand_profile', { name: 'TNF' });
    assert.equal((await env.call('match_selection')).data.summary.excluded, 3);

    const invalid = await env.call('exclude_layers', { add: ['re:('] });
    assert.equal(invalid.isError, true);
    assert.match(invalid.text, /Espressione regolare non valida/);
    const removed = (await env.call('exclude_layers', { add: ['to:'], remove: ['TO:', 'reply to:'] })).data;
    assert.deepEqual(removed.ignoredLayers, ['re:^\\d{1,2} [a-z]+ \\d{4}', 'to:'], 'rimozione senza distinzione di maiuscole, aggiunta in coda');
    ws.close();
  } finally { await env.close(); }
});

test('l\'Excel originale non viene mai modificato, in nessun passo del dialogo né con percorsi di output ostili', async () => {
  const env = await setup();
  const state = { existing: [], exports: {}, manual: { cta: { DE: 'Jetzt kaufen' } } };
  const fingerprint = async path => { const info = await stat(path); return `${await hash(path)}|${info.size}|${info.mtimeMs}|${info.ino}`; };
  try {
    const excel = await writeFixture(join(env.dir, 'cliente.xlsx'), [{
      name: 'Campagna', rows: [
        ['ID', 'Italiano', 'English', 'Deutsch'],
        ['H1', 'Scopri la nuova collezione', 'Discover the new collection', ''],
        ['C1', 'Acquista ora', 'Shop now', ''],
        ['X1', 'Riga non usata', 'Unused', '']
      ]
    }]);
    const untouched = await fingerprint(excel);
    const stillUntouched = async step => assert.equal(await fingerprint(excel), untouched, `originale modificato dopo: ${step}`);
    const other = await writeFixture(join(env.dir, 'altro.xlsx'), [{ name: 'S', rows: [['x']] }]);
    const otherBefore = await fingerprint(other);

    await env.call('save_brand_profile', { name: 'Acme', primaryLanguage: 'IT', languages: ['IT', 'EN', 'DE'] });
    await env.call('analyze_client_excel', { path: excel }); await stillUntouched('analyze_client_excel');
    await env.connectPlugin(state);
    await env.call('match_selection'); await stillUntouched('match_selection');
    await env.call('confirm_matches', { accept_similar: 'all' }); await stillUntouched('confirm_matches');
    await env.call('generate_exports'); await stillUntouched('generate_exports');
    await env.call('list_empty_cells'); await stillUntouched('list_empty_cells');
    await env.call('save_ai_translations', { translations: [{ row: 2, language: 'DE', text: 'Entdecke die neue Kollektion' }] });
    await stillUntouched('save_ai_translations');

    // tutte le varianti di scrittura valide producono copie, mai l'originale
    for (const args of [{}, { add_orphans: true }, { only_used_rows: false }, { only_used_rows: false, add_orphans: true }, { overwrite: [{ row: 2, language: 'DE' }] }]) {
      const written = await env.call('write_updated_excel', args);
      assert.equal(written.isError, false, written.text);
      assert.notEqual(written.data.output, excel);
      await stillUntouched(`write_updated_excel ${JSON.stringify(args)}`);
    }

    // percorsi di output che portano all'originale (o a un altro file): rifiutati, nessun file toccato
    await mkdir(join(env.dir, 'sub'));
    symlinkSync(excel, join(env.dir, 'link.xlsx'));
    linkSync(excel, join(env.dir, 'hard.xlsx'));
    const hostile = [excel, `${env.dir}/sub/../cliente.xlsx`, join(env.dir, 'link.xlsx'), join(env.dir, 'hard.xlsx'), join(env.dir, 'altro.xlsx'), join(env.dir, 'out.txt')];
    if (existsSync(join(env.dir, 'CLIENTE.xlsx'))) hostile.push(join(env.dir, 'CLIENTE.xlsx'));
    for (const output_path of hostile) {
      const refused = await env.call('write_updated_excel', { output_path });
      assert.equal(refused.isError, true, `doveva rifiutare ${output_path}`);
      assert.match(refused.text, /non può coincidere|esiste già|estensione/);
      await stillUntouched(`output_path ${output_path}`);
    }
    assert.equal(await fingerprint(other), otherBefore, 'un altro file esistente non viene sovrascritto');

    // un nome nuovo va bene, e si può rigenerare nella stessa sessione
    const mine = join(env.dir, 'consegna.xlsx');
    assert.equal((await env.call('write_updated_excel', { output_path: mine })).isError, false);
    assert.equal((await env.call('write_updated_excel', { output_path: mine })).isError, false);
    await stillUntouched('copia con nome personalizzato');
    assert.equal((await readdir(env.dir)).some(name => name.includes('.tmp-')), false, 'nessun file temporaneo rimasto');
  } finally { await env.close(); }
});
