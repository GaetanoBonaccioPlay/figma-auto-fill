import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import { loadBaseProfiles } from '../scripts/base-profiles.mjs';
import { validateProfile } from '../dist/profiles.mjs';

const code = await readFile(new URL('../dist/code.js', import.meta.url), 'utf8');

// Il bundle distribuito non ha Profili di base (brand-profiles/ è vuota): per provarli si compila il plugin
// con i profili di fantasia di tests/fixtures, come fa scripts/build.mjs con brand-profiles/.
const withBaseProfiles = await (async () => {
  const fixtures = await loadBaseProfiles(new URL('./fixtures/base-profiles', import.meta.url).pathname, validateProfile);
  const result = await build({
    entryPoints: [new URL('../src/plugin.ts', import.meta.url).pathname], bundle: true, format: 'iife', target: 'es2017',
    write: false, logLevel: 'silent', define: { __BASE_PROFILES__: JSON.stringify(fixtures) }
  });
  return result.outputFiles[0].text;
})();

function pluginHarness({ existingExport = false, failOnWrite = false, autoRenameText = false, source = code } = {}) {
  let nextId = 10;
  const messages = [];
  const loadedFonts = [];
  const storage = new Map();
  class Text {
    type = 'TEXT';
    removed = false;
    textAutoResize = 'NONE';
    textDecoration = 'NONE';
    hasMissingFont = false;
    fontName = { family: 'Inter', style: 'Regular' };
    width = 200;
    height = 40;
    constructor(name, characters) { this.id = `1:${nextId++}`; this.name = name; this._characters = characters; this.autoRename = autoRenameText; this.pluginData = new Map(); }
    get characters() { return this._characters; }
    set characters(value) { this._characters = value; if (this.autoRename) this.name = value; }
    getPluginData(key) { return this.pluginData.get(key) ?? ''; }
    setPluginData(key, value) { this.pluginData.set(key, value); }
    getStyledTextSegments() {
      return [{ characters: this.characters, start: 0, end: this.characters.length, fontName: this.fontName, fontWeight: 400, textDecoration: this.textDecoration, fontSize: 24, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] }];
    }
    setRangeFontName(start, end, font) {
      if (failOnWrite) throw new Error('Figma write failed');
      this.rangeFonts ??= [];
      this.rangeFonts.push({ start, end, font });
    }
    setRangeTextDecoration() {}
    remove() { this.removed = true; }
  }
  class Frame {
    type = 'FRAME';
    removed = false;
    x = 0;
    y = 0;
    width = 400;
    height = 200;
    constructor(name, children) { this.id = `1:${nextId++}`; this.name = name; this.children = children; this.pluginData = new Map(); }
    findAll(predicate) { return this.children.filter(predicate); }
    clone() { const copy = new Frame(this.name, this.children.map(text => { const child = new Text(text.name, text.characters); child.autoRename = text.autoRename; child.visible = text.visible; child.pluginData = new Map(text.pluginData); return child; })); copy.pluginData = new Map(this.pluginData); return copy; }
    getPluginData(key) { return this.pluginData.get(key) ?? ''; }
    setPluginData(key, value) { this.pluginData.set(key, value); }
    remove() { this.removed = true; this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  class Page {
    type = 'PAGE';
    removed = false;
    selection = [];
    constructor(name, children = []) { this.name = name; this.children = children; for (const child of children) child.parent = this; }
    async loadAsync() {}
    appendChild(node) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; this.children.push(node); }
    insertChild(index, node) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; this.children.splice(index, 0, node); }
    remove() { this.removed = true; figma.root.children = figma.root.children.filter(page => page !== this); }
  }
  class Section {
    type = 'SECTION';
    removed = false;
    x = 0;
    y = 0;
    width = 100;
    height = 100;
    constructor() { this.id = `1:${nextId++}`; this.name = ''; this.children = []; }
    resize(width, height) { this.width = width; this.height = height; }
    appendChild(node) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; this.children.push(node); }
    insertChild(index, node) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; this.children.splice(index, 0, node); }
    remove() { this.removed = true; this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  const sourceText = new Text('headline', 'Sale');
  const sourceFrame = new Frame('260717_Hero_NL', [sourceText]);
  const sourcePage = new Page('Page 1', [sourceFrame]);
  sourcePage.selection = [sourceFrame];
  const figma = {
    mixed: Symbol('mixed'),
    currentPage: sourcePage,
    root: { children: [sourcePage] },
    ui: { postMessage: message => messages.push(message), onmessage: null },
    clientStorage: {
      async getAsync(key) { return storage.get(key); },
      async setAsync(key, value) { storage.set(key, value); }
    },
    showUI() {},
    on() {},
    async listAvailableFontsAsync() { return [{ fontName: { family: 'Inter', style: 'Regular' } }, { fontName: { family: 'Inter', style: 'Bold' } }]; },
    async loadFontAsync(font) { loadedFonts.push(font); },
    createPage() { const page = new Page(''); this.root.children.push(page); return page; },
    createSection() { const section = new Section(); this.currentPage.appendChild(section); return section; },
    async setCurrentPageAsync(page) { this.currentPage = page; },
    async getNodeByIdAsync(id) {
      const walk = node => node.id === id ? node : (node.children ?? []).map(walk).find(Boolean);
      return this.root.children.map(walk).find(Boolean) ?? null;
    },
    viewport: { scrollAndZoomIntoView() {} }
  };
  if (existingExport) figma.root.children.push(new Page('EXPORT', [new Frame('260717_Hero_EN', [])]));
  vm.runInNewContext(source, { figma, __html__: '' });
  return { figma, sourceText, sourceFrame, messages, loadedFonts, storage };
}

function request(frameId) {
  return {
    kind: 'generate', frameIds: [frameId],
    rows: [{ frame: '260717_Hero_NL', key: 'headline', translate: true, values: { EN: '<b>Sale</b> now', NL: '' } }],
    targets: ['EN', 'NL'], primary: 'EN', baseNames: { [frameId]: '260717_Hero' }, addDate: false, date: '',
    collisionMode: 'version', confirmedReplacementIds: []
  };
}

