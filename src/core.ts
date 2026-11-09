import { ISO_COUNTRIES, ISO_LANGUAGES } from './iso-codes';

export const SHEET_NAME = 'Translations';
export const FIXED_HEADERS = ['Frame', 'Key', 'Traduci'];

export type TextLayerInfo = { id: string; key: string; text: string; markup: string };
export type FrameInfo = {
  id: string;
  name: string;
  // Unique among the selected frames: duplicated names become "Name (1)", "Name (2)"…
  label?: string;
  baseName: string;
  width?: number;
  height?: number;
  sourceLanguage: string;
  managedRole?: 'master' | 'locale';
  exportSectionMode?: 'none' | 'locale' | 'base';
  groupId?: string;
  existingTranslations?: Record<string, Record<string, string>>;
  hiddenTextLayers?: number;
  duplicateKeys?: Array<{ name: string; keys: string[] }>;
  textLayers: TextLayerInfo[];
};

export function frameLabel(frame: FrameInfo): string {
  return frame.label ?? frame.name;
}

// Frames may share a name (outputs differ through the name template), so rows
// point to a per-selection label that numbers repeated names in layer order.
export function frameLabels(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const taken = new Set(names.filter(name => counts.get(name) === 1));
  const next = new Map<string, number>();
  return names.map(name => {
    if (counts.get(name) === 1) return name;
    let index = next.get(name) ?? 1;
    while (taken.has(`${name} (${index})`)) index++;
    next.set(name, index + 1);
    taken.add(`${name} (${index})`);
    return `${name} (${index})`;
  });
}

// Layers sharing a name get a sequential suffix (headline_1, headline_2…) that
// never collides with another layer name, so every row maps to one layer.
export function uniqueKeys(names: string[]): { keys: string[]; duplicates: Array<{ name: string; keys: string[] }> } {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const taken = new Set(names.filter(name => counts.get(name) === 1));
  const next = new Map<string, number>();
  const duplicates = new Map<string, string[]>();
  const keys = names.map(name => {
    if (counts.get(name) === 1) return name;
    let index = next.get(name) ?? 1;
    while (taken.has(`${name}_${index}`)) index++;
    const key = `${name}_${index}`;
    next.set(name, index + 1);
    taken.add(key);
    duplicates.set(name, [...(duplicates.get(name) ?? []), key]);
    return key;
  });
  return { keys, duplicates: [...duplicates].map(([name, renamed]) => ({ name, keys: renamed })) };
}
export type TranslationRow = {
  frame: string;
  key: string;
  translate: boolean;
  values: Record<string, string>;
};

export function orderRowsByFrames(rows: TranslationRow[], frameNames: string[]): TranslationRow[] {
  const positions = new Map(frameNames.map((name, index) => [name, index]));
  return rows.map((row, index) => ({ row, index })).sort((a, b) =>
    (positions.get(a.row.frame) ?? Infinity) - (positions.get(b.row.frame) ?? Infinity) || a.index - b.index
  ).map(item => item.row);
}

export function rowsFromFrames(
  frames: FrameInfo[], languages: string[], previousRows: TranslationRow[], sourceLanguages: Map<string, string>
): TranslationRow[] {
  const previous = new Map(previousRows.map(row => [`${row.frame}\u0000${row.key}`, row]));
  return frames.flatMap(frame => frame.textLayers.map(layer => {
    const old = previous.get(`${frameLabel(frame)}\u0000${layer.key}`);
    const exported = frame.existingTranslations?.[layer.key] ?? {};
    const codes = new Set([...languages, ...Object.keys(exported), ...Object.keys(old?.values ?? {})]);
    const values = Object.fromEntries([...codes].map(language => {
      const previousValue = old?.values[language];
      return [language, previousValue === '' && !old?.translate
        ? exported[language] ?? '' : previousValue ?? exported[language] ?? ''];
    })) as Record<string, string>;
    const source = sourceLanguages.get(frame.id) ?? frame.sourceLanguage;
    if (!values[source] || frame.managedRole === 'master') values[source] = layer.markup;
    const translated = Object.values(exported).some(value => value !== layer.markup);
    const previousLocaleText = Object.entries(old?.values ?? {}).some(([code, value]) => code !== source && value !== '');
    return { frame: frameLabel(frame), key: layer.key,
      translate: old?.translate === true || (translated && !previousLocaleText), values };
  }));
}
export type MarkedSegment = {
  text: string;
  start: number;
  end: number;
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
};
export type ParsedMarkup = { text: string; segments: MarkedSegment[] };

