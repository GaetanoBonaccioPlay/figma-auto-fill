import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLanguage, detectSourceLanguage, stripLanguageSuffix,
  outputName, outputGroupNames, renderOutputName, shortLanguages, namingErrors, aspectRatio, parseMarkup, escapeMarkup, resolveValue, validateRows, orderRowsByFrames, rowsFromFrames, uniqueKeys
} from '../dist/core.mjs';

test('normalizza le lingue e separa solo il suffisso finale', () => {
  assert.equal(normalizeLanguage('en-gb'), 'EN_GB');
  assert.equal(detectSourceLanguage('260717_SaleW4_Hero_NL'), 'NL');
  assert.equal(stripLanguageSuffix('260717_SaleW4_Hero_EN_GB'), '260717_SaleW4_Hero');
  assert.equal(detectSourceLanguage('SaleW4_Hero'), null);
  assert.equal(detectSourceLanguage('260928_ECOM53591_hero_nm'), null);
  assert.equal(stripLanguageSuffix('260928_ECOM53591_hero_nm'), '260928_ECOM53591_hero_nm');
  assert.throws(() => normalizeLanguage('NM'), /ISO/);
  assert.throws(() => normalizeLanguage('EN_NM'), /ISO/);
  assert.throws(() => normalizeLanguage('english'));
});

test('righe anteprima seguono i frame dei layer e mantengono l’ordine delle key', () => {
  const row = (frame, key) => ({ frame, key, translate: false, values: { EN: key } });
  const rows = [row('Basso', 'uno'), row('Alto', 'prima'), row('Basso', 'due'), row('Alto', 'seconda')];
  assert.deepEqual(orderRowsByFrames(rows, ['Alto', 'Basso']).map(item => `${item.frame}/${item.key}`), [
    'Alto/prima', 'Alto/seconda', 'Basso/uno', 'Basso/due'
  ]);
});

test('l’anteprima del MASTER recupera gli export e conserva le correzioni già fatte nel plugin', () => {
  const frame = {
    id: 'master', name: 'Hero_EN', sourceLanguage: 'EN', managedRole: 'master',
    textLayers: [{ id: 'text', key: 'headline', text: 'Fresh', markup: 'Fresh' }],
    existingTranslations: { headline: { NL: 'Aanbieding', EN_GB: '<b>Offer</b>' } }
  };
  const first = rowsFromFrames([frame], ['EN', 'NL'], [], new Map());
  assert.deepEqual(first[0].values, { EN: 'Fresh', NL: 'Aanbieding', EN_GB: '<b>Offer</b>' });
  assert.equal(first[0].translate, true);
  first[0].values.NL = 'Correzione manuale';
  first[0].translate = false;
  const second = rowsFromFrames([frame], ['EN', 'NL'], first, new Map());
  assert.equal(second[0].values.NL, 'Correzione manuale');
  assert.equal(second[0].translate, false);
});

test('una riga sorgente vuota recupera il testo già esportato e si attiva', () => {
  const frame = {
    id: 'source', name: 'Hero', sourceLanguage: 'EN',
    textLayers: [{ id: 'text', key: 'headline', text: 'Sale', markup: 'Sale' }],
    existingTranslations: { headline: { EN: 'Sale', IT: 'Saldi' } }
  };
  const previous = [{ frame: 'Hero', key: 'headline', translate: false, values: { EN: 'Sale', IT: '' } }];
  const [row] = rowsFromFrames([frame], ['EN', 'IT'], previous, new Map());
  assert.equal(row.values.IT, 'Saldi');
  assert.equal(row.translate, true);
});

const ctx = (name, extra = {}) => ({ name, index: 0, count: 1, width: 1080, height: 1920, ...extra });
const plain = { template: '{Nome}', start: 1, date: '' };