test('salva la selezione linguistica e la rilegge al riavvio della UI', async () => {
  const { figma, messages, storage } = pluginHarness();
  await figma.ui.onmessage({ kind: 'ready' });
  assert.deepEqual(Array.from(messages.at(-2).settings.selected), ['EN']);
  await figma.ui.onmessage({ kind: 'save-language-settings', settings: {
    selected: ['EN_GB', 'FR_BE'], primary: 'FR', extra: []
  } });
  assert.deepEqual(Array.from(storage.get('autoFillLanguageSettingsV1').selected), ['EN_GB', 'FR_BE']);
  await figma.ui.onmessage({ kind: 'ready' });
  const settings = messages.at(-2).settings;
  assert.deepEqual(Array.from(settings.selected), ['EN_GB', 'FR_BE']);
  assert.equal(settings.primary, 'FR');
});

test('la selezione segue l’ordine visibile dei layer Figma', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const topFrame = sourceFrame.clone();
  topFrame.name = 'Frame in alto';
  figma.currentPage.appendChild(topFrame);
  figma.currentPage.selection = [sourceFrame, topFrame];
  await figma.ui.onmessage({ kind: 'ready' });
  assert.deepEqual(Array.from(messages.at(-1).frames, frame => frame.name), ['Frame in alto', sourceFrame.name]);
});

test('una section sorgente include tutti i frame in ordine senza duplicare quelli selezionati singolarmente', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const sourcePage = figma.currentPage;
  const section = figma.createSection();
  section.name = 'Sorgenti';
  section.appendChild(sourceFrame);
  const other = sourceFrame.clone();
  other.name = 'Altro frame';
  section.appendChild(other);
  sourcePage.selection = [section, sourceFrame];
  await figma.ui.onmessage({ kind: 'ready' });
  assert.deepEqual(Array.from(messages.at(-1).frames, frame => frame.name), ['Altro frame', sourceFrame.name]);
  await figma.ui.onmessage({ kind: 'read-locals', frameIds: [sourceFrame.id, other.id] });
  assert.equal(messages.at(-1).kind, 'locals-source');
  assert.equal(messages.at(-1).frames.length, 2);
  const input = request(sourceFrame.id);
  input.frameIds = [sourceFrame.id, other.id];
  input.baseNames[other.id] = 'Altro frame';
  input.rows.push({ frame: other.name, key: 'headline', translate: true, values: { EN: 'Other', NL: '' } });
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  assert.equal(messages.at(-1).names.length, 4);
});

test('selezionando una section in EXPORT legge tutti i MASTER e conserva il margine sui frame', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const other = sourceFrame.clone();
  other.name = '260717_Secondo_NL';
  figma.currentPage.appendChild(other);
  figma.currentPage.selection = [sourceFrame, other];
  const input = request(sourceFrame.id);
  input.frameIds = [sourceFrame.id, other.id];
  input.baseNames[other.id] = '260717_Secondo';
  input.rows.push({ frame: other.name, key: 'headline', translate: true, values: { EN: 'Second', NL: '' } });
  input.sectionMode = 'locale';
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const enSection = page.children.find(node => node.name === 'en/');
  page.selection = [enSection];
  await figma.ui.onmessage({ kind: 'ready' });
  assert.deepEqual(Array.from(messages.at(-1).frames, frame => frame.name), ['260717_Secondo_EN', '260717_Hero_EN']);
  assert.ok(messages.at(-1).frames.every(frame => frame.managedRole === 'master'));
  page.selection = [page.children.find(node => node.name === 'nl/')];
  await figma.ui.onmessage({ kind: 'ready' });
  assert.equal(messages.at(-1).frames.length, 2);
  assert.ok(messages.at(-1).frames.every(frame => frame.managedRole === 'locale'));
  for (const frame of enSection.children) {
    assert.ok(frame.x >= 56);
    assert.ok(enSection.width - frame.x - frame.width >= 56);
    assert.ok(enSection.height - frame.y - frame.height >= 56);
  }
});

test('genera varianti editabili, usa fallback e versiona le collisioni senza toccare il sorgente', async () => {
  const { figma, sourceText, sourceFrame, messages } = pluginHarness({ existingExport: true });
  await figma.ui.onmessage({ kind: 'ready' });
  assert.equal(messages.at(-1).frames[0].sourceLanguage, 'EN');
  await figma.ui.onmessage(request(sourceFrame.id));
  const result = messages.at(-1);
  assert.equal(result.kind, 'done');
  assert.deepEqual(Array.from(result.names), ['260717_Hero_v2_EN', '260717_Hero_v2_NL']);
  assert.equal(sourceText.characters, 'Sale');
  const page = figma.root.children.find(page => page.name === 'EXPORT');
  assert.equal(page.children.length, 3);
  const en = page.children.find(node => node.name === '260717_Hero_v2_EN');
  const nl = page.children.find(node => node.name === '260717_Hero_v2_NL');
  assert.equal(en.children[0].characters, 'Sale now');
  assert.equal(nl.children[0].characters, 'Sale now');
  assert.equal(en.children[0].rangeFonts[0].font.style, 'Bold');
  assert.ok(result.warnings.some(warning => warning.includes('usato EN')));
  assert.ok(en.x < nl.x);
});