const LANGUAGE_PATTERN = /^[A-Z]{2}(?:_[A-Z]{2})?$/;
const SUFFIX_PATTERN = /_([A-Za-z]{2}(?:_[A-Za-z]{2})?)$/;
const DATE_PATTERN = /^(\d{6})_/;

export function normalizeLanguage(value: string): string {
  const code = value.trim().replace('-', '_').toUpperCase();
  if (!LANGUAGE_PATTERN.test(code)) throw new Error(`Codice lingua non valido: ${value}`);
  const [language, country] = code.split('_');
  if (!ISO_LANGUAGES.has(language) || (country && !ISO_COUNTRIES.has(country))) {
    throw new Error(`Codice ISO non valido: ${value}`);
  }
  return code;
}

export function detectSourceLanguage(name: string): string | null {
  const suffix = name.match(SUFFIX_PATTERN)?.[1];
  if (!suffix) return null;
  try { return normalizeLanguage(suffix); }
  catch { return null; }
}

export function stripLanguageSuffix(name: string): string {
  return detectSourceLanguage(name) ? name.replace(SUFFIX_PATTERN, '') : name;
}

export function isValidDate(date: string): boolean {
  if (!/^\d{6}$/.test(date)) return false;
  const yy = Number(date.slice(0, 2));
  const mm = Number(date.slice(2, 4));
  const dd = Number(date.slice(4, 6));
  const parsed = new Date(Date.UTC(2000 + yy, mm - 1, dd));
  return parsed.getUTCFullYear() === 2000 + yy && parsed.getUTCMonth() === mm - 1 && parsed.getUTCDate() === dd;
}

export type NamingOptions = { template: string; start: number; date: string };
export type NameContext = { name: string; index: number; count: number; width: number; height: number };
export const DEFAULT_NAME_TEMPLATE = '{Nome}';
export const DEFAULT_NAMING: NamingOptions = { template: DEFAULT_NAME_TEMPLATE, start: 1, date: '' };
export const NAME_TOKENS = [
  { token: '{Nome}', label: 'Nome attuale' },
  { token: '{N↑}', label: 'Numero ↑' },
  { token: '{N↓}', label: 'Numero ↓' },
  { token: '{Lingua}', label: 'Language' },
  { token: '{Paese}', label: 'Country' },
  { token: '{Ratio}', label: 'Aspect Ratio' },
  { token: '{Data}', label: 'Data AAMMGG' }
] as const;

const TOKEN_PATTERN = /\{([^{}]*)\}/g;
const SEPARATOR = /[-_. ]$/;
const COMMON_RATIOS: Array<[number, number]> = [
  [1, 1], [4, 5], [5, 4], [2, 3], [3, 2], [3, 4], [4, 3], [9, 16], [16, 9], [1, 2], [2, 1], [21, 9], [9, 21], [1.91, 1], [1, 1.91]
];

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function aspectRatio(width: number, height: number): string {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return '';
  const divisor = gcd(w, h);
  if (w / divisor <= 32 && h / divisor <= 32) return `${w / divisor}×${h / divisor}`;
  const ratio = w / h;
  const near = COMMON_RATIOS.find(([a, b]) => Math.abs(a / b - ratio) / ratio < 0.02);
  return near ? `${near[0]}×${near[1]}` : `${w}×${h}`;
}

function templateTokens(template: string): string[] {
  return (template.match(TOKEN_PATTERN) ?? []).map(token => token.slice(1, -1).trim().toLowerCase());
}