test('nomi: modello predefinito, versione prima della lingua e data che sostituisce il prefisso', () => {
  const taken = new Set(['260717_SaleW4_Hero_EN']);
  assert.equal(outputName(ctx('260717_SaleW4_Hero_NL'), 'EN', plain, taken), '260717_SaleW4_Hero_v2_EN');
  assert.equal(outputName(ctx('260717_SaleW4_Hero_NL'), 'FR', { template: '{Data}_{Nome}', start: 1, date: '260924' }, taken), '260924_SaleW4_Hero_FR');
  assert.throws(() => outputName(ctx('Hero'), 'EN', { template: '{Data}_{Nome}', start: 1, date: '260230' }, new Set()), /data/);
});

test('variabili dinamiche: lingua, paese, aspect ratio e numerazione', () => {
  const naming = { template: 'TBL-{Nome}-{Ratio}-{Lingua}-{Paese}', start: 1, date: '' };
  assert.equal(renderOutputName(ctx('Hero'), 'EN', naming), 'TBL-Hero-9x16-en');
  assert.equal(renderOutputName(ctx('Hero'), 'EN_GB', naming), 'TBL-Hero-9x16-en-gb');
  assert.equal(renderOutputName(ctx('Hero'), 'EN_GB', { ...naming, template: '{Nome}-{Lingua}' }), 'Hero-en_gb');
  assert.equal(renderOutputName(ctx('Hero', { index: 1, count: 3 }), 'EN', { template: '{Nome}_{N↑}_{N↓}', start: 5, date: '' }), 'Hero_6_6_EN');
  assert.equal(renderOutputName(ctx('Hero', { index: 0, count: 3 }), 'EN', { template: '{Nome}_{N↓}', start: 1, date: '' }), 'Hero_3_EN');
  assert.equal(renderOutputName(ctx('Hero'), 'EN', { ...naming, template: '{Lingua}_{Nome}' }, 2), 'en_Hero_v2');
  assert.throws(() => renderOutputName(ctx('Hero'), 'EN', { ...naming, template: '{Boh}' }), /sconosciuta/);
  assert.equal(aspectRatio(1080, 1080), '1x1');
  assert.equal(aspectRatio(1200, 1200), '1x1');
  assert.equal(aspectRatio(1080, 1350), '4x5');
  assert.equal(aspectRatio(1920, 1080), '16x9');
  assert.equal(aspectRatio(1200, 628), '1200x628', 'nessuna proporzione intera corta: restano i pixel');
  assert.equal(aspectRatio(1000, 777), '1000x777');
  assert.equal(aspectRatio(2000, 1554), '2000x1554');
});

test('segnala nomi duplicati prodotti dal modello', () => {
  const frames = [{ ...ctx('Hero'), label: 'A' }, { ...ctx('Hero', { index: 1, count: 2 }), label: 'B' }];
  assert.match(namingErrors(frames, ['EN'], plain)[0], /stesso nome "Hero_EN"/);
  assert.deepEqual(namingErrors(frames, ['EN'], { template: '{Nome}_{N↑}', start: 1, date: '' }), []);
});

test('un gruppo usa la stessa versione per tutte le lingue', () => {
  const taken = new Set(['260717_Hero_EN', '260717_Hero_v2_NL']);
  const names = outputGroupNames(ctx('260717_Hero'), ['EN', 'NL'], plain, taken);
  assert.deepEqual([...names], [['EN', '260717_Hero_v3_EN'], ['NL', '260717_Hero_v3_NL']]);
  assert.ok(taken.has('260717_Hero_v3_NL'));
});

test('tag annidati, entity e offset UTF-16 applicabili in Figma', () => {
  const parsed = parseMarkup('A <b>50% <i>🔥</i></b> &amp; <u>altro</u>');
  assert.equal(parsed.text, 'A 50% 🔥 & altro');
  const emoji = parsed.segments.find(segment => segment.text === '🔥');
  assert.ok(emoji);
  assert.equal(emoji.end - emoji.start, 2);
  assert.equal(emoji.b, true);
  assert.equal(emoji.i, true);
  assert.equal(escapeMarkup('A & <B>'), 'A &amp; &lt;B&gt;');
  assert.throws(() => parseMarkup('<b>test</i>'), /Chiusura/);
  assert.throws(() => parseMarkup('<u><s>x</s></u>'), /sovrapporsi/);
  assert.throws(() => parseMarkup('<script>x</script>'), /non supportato/);
});