test('colonne allineate sulla larghezza del frame più largo', async () => {
  const { figma, sourceFrame } = pluginHarness();
  const wide = sourceFrame.clone();
  wide.name = '260717_Wide_NL';
  wide.width = 900;
  figma.currentPage.appendChild(wide);
  figma.currentPage.selection = [sourceFrame, wide];
  const input = request(sourceFrame.id);
  input.frameIds = [sourceFrame.id, wide.id];
  input.targets = ['EN', 'NL', 'DE'];
  input.baseNames[wide.id] = '260717_Wide';
  input.rows.push({ frame: wide.name, key: 'headline', translate: true, values: { EN: 'Wide', NL: '', DE: '' } });
  await figma.ui.onmessage(input);
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const bySource = id => page.children.filter(node => node.getPluginData('autoFillSourceId') === id);
  const narrowFrames = bySource(sourceFrame.id);
  const wideFrames = bySource(wide.id);
  for (const language of ['EN', 'NL', 'DE']) {
    const narrow = narrowFrames.find(node => node.getPluginData('autoFillLanguage') === language);
    const broad = wideFrames.find(node => node.getPluginData('autoFillLanguage') === language);
    assert.equal(narrow.x, broad.x);
    assert.ok(narrow.x + narrow.width <= broad.x + 900);
  }
  const en = narrowFrames.find(node => node.getPluginData('autoFillLanguage') === 'EN');
  const nl = narrowFrames.find(node => node.getPluginData('autoFillLanguage') === 'NL');
  const de = narrowFrames.find(node => node.getPluginData('autoFillLanguage') === 'DE');
  assert.ok(nl.x >= en.x + wide.width + 80);
  assert.ok(de.x >= nl.x + wide.width + 80);
});

test('crea section minuscole per ogni variante e le riusa nelle versioni successive', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const input = request(sourceFrame.id);
  input.targets = ['EN', 'EN_GB', 'NL'];
  input.rows[0].values.EN_GB = '';
  input.sectionMode = 'locale';
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  let sections = page.children.slice().reverse();
  assert.deepEqual(sections.map(node => node.name), ['en/', 'en_gb/', 'nl/']);
  assert.deepEqual(sections.map(node => node.children.length), [1, 1, 1]);
  assert.ok(sections[0].width >= sourceFrame.width + 80);
  assert.ok(sections[1].x >= sections[0].x + sections[0].width + 80);
  assert.ok(sections[2].x >= sections[1].x + sections[1].width + 80);

  figma.currentPage = figma.root.children[0];
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  sections = page.children.slice().reverse();
  assert.deepEqual(sections.map(node => node.name), ['en/', 'en_gb/', 'nl/']);
  assert.deepEqual(sections.map(node => node.children.length), [2, 2, 2]);
  const enLayers = sections[0].children.slice().reverse();
  assert.ok(enLayers[1].y >= enLayers[0].y + sourceFrame.height + 80);
});

test('riesportando ripropone la modalità section scelta sul sorgente e sul MASTER', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const sourcePage = figma.currentPage;
  const input = request(sourceFrame.id);
  input.targets = ['EN', 'EN_GB', 'NL'];
  input.rows[0].values.EN_GB = '';
  input.sectionMode = 'base';
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const master = page.children.find(node => node.name === 'en/').children.find(node => node.name === '260717_Hero_EN');

  figma.currentPage = sourcePage;
  sourcePage.selection = [sourceFrame];
  await figma.ui.onmessage({ kind: 'ready' });
  assert.equal(messages.at(-1).frames[0].exportSectionMode, 'base');

  figma.currentPage = page;
  page.selection = [master];
  await figma.ui.onmessage({ kind: 'ready' });
  assert.equal(messages.at(-1).frames[0].exportSectionMode, 'base');
});

test('raggruppa EN ed EN_GB nella stessa section e trova gli export da sostituire', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const input = request(sourceFrame.id);
  input.targets = ['EN', 'EN_GB', 'NL'];
  input.rows[0].values.EN_GB = '';
  input.sectionMode = 'base';
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  let sections = page.children.slice().reverse();
  assert.deepEqual(sections.map(node => node.name), ['en/', 'nl/']);
  assert.deepEqual(sections.map(node => node.children.length), [2, 1]);
  const en = sections[0].children.find(node => node.name === '260717_Hero_EN');
  const gb = sections[0].children.find(node => node.name === '260717_Hero_EN_GB');
  assert.ok(gb.x >= en.x + sourceFrame.width + 80);
  assert.ok(sections[1].x >= sections[0].x + sections[0].width + 80);
  const originals = page.children.flatMap(node => node.children);

  figma.currentPage = figma.root.children[0];
  await figma.ui.onmessage({ kind: 'inspect', frameIds: [sourceFrame.id], targets: input.targets,
    primary: 'EN', baseNames: input.baseNames, addDate: false, date: '' });
  const plan = messages.at(-1);
  assert.equal(plan.kind, 'generation-plan');
  assert.equal(plan.replacements.length, 3);
  await figma.ui.onmessage({ ...input, collisionMode: 'replace', confirmedReplacementIds: Array.from(plan.replacements, item => item.id) });
  assert.equal(messages.at(-1).kind, 'done');
  assert.ok(originals.every(node => node.removed));
  sections = page.children.slice().reverse();
  assert.deepEqual(sections.map(node => node.name), ['en/', 'nl/']);
  assert.deepEqual(sections.map(node => node.children.length), [2, 1]);
});

test('una nuova riga larga amplia la section e lascia spazio alle colonne successive', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const first = request(sourceFrame.id);
  first.targets = ['EN', 'EN_GB', 'NL'];
  first.rows[0].values.EN_GB = '';
  first.sectionMode = 'base';
  await figma.ui.onmessage(first);
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  figma.currentPage = figma.root.children[0];
  const wide = sourceFrame.clone();
  wide.name = '260717_Wide_NL';
  wide.width = 900;
  figma.currentPage.appendChild(wide);
  figma.currentPage.selection = [wide];
  const second = { ...request(wide.id), sectionMode: 'base', targets: ['EN', 'EN_GB', 'NL'],
    baseNames: { [wide.id]: '260717_Wide' },
    rows: [{ frame: wide.name, key: 'headline', translate: true, values: { EN: 'Wide', EN_GB: '', NL: '' } }] };
  await figma.ui.onmessage(second);
  assert.equal(messages.at(-1).kind, 'done');
  const enSection = page.children.find(node => node.name === 'en/');
  const nlSection = page.children.find(node => node.name === 'nl/');
  const en = enSection.children.find(node => node.name === '260717_Wide_EN');
  const gb = enSection.children.find(node => node.name === '260717_Wide_EN_GB');
  assert.ok(gb.x >= en.x + 900 + 80);
  assert.ok(nlSection.x >= enSection.x + enSection.width + 80);
});