// Renders one output name. {Lingua} is the full code in lowercase (en_gb) unless {Paese} is
// also used; without either, `_<code>` is appended so languages never collide.
// An empty value also drops the separator just before it (Hero-en-{Paese} → Hero-en).
export function renderOutputName(context: NameContext, language: string, naming: NamingOptions, version = 1): string {
  const code = normalizeLanguage(language);
  const [lang, country = ''] = code.split('_');
  const tokens = templateTokens(naming.template);
  const usesDate = tokens.includes('data');
  let base = stripLanguageSuffix(context.name.trim());
  if (usesDate) base = base.replace(DATE_PATTERN, '');
  if (tokens.includes('nome') && !base) throw new Error('Nome base del frame vuoto');
  if (usesDate && !isValidDate(naming.date)) throw new Error('La data deve essere AAMMGG e valida');
  if (!Number.isInteger(naming.start) || naming.start < 0) throw new Error('Il numero iniziale deve essere un intero positivo');
  const versionSuffix = version > 1 ? `_v${version}` : '';
  const values: Record<string, string> = {
    nome: `${base}${versionSuffix}`,
    'n↑': String(naming.start + context.index),
    n: String(naming.start + context.index),
    'n↓': String(naming.start + context.count - 1 - context.index),
    lingua: (tokens.includes('paese') ? lang : code).toLowerCase(),
    paese: country.toLowerCase(),
    ratio: aspectRatio(context.width, context.height),
    data: naming.date
  };
  let result = '';
  let dropSeparator = false;
  let last = 0;
  const pattern = new RegExp(TOKEN_PATTERN.source, 'g');
  for (let match = pattern.exec(naming.template); match; match = pattern.exec(naming.template)) {
    let literal = naming.template.slice(last, match.index);
    if (dropSeparator) literal = literal.replace(/^[-_. ]/, '');
    result += literal;
    last = match.index + match[0].length;
    const key = match[1].trim().toLowerCase();
    if (!(key in values)) throw new Error(`Variabile sconosciuta nel nome: ${match[0]}`);
    const value = values[key];
    dropSeparator = false;
    if (value) result += value;
    else if (SEPARATOR.test(result)) result = result.slice(0, -1);
    else dropSeparator = true;
  }
  let tail = naming.template.slice(last);
  if (dropSeparator) tail = tail.replace(/^[-_. ]/, '');
  result = `${result}${tail}`.trim();
  if (!tokens.includes('nome') && versionSuffix) result += versionSuffix;
  if (!tokens.includes('lingua') && !tokens.includes('paese')) result += `_${code}`;
  if (!result) throw new Error('Il modello del nome produce un nome vuoto');
  return result;
}

export function outputName(context: NameContext, language: string, naming: NamingOptions, taken: Set<string>): string {
  for (let version = 1; ; version++) {
    const result = renderOutputName(context, language, naming, version);
    if (taken.has(result)) continue;
    taken.add(result);
    return result;
  }
}

export function outputGroupNames(context: NameContext, languages: string[], naming: NamingOptions, taken: Set<string>): Map<string, string> {
  if (!languages.length) throw new Error('Nessuna lingua da generare');
  const normalized = languages.map(normalizeLanguage);
  for (let version = 1; ; version++) {
    const names = normalized.map(code => renderOutputName(context, code, naming, version));
    if (names.some(name => taken.has(name))) continue;
    names.forEach(name => taken.add(name));
    return new Map(normalized.map((code, index) => [code, names[index]]));
  }
}

// Errors for names that cannot be built or that two outputs would share.
export function namingErrors(contexts: Array<NameContext & { label: string }>, languages: string[], naming: NamingOptions): string[] {
  const errors: string[] = [];
  const owners = new Map<string, string>();
  for (const context of contexts) {
    for (const language of languages) {
      let name: string;
      try { name = renderOutputName(context, language, naming); }
      catch (error) { errors.push(`${context.label}: ${(error as Error).message}`); break; }
      const owner = `${context.label} · ${language}`;
      const other = owners.get(name);
      if (other) errors.push(`Il modello genera lo stesso nome "${name}" per ${other} e ${owner}: aggiungi {Lingua}, {Paese} o {N↑}`);
      else owners.set(name, owner);
    }
  }
  return [...new Set(errors)];
}