test('fallback esplicito e validazione delle righe attive', () => {
  const frame = { id: '1:1', name: 'Hero_NL', baseName: 'Hero', sourceLanguage: 'NL', textLayers: [{ id: '1:2', key: 'headline', text: 'Sale', markup: 'Sale' }] };
  const row = { frame: 'Hero_NL', key: 'headline', translate: true, values: { EN: 'Sale', NL: '', FR: '<b>Soldes</b>' } };
  assert.deepEqual(resolveValue(row, 'NL', 'EN'), { markup: 'Sale', fallback: true, sourceLanguage: 'EN' });
  const variant = { ...row, values: { EN_GB: '', EN: 'British base', IT: 'Principale' } };
  assert.deepEqual(resolveValue(variant, 'EN_GB', 'IT'), { markup: 'British base', fallback: true, sourceLanguage: 'EN' });
  assert.deepEqual(resolveValue({ ...variant, values: { EN_GB: '', EN: '', IT: 'Principale' } }, 'EN_GB', 'IT'), { markup: 'Principale', fallback: true, sourceLanguage: 'IT' });
  assert.deepEqual(resolveValue({ ...variant, values: { EN_GB: 'Local', EN: 'Base', IT: 'Principale' } }, 'EN_GB', 'IT'), { markup: 'Local', fallback: false, sourceLanguage: 'EN_GB' });
  assert.deepEqual(validateRows([row], [frame], ['NL', 'FR'], 'EN'), []);
  assert.match(validateRows([row, row], [frame], ['FR'], 'EN').join(' '), /duplicata/);
  assert.match(validateRows([{ ...row, values: { NL: '' } }], [frame], ['NL'], 'EN').join(' '), /manca/);
  assert.match(validateRows([{ ...row, translate: false }], [frame], ['NL'], 'EN').join(' '), /Attiva/);
});

test('le Key duplicate ricevono un suffisso sequenziale senza collisioni', () => {
  const result = uniqueKeys(['cta', 'title', 'title_1', 'title', 'cta', 'body']);
  assert.deepEqual(result.keys, ['cta_1', 'title_2', 'title_1', 'title_3', 'cta_2', 'body']);
  assert.deepEqual(result.duplicates, [{ name: 'cta', keys: ['cta_1', 'cta_2'] }, { name: 'title', keys: ['title_2', 'title_3'] }]);
  assert.deepEqual(uniqueKeys(['a', 'b']).duplicates, []);
});

test('suffisso Lang: il paese si toglie solo se la lingua non ha altre varianti tra quelle generate', () => {
  assert.deepEqual(shortLanguages(['EN_GB', 'FR_FR', 'IT'], 'lang'), ['EN_GB', 'FR_FR']);
  assert.deepEqual(shortLanguages(['EN_GB', 'EN_US', 'FR_FR'], 'lang'), ['FR_FR']);
  assert.deepEqual(shortLanguages(['EN', 'EN_GB'], 'lang'), []);
  assert.deepEqual(shortLanguages(['EN_GB', 'FR_FR'], 'lang-country'), []);
  const context = { name: 'hero', index: 0, count: 1, width: 640, height: 731 };
  const naming = { template: '{Nome}', start: 1, date: '', shortLanguages: ['EN_GB'] };
  assert.equal(renderOutputName(context, 'EN_GB', naming), 'hero_EN');
  assert.equal(renderOutputName(context, 'EN_US', naming), 'hero_EN_US');
  assert.equal(renderOutputName(context, 'EN_GB', { ...naming, template: '{Nome}-{Lingua}-{Paese}' }), 'hero-en');
  assert.equal(renderOutputName(context, 'EN_GB', { ...naming, shortLanguages: undefined }), 'hero_EN_GB', 'senza scelta resta il codice completo');
});