test('un errore durante la generazione in section non lascia contenitori vuoti', async () => {
  const { figma, sourceFrame, messages } = pluginHarness({ failOnWrite: true });
  await figma.ui.onmessage({ ...request(sourceFrame.id), sectionMode: 'locale' });
  assert.equal(messages.at(-1).kind, 'error');
  assert.equal(figma.root.children.some(page => page.name === 'EXPORT'), false);
  assert.equal(figma.root.children[0].children.length, 1);
});

test('un MASTER già presente in EXPORT entra nella section quando la funzione viene attivata', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  await figma.ui.onmessage(request(sourceFrame.id));
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const master = page.children.find(node => node.getPluginData('autoFillRole') === 'master');
  const oldLocale = page.children.find(node => node.getPluginData('autoFillRole') === 'locale');
  page.selection = [master];
  const edit = {
    ...request(master.id), sectionMode: 'locale', collisionMode: 'replace', confirmedReplacementIds: [oldLocale.id],
    rows: [{ frame: master.name, key: 'headline', translate: true, values: { EN: 'Sale now', NL: 'Uitverkoop' } }]
  };
  await figma.ui.onmessage(edit);
  assert.equal(messages.at(-1).kind, 'done');
  assert.deepEqual(page.children.slice().reverse().map(node => node.name), ['en/', 'nl/']);
  assert.equal(master.parent.name, 'en/');
  assert.equal(page.children.find(node => node.name === 'nl/').children[0].name, '260717_Hero_NL');
  assert.equal(oldLocale.removed, true);
});

test('selezionando il MASTER legge la traduzione corrente dai frame del suo gruppo anche in section', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const input = request(sourceFrame.id);
  input.sectionMode = 'locale';
  input.rows[0].values.NL = 'Uitverkoop';
  await figma.ui.onmessage(input);
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const enSection = page.children.find(node => node.name === 'en/');
  const nlSection = page.children.find(node => node.name === 'nl/');
  const master = enSection.children[0];
  const locale = nlSection.children[0];
  locale.children[0].characters = 'Handmatig gewijzigd';
  figma.currentPage = figma.root.children[0];
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  nlSection.children.find(node => node.name === '260717_Hero_v2_NL').children[0].characters = 'Altra versione';
  figma.currentPage = page;
  page.selection = [master];
  await figma.ui.onmessage({ kind: 'ready' });
  const snapshot = messages.at(-1).frames[0];
  assert.equal(snapshot.managedRole, 'master');
  assert.equal(snapshot.existingTranslations.headline.NL, 'Handmatig gewijzigd');
  assert.equal(snapshot.existingTranslations.headline.EN, undefined);
});

test('selezionando il sorgente recupera la traduzione dalla versione più recente in EXPORT', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const sourcePage = figma.currentPage;
  const input = request(sourceFrame.id);
  input.targets = ['EN', 'IT'];
  input.rows[0].values = { EN: 'Sale', IT: 'Saldi' };
  input.sectionMode = 'locale';
  await figma.ui.onmessage(input);
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const itSection = page.children.find(node => node.name === 'it/');
  itSection.children[0].children[0].characters = 'Vecchia versione';
  figma.currentPage = sourcePage;
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  itSection.children.find(node => node.name === '260717_Hero_v2_IT').children[0].characters = 'Ultima traduzione';
  figma.currentPage = sourcePage;
  sourcePage.selection = [sourceFrame];
  await figma.ui.onmessage({ kind: 'ready' });
  const snapshot = messages.at(-1).frames[0];
  assert.equal(snapshot.managedRole, undefined);
  assert.equal(snapshot.existingTranslations.headline.IT, 'Ultima traduzione');
});

test('rilegge la traduzione anche quando Figma ha rinominato automaticamente il livello di testo', async () => {
  const { figma, sourceFrame, sourceText, messages } = pluginHarness({ autoRenameText: true });
  const sourcePage = figma.currentPage;
  sourceText.name = 'Sale';
  const input = request(sourceFrame.id);
  input.targets = ['EN', 'IT'];
  input.rows[0].key = 'Sale';
  input.rows[0].values = { EN: 'Sale', IT: 'Saldi' };
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const locale = page.children.find(node => node.getPluginData('autoFillLanguage') === 'IT');
  const translatedText = locale.children[0];
  assert.equal(translatedText.name, 'Sale');
  translatedText.autoRename = true;
  translatedText.characters = 'Sconti';
  translatedText.setPluginData('autoFillTextSourceId', ''); // Un export creato prima del collegamento stabile.
  figma.currentPage = sourcePage;
  sourcePage.selection = [sourceFrame];
  await figma.ui.onmessage({ kind: 'read-locals', frameIds: [sourceFrame.id] });
  const response = messages.at(-1);
  assert.equal(response.kind, 'locals-source');
  assert.equal(response.frames[0].existingTranslations.Sale.IT, 'Sconti');
});

test('nuovo export dello stesso frame chiede scelta tra sostituzione e nuova versione', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const sourcePage = figma.currentPage;
  const input = request(sourceFrame.id);
  await figma.ui.onmessage(input);
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const originals = [...page.children];
  figma.currentPage = sourcePage;
  sourcePage.selection = [sourceFrame];
  await figma.ui.onmessage({ kind: 'inspect', frameIds: [sourceFrame.id], targets: input.targets,
    primary: input.primary, baseNames: input.baseNames, addDate: false, date: '' });
  const plan = messages.at(-1);
  assert.equal(plan.kind, 'generation-plan');
  assert.deepEqual(Array.from(plan.replacements, item => item.name), ['260717_Hero_EN', '260717_Hero_NL']);
  await figma.ui.onmessage({ ...input, collisionMode: 'replace' });
  assert.equal(messages.at(-1).kind, 'error');
  assert.equal(page.children.length, 2);

  await figma.ui.onmessage({ ...input, collisionMode: 'version' });
  assert.equal(messages.at(-1).kind, 'done');
  assert.deepEqual(Array.from(messages.at(-1).names), ['260717_Hero_v2_EN', '260717_Hero_v2_NL']);
  assert.ok(originals.every(node => !node.removed));

  figma.currentPage = sourcePage;
  sourcePage.selection = [sourceFrame];
  await figma.ui.onmessage({ ...input, collisionMode: 'replace', confirmedReplacementIds: Array.from(plan.replacements, item => item.id) });
  assert.equal(messages.at(-1).kind, 'done');
  assert.ok(originals.every(node => node.removed));
  assert.deepEqual(page.children.map(node => node.name).sort(), [
    '260717_Hero_EN', '260717_Hero_NL', '260717_Hero_v2_EN', '260717_Hero_v2_NL'
  ]);
});