export function parseMarkup(input: string): ParsedMarkup {
  const segments: MarkedSegment[] = [];
  const stack: Array<'b' | 'i' | 'u' | 's'> = [];
  let text = '';
  let segmentStart = 0;
  let segmentText = '';
  let flags = { b: false, i: false, u: false, s: false };
  const flush = () => {
    if (!segmentText) return;
    segments.push({ text: segmentText, start: segmentStart, end: segmentStart + segmentText.length, ...flags });
    segmentStart += segmentText.length;
    segmentText = '';
  };
  for (let i = 0; i < input.length;) {
    if (input[i] === '<') {
      const close = input.indexOf('>', i + 1);
      if (close < 0) throw new Error('Tag di stile non chiuso');
      const raw = input.slice(i + 1, close);
      const match = raw.match(/^(\/)?(b|i|u|s)$/i);
      if (!match) throw new Error(`Tag non supportato: <${raw}>`);
      const tag = match[2].toLowerCase() as 'b' | 'i' | 'u' | 's';
      flush();
      if (match[1]) {
        if (stack[stack.length - 1] !== tag) throw new Error(`Chiusura tag inattesa: </${tag}>`);
        stack.pop();
      } else stack.push(tag);
      flags = { b: stack.includes('b'), i: stack.includes('i'), u: stack.includes('u'), s: stack.includes('s') };
      if (flags.u && flags.s) throw new Error('Sottolineato e barrato non possono sovrapporsi');
      i = close + 1;
      continue;
    }
    if (input[i] === '&') {
      const entity = /^(?:&amp;|&lt;|&gt;|&quot;|&#39;)/.exec(input.slice(i));
      if (entity) {
        const decoded: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
        segmentText += decoded[entity[0]];
        text += decoded[entity[0]];
        i += entity[0].length;
        continue;
      }
    }
    segmentText += input[i];
    text += input[i];
    i++;
  }
  if (stack.length) throw new Error(`Tag non chiuso: <${stack[stack.length - 1]}>`);
  flush();
  return { text, segments };
}

export function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function resolveValue(row: TranslationRow, language: string, primary: string): { markup: string; fallback: boolean; sourceLanguage: string } {
  const parent = language.includes('_') ? language.split('_')[0] : null;
  const candidates = [...new Set([language, ...(parent ? [parent] : []), primary])];
  for (const code of candidates) {
    const markup = row.values[code] ?? '';
    if (markup.trim()) return { markup, fallback: code !== language, sourceLanguage: code };
  }
  throw new Error(`${row.frame} / ${row.key}: manca un testo per ${language}; controlla ${candidates.join(' → ')}`);
}

export function validateRows(rows: TranslationRow[], frames: FrameInfo[], targets: string[], primary: string): string[] {
  const errors: string[] = [];
  const frameMap = new Map(frames.map(frame => [frameLabel(frame), frame]));
  const seen = new Set<string>();
  let active = 0;
  for (const row of rows) {
    if (!row.translate) continue;
    active++;
    const id = `${row.frame}\u0000${row.key}`;
    if (seen.has(id)) errors.push(`${row.frame} / ${row.key}: riga duplicata`);
    seen.add(id);
    const frame = frameMap.get(row.frame);
    if (!frame) { errors.push(`${row.frame}: frame non selezionato`); continue; }
    const matches = frame.textLayers.filter(layer => layer.key === row.key);
    if (matches.length !== 1) errors.push(`${row.frame} / ${row.key}: atteso un solo livello di testo, trovati ${matches.length}`);
    for (const lang of targets) {
      try { parseMarkup(resolveValue(row, lang, primary).markup); }
      catch (error) { errors.push((error as Error).message); }
    }
  }
  if (active === 0) errors.push('Attiva almeno una riga nella colonna Traduci');
  return [...new Set(errors)];
}