test('rimuove frame e pagina nuovi se Figma fallisce durante la scrittura', async () => {
  const { figma, sourceFrame, messages } = pluginHarness({ failOnWrite: true });
  await figma.ui.onmessage(request(sourceFrame.id));
  assert.equal(messages.at(-1).kind, 'error');
  assert.equal(figma.root.children.some(page => page.name === 'EXPORT'), false);
  assert.equal(figma.root.children[0].children.length, 1);
});

test('carica anche i font già presenti prima di sostituire un testo con stili misti', async () => {
  const { figma, sourceText, sourceFrame, loadedFonts, messages } = pluginHarness();
  const makeSegment = (characters, start, style, weight) => ({
    characters, start, end: start + characters.length,
    fontName: { family: 'Inter', style }, fontWeight: weight,
    textDecoration: 'NONE', fontSize: 24,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
  });
  sourceText.getStyledTextSegments = () => [
    makeSegment('Sa', 0, 'Regular', 400),
    makeSegment('le', 2, 'Bold', 700)
  ];
  const input = request(sourceFrame.id);
  input.rows[0].values = { EN: 'Offer', NL: 'Aanbieding' };
  await figma.ui.onmessage(input);
  assert.equal(messages.at(-1).kind, 'done');
  assert.ok(loadedFonts.some(font => font.style === 'Bold'));
});

test('usa il MASTER modificato e chiede conferma prima di sostituire una lingua già generata', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  await figma.ui.onmessage(request(sourceFrame.id));
  assert.equal(messages.at(-1).kind, 'done');
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const master = page.children.find(node => node.getPluginData('autoFillRole') === 'master');
  const oldLocale = page.children.find(node => node.getPluginData('autoFillRole') === 'locale');
  assert.ok(master);
  assert.ok(oldLocale);
  assert.equal(master.getPluginData('autoFillLanguage'), 'EN');
  master.children[0].characters = 'Fresh';
  page.selection = [master];
  const edit = {
    ...request(master.id), frameIds: [master.id],
    collisionMode: 'replace',
    rows: [{ frame: master.name, key: 'headline', translate: true, values: { EN: 'Fresh', NL: '' } }]
  };
  await figma.ui.onmessage({ kind: 'inspect', frameIds: [master.id], targets: ['EN', 'NL'], primary: 'EN', baseNames: edit.baseNames, addDate: false, date: '' });
  const plan = messages.at(-1);
  assert.equal(plan.kind, 'generation-plan');
  assert.equal(plan.replacements.length, 1);
  assert.equal(plan.replacements[0].id, oldLocale.id);
  assert.deepEqual(Array.from(plan.selections, item => `${item.language}:${item.action}`), ['EN:master', 'NL:replace']);
  await figma.ui.onmessage(edit);
  assert.equal(messages.at(-1).kind, 'error');
  assert.equal(oldLocale.removed, false);
  await figma.ui.onmessage({ ...edit, confirmedReplacementIds: [oldLocale.id] });
  assert.equal(messages.at(-1).kind, 'done');
  assert.equal(oldLocale.removed, true);
  assert.equal(master.children[0].characters, 'Fresh');
  const newLocale = page.children.find(node => node.getPluginData('autoFillRole') === 'locale');
  assert.equal(newLocale.children[0].characters, 'Fresh');
  assert.equal(newLocale.name, oldLocale.name);
});

test('dal MASTER una nuova versione conserva il gruppo precedente', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  await figma.ui.onmessage(request(sourceFrame.id));
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const oldFrames = [...page.children];
  const master = oldFrames.find(node => node.getPluginData('autoFillRole') === 'master');
  page.selection = [master];
  const edit = {
    ...request(master.id),
    rows: [{ frame: master.name, key: 'headline', translate: true, values: { EN: 'New copy', NL: '' } }]
  };
  await figma.ui.onmessage(edit);
  assert.equal(messages.at(-1).kind, 'done');
  assert.deepEqual(Array.from(messages.at(-1).names), ['260717_Hero_v2_EN', '260717_Hero_v2_NL']);
  assert.ok(oldFrames.every(node => !node.removed));
  const newMaster = page.children.find(node => node.name === '260717_Hero_v2_EN');
  const newLocale = page.children.find(node => node.name === '260717_Hero_v2_NL');
  assert.equal(newMaster.getPluginData('autoFillGroup'), newLocale.getPluginData('autoFillGroup'));
  assert.notEqual(newMaster.getPluginData('autoFillGroup'), master.getPluginData('autoFillGroup'));
});

// Riedizione dal MASTER con un modello in cui la lingua non chiude il nome ({Nome}_{Lingua}_{N↑}): il nome base
// arriva dallo snapshot, come nella UI e nel flusso agente, e deve essere quello originale, non il nome dell'export.
async function versionFromMaster({ forgetBaseName = false } = {}) {
  const { figma, sourceFrame, messages } = pluginHarness();
  const run = agent(figma, messages);
  const naming = { template: '{Nome}_{Lingua}_{N↑}', start: 1, date: '' };
  await figma.ui.onmessage({ ...request(sourceFrame.id), naming });
  assert.deepEqual(Array.from(messages.at(-1).names), ['260717_Hero_en_1', '260717_Hero_nl_1']);
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const oldFrames = [...page.children];
  const master = oldFrames.find(node => node.getPluginData('autoFillRole') === 'master');
  if (forgetBaseName) for (const node of oldFrames) node.pluginData.delete('autoFillBaseName');
  page.selection = [master];
  const [snapshot] = (await run('snapshot')).data.frames;
  assert.equal(snapshot.baseName, '260717_Hero');
  const edit = {
    ...request(master.id), naming, baseNames: { [master.id]: snapshot.baseName },
    rows: [{ frame: master.name, key: 'headline', translate: true, values: { EN: 'New copy', NL: '' } }]
  };
  await figma.ui.onmessage({ kind: 'inspect', frameIds: [master.id], targets: ['EN', 'NL'], primary: 'EN', baseNames: edit.baseNames, naming });
  assert.deepEqual(Array.from(messages.at(-1).replacements, item => item.name), ['260717_Hero_nl_1']);
  await figma.ui.onmessage(edit);
  assert.equal(messages.at(-1).kind, 'done', messages.at(-1).message);
  assert.deepEqual(Array.from(messages.at(-1).names), ['260717_Hero_v2_en_1', '260717_Hero_v2_nl_1']);
  assert.ok(oldFrames.every(node => !node.removed));
  const v2 = page.children.find(node => node.name === '260717_Hero_v2_en_1');
  assert.equal(v2.getPluginData('autoFillBaseName'), '260717_Hero');
  page.selection = [v2];
  assert.equal((await run('snapshot')).data.frames[0].baseName, '260717_Hero');
  await figma.ui.onmessage({ ...edit, frameIds: [v2.id], baseNames: { [v2.id]: '260717_Hero' }, rows: [{ ...edit.rows[0], frame: v2.name }] });
  assert.deepEqual(Array.from(messages.at(-1).names), ['260717_Hero_v3_en_1', '260717_Hero_v3_nl_1']);
}

test('dal MASTER una nuova versione usa il nome base originale anche se la lingua non chiude il nome', () => versionFromMaster());

test('export creati prima del nome base salvato: dal MASTER lo si ricava dal frame sorgente', () => versionFromMaster({ forgetBaseName: true }));

test('EN_GB usa EN come fallback anche quando la lingua principale è IT', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const input = request(sourceFrame.id);
  input.targets = ['IT', 'EN_GB'];
  input.primary = 'IT';
  input.rows[0].values = { IT: 'Principale', EN: 'English', EN_GB: '' };
  await figma.ui.onmessage(input);
  const result = messages.at(-1);
  assert.equal(result.kind, 'done');
  assert.ok(result.warnings.some(warning => warning.includes('EN_GB: usato EN')));
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const variant = page.children.find(node => node.getPluginData('autoFillLanguage') === 'EN_GB');
  assert.equal(variant.children[0].characters, 'English');
});

test('esclude i livelli nascosti e numera le Key duplicate con un avviso', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const Text = sourceFrame.children[0].constructor;
  const second = new Text('headline', 'Second');
  const hidden = new Text('note', 'Nascosta');
  hidden.visible = false;
  sourceFrame.children.push(second, hidden);
  await figma.ui.onmessage({ kind: 'ready' });
  const frame = messages.at(-1).frames[0];
  assert.deepEqual(Array.from(frame.textLayers, layer => layer.key), ['headline_1', 'headline_2']);
  assert.equal(frame.hiddenTextLayers, 1);
  assert.deepEqual(Array.from(frame.duplicateKeys[0].keys), ['headline_1', 'headline_2']);
  const input = request(sourceFrame.id);
  input.rows = [{ frame: sourceFrame.name, key: 'headline_2', translate: true, values: { EN: 'Due', NL: 'Twee' } }];
  await figma.ui.onmessage(input);
  const result = messages.at(-1);
  assert.equal(result.kind, 'done');
  assert.ok(result.warnings.some(warning => warning.includes('headline_1, headline_2')));
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const nl = page.children.find(node => node.name === '260717_Hero_NL');
  assert.deepEqual(nl.children.map(text => text.characters), ['Sale', 'Twee', 'Nascosta']);
});

test('il modello del nome con variabili dinamiche guida export, versioni e sostituzioni', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const sourcePage = figma.currentPage;
  const backToSource = () => { figma.currentPage = sourcePage; sourcePage.selection = [sourceFrame]; };
  const input = request(sourceFrame.id);
  input.naming = { template: 'TBL-{Nome}-{Ratio}-{Lingua}', start: 1, date: '' };
  await figma.ui.onmessage(input);
  assert.deepEqual(Array.from(messages.at(-1).names), ['TBL-260717_Hero-2x1-en', 'TBL-260717_Hero-2x1-nl']);
  backToSource();
  await figma.ui.onmessage({ kind: 'inspect', frameIds: [sourceFrame.id], targets: ['EN', 'NL'], primary: 'EN', baseNames: input.baseNames, naming: input.naming });
  assert.deepEqual(Array.from(messages.at(-1).replacements, item => item.name), ['TBL-260717_Hero-2x1-en', 'TBL-260717_Hero-2x1-nl']);
  await figma.ui.onmessage({ ...request(sourceFrame.id), naming: input.naming });
  backToSource();
  assert.deepEqual(Array.from(messages.at(-1).names), ['TBL-260717_Hero_v2-2x1-en', 'TBL-260717_Hero_v2-2x1-nl']);
  await figma.ui.onmessage({ ...request(sourceFrame.id), naming: { template: '{Nome}-{Paese}', start: 1, date: '' } });
  assert.equal(messages.at(-1).kind, 'error');
  assert.match(messages.at(-1).message, /stesso nome/);
});

test('frame con lo stesso nome sono ammessi se il modello genera nomi diversi', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const twin = sourceFrame.clone();
  twin.children[0].characters = 'Twin';
  figma.currentPage.appendChild(twin);
  figma.currentPage.selection = [sourceFrame, twin];
  await figma.ui.onmessage({ kind: 'ready' });
  const frames = messages.at(-1).frames;
  assert.deepEqual(Array.from(frames, frame => frame.label), ['260717_Hero_NL (1)', '260717_Hero_NL (2)']);
  const input = request(sourceFrame.id);
  input.frameIds = [twin.id, sourceFrame.id];
  input.baseNames = { [twin.id]: 'Hero', [sourceFrame.id]: 'Hero' };
  input.rows = [
    { frame: '260717_Hero_NL (1)', key: 'headline', translate: true, values: { EN: 'Uno', NL: 'Een' } },
    { frame: '260717_Hero_NL (2)', key: 'headline', translate: true, values: { EN: 'Due', NL: 'Twee' } }
  ];
  await figma.ui.onmessage({ ...input, naming: { template: '{Nome}_{N↑}', start: 1, date: '' } });
  const result = messages.at(-1);
  assert.equal(result.kind, 'done', result.message);
  assert.deepEqual(Array.from(result.names), ['Hero_1_EN', 'Hero_1_NL', 'Hero_2_EN', 'Hero_2_NL']);
  const page = figma.root.children.find(node => node.name === 'EXPORT');
  const text = name => page.children.find(node => node.name === name).children[0].characters;
  assert.equal(text('Hero_1_NL'), 'Een');
  assert.equal(text('Hero_2_NL'), 'Twee');
  figma.currentPage = figma.root.children[0];
  figma.currentPage.selection = [sourceFrame, twin];
  await figma.ui.onmessage({ ...input, naming: { template: '{Nome}', start: 1, date: '' } });
  assert.match(messages.at(-1).message, /stesso nome/);
});

const agent = (figma, messages) => async (command, payload) => {
  const id = `cmd-${messages.length}`;
  await figma.ui.onmessage({ kind: 'agent-command', id, command, payload });
  // Sul bridge reale la risposta viaggia come JSON: qui si normalizza per evitare array di un altro realm `vm`.
  return JSON.parse(JSON.stringify(messages.findLast(message => message.kind === 'agent-result' && message.id === id)));
};

test('bridge agente: snapshot della selezione e di frame indicati per id', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const run = agent(figma, messages);
  const selection = await run('snapshot');
  assert.equal(selection.ok, true);
  assert.deepEqual(selection.data.frames.map(frame => [frame.id, frame.baseName]), [[sourceFrame.id, '260717_Hero']]);
  assert.deepEqual(selection.data.frames[0].textLayers.map(layer => [layer.key, layer.text, layer.markup]), [['headline', 'Sale', 'Sale']]);

  figma.currentPage.selection = [];
  assert.deepEqual((await run('snapshot')).data.frames, []);
  const byId = await run('snapshot', { frameIds: [sourceFrame.id, 'non-esiste'] });
  assert.deepEqual(byId.data.frames.map(frame => frame.id), [sourceFrame.id]);
});

test('bridge agente: plan e generate producono gli stessi export del flusso manuale', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const run = agent(figma, messages);
  const input = request(sourceFrame.id);
  const { kind, ...payload } = input;

  const emptyPlan = await run('plan', { kind: 'inspect', ...payload });
  assert.equal(emptyPlan.ok, true);
  assert.deepEqual(emptyPlan.data.replacements, []);
  assert.deepEqual(emptyPlan.data.selections.map(item => [item.language, item.action]), [['EN', 'create'], ['NL', 'create']]);

  const generated = await run('generate', input);
  assert.equal(generated.ok, true, generated.error);
  assert.equal(generated.data.names.length, 2);
  assert.equal(messages.some(message => message.kind === 'done'), false, 'il risultato va solo al bridge, non alla UI manuale');
  const exportPage = figma.root.children.find(page => page.name === 'EXPORT');
  assert.equal(exportPage.children.length, 2);

  // stesso esito del flusso manuale con un secondo harness
  const manual = pluginHarness();
  await manual.figma.ui.onmessage(request(manual.sourceFrame.id));
  const manualPage = manual.figma.root.children.find(page => page.name === 'EXPORT');
  assert.deepEqual(exportPage.children.map(node => node.name), manualPage.children.map(node => node.name));

  // Figma ha spostato la selezione sui MASTER; l'agente può comunque ripetere plan/generate sui sorgenti
  assert.equal(figma.currentPage.name, 'EXPORT');
  // ora esistono export con gli stessi nomi: il piano li segnala come sostituzioni
  const conflict = await run('plan', { kind: 'inspect', ...payload });
  assert.deepEqual(conflict.data.replacements.map(item => item.language).sort(), ['EN', 'NL']);

  // i testi esportati tornano nello snapshot del frame sorgente (per riportarli nell'Excel)
  const snapshot = await run('snapshot', { frameIds: [sourceFrame.id] });
  assert.deepEqual(snapshot.data.frames[0].existingTranslations.headline, { EN: 'Sale now', NL: 'Sale now' });

  const again = await run('generate', { ...input, collisionMode: 'replace', confirmedReplacementIds: conflict.data.replacements.map(item => item.id) });
  assert.equal(again.ok, true, again.error);
  assert.equal(figma.root.children.find(page => page.name === 'EXPORT').children.length, 2, 'sostituiti, non duplicati');
});

test('bridge agente: errori del plugin tornano come risposta ok:false', async () => {
  const { figma, sourceFrame, messages } = pluginHarness();
  const run = agent(figma, messages);
  const gone = await run('generate', { ...request(sourceFrame.id), frameIds: ['9:99'] });
  assert.equal(gone.ok, false);
  assert.match(gone.error, /non esiste più/);
  assert.equal((await run('vola', {})).ok, false);

  const failing = pluginHarness({ failOnWrite: true });
  const failed = await agent(failing.figma, failing.messages)('generate', request(failing.sourceFrame.id));
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Figma write failed/);
  assert.equal(failing.figma.root.children.some(page => page.name === 'EXPORT'), false, 'nessun export parziale');
});

// ---------- Archivio dei Profili brand nel plugin (ADR 0002) ----------

const profileRequest = async (figma, messages, request) => {
  await figma.ui.onmessage({ kind: 'profiles', requestId: 'r1', request });
  const result = messages.filter(message => message.kind === 'profiles-result').at(-1);
  if (!result.ok) throw new Error(result.error);
  return result.data;
};

test('all\'avvio la UI riceve i Profili di base compilati nel plugin', async () => {
  const { figma, messages } = pluginHarness({ source: withBaseProfiles });
  await figma.ui.onmessage({ kind: 'ready' });
  const state = messages.find(message => message.kind === 'profiles-state');
  assert.deepEqual(Array.from(state.profiles, item => [item.name, item.origin]), [['Aurora', 'base'], ['Borealis', 'base']]);
  assert.equal(state.selected, null);
  assert.deepEqual(Array.from(state.profiles[1].languages), ['EN', 'DE', 'FR', 'ES', 'NL', 'IT', 'PL', 'PT', 'SV', 'DA', 'CS']);
});

test('Profili personali e Aggiunte personali restano in clientStorage tra un riavvio e l\'altro', async () => {
  const first = pluginHarness({ source: withBaseProfiles });
  await first.figma.ui.onmessage({ kind: 'ready' });
  await profileRequest(first.figma, first.messages, { action: 'create', name: 'Delta' });
  const aurora = (await profileRequest(first.figma, first.messages, { action: 'get', name: 'Aurora' })).profile;
  await profileRequest(first.figma, first.messages, { action: 'save', profile: { ...aurora, ignoredLayers: ['Legal footer'] } });
  await profileRequest(first.figma, first.messages, { action: 'select', name: 'Delta' });
  const broadcast = first.messages.filter(message => message.kind === 'profiles-state').at(-1);
  assert.equal(broadcast.selected, 'Delta');
  assert.equal(broadcast.applied.name, 'Delta', 'la UI riceve il profilo appena selezionato');
  const stored = JSON.parse(JSON.stringify(first.storage.get('autoFillProfilesV1')));
  assert.deepEqual(stored.personal.map(item => item.name), ['Delta']);
  assert.deepEqual(stored.additions.map(item => [item.base, item.ignoredLayers]), [['Aurora', ['Legal footer']]]);

  // riavvio: stesso spazio di archiviazione, nuovo codice del plugin
  const second = pluginHarness({ source: withBaseProfiles });
  second.storage.set('autoFillProfilesV1', stored);
  await second.figma.ui.onmessage({ kind: 'ready' });
  const state = second.messages.find(message => message.kind === 'profiles-state');
  assert.equal(state.selected, 'Delta');
  assert.deepEqual(Array.from(state.profiles, item => [item.name, item.origin, item.hasAdditions]), [['Aurora', 'base', true], ['Borealis', 'base', false], ['Delta', 'personal', false]]);
  const effective = (await profileRequest(second.figma, second.messages, { action: 'get', name: 'Aurora' })).profile;
  assert.deepEqual(Array.from(effective.ignoredLayers), ['Legal footer']);
  await assert.rejects(profileRequest(second.figma, second.messages, { action: 'remove', name: 'Aurora' }), /Profilo di base/);
});

test('l\'agente legge e scrive l\'archivio con il comando profiles del bridge, e la UI viene aggiornata', async () => {
  const { figma, messages } = pluginHarness({ source: withBaseProfiles });
  await figma.ui.onmessage({ kind: 'ready' });
  await figma.ui.onmessage({ kind: 'agent-command', id: 'a1', command: 'profiles', payload: { action: 'list' } });
  const list = messages.at(-1);
  assert.deepEqual([list.kind, list.id, list.ok], ['agent-result', 'a1', true]);
  assert.equal(list.data.profiles.length, 2);
  await figma.ui.onmessage({ kind: 'agent-command', id: 'a2', command: 'profiles', payload: { action: 'select', name: 'Borealis' } });
  const state = messages.filter(message => message.kind === 'profiles-state').at(-1);
  assert.deepEqual([state.selected, state.by], ['Borealis', 'agent']);
  await figma.ui.onmessage({ kind: 'agent-command', id: 'a3', command: 'profiles', payload: { action: 'get', name: 'Nessuno' } });
  assert.match(messages.at(-1).error, /non trovato.*Aurora/);
});

test('un Profilo di base non più distribuito diventa un Profilo personale e la UI lo segnala una volta', async () => {
  const { figma, messages, storage } = pluginHarness({ source: withBaseProfiles });
  const snapshot = { version: 2, name: 'Vecchio Brand', previousNames: [], languages: ['EN'], glossary: [], ignoredLayers: [], confirmedMatches: [], excelModels: [] };
  storage.set('autoFillProfilesV1', { personal: [], additions: [{ base: 'Vecchio Brand', baseSnapshot: snapshot, languages: ['FR'] }], selected: 'Vecchio Brand' });
  await figma.ui.onmessage({ kind: 'ready' });
  const state = messages.find(message => message.kind === 'profiles-state');
  assert.match(state.notices[0], /"Vecchio Brand" non è più disponibile/);
  assert.deepEqual(Array.from(state.profiles.at(-1).languages), ['EN', 'FR']);
  assert.equal(state.profiles.at(-1).origin, 'personal');
  await figma.ui.onmessage({ kind: 'ready' });
  assert.deepEqual(Array.from(messages.filter(message => message.kind === 'profiles-state').at(-1).notices), []);
});

test('il bundle del plugin non contiene espressioni che Figma rifiuta come import dinamici', () => {
  // stesso controllo del sandbox di Figma (SES): "possible import expression rejected"
  const rejected = /(^|[^.])\bimport(\s*(?:\(|\/[/*]))/m;
  const match = code.match(rejected);
  assert.equal(match, null, match ? `trovato: ${code.slice(Math.max(0, match.index - 60), match.index + 40)}` : '');
  assert.equal(/(^|[^.])\beval\s*\(/.test(code), false);
  // il sandbox rifiuta anche i commenti HTML nel codice
  assert.equal(/<!--|-->/.test(code), false, 'commento HTML nel bundle');
});
