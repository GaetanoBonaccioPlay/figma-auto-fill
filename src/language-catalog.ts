import { DEFAULT_NAME_TEMPLATE, normalizeLanguage } from './core';

export type LanguageGroup = { code: string; name: string; countries: Array<{ code: string; name: string }> };

export const LANGUAGE_GROUPS: LanguageGroup[] = [
  { code: 'EN', name: 'English', countries: [
    { code: 'GB', name: 'United Kingdom' }, { code: 'DK', name: 'Denmark' },
    { code: 'IE', name: 'Ireland' }, { code: 'SE', name: 'Sweden' },
    { code: 'FI', name: 'Finland' }, { code: 'CZ', name: 'Czech Republic' }
  ] },
  { code: 'DE', name: 'German', countries: [
    { code: 'DE', name: 'Germany' }, { code: 'AT', name: 'Austria' },
    { code: 'BE', name: 'Belgium' }, { code: 'LU', name: 'Luxembourg' },
    { code: 'CH', name: 'Switzerland' }
  ] },
  { code: 'FR', name: 'French', countries: [
    { code: 'FR', name: 'France' }, { code: 'BE', name: 'Belgium' },
    { code: 'LU', name: 'Luxembourg' }, { code: 'CH', name: 'Switzerland' }
  ] },
  { code: 'ES', name: 'Spanish', countries: [{ code: 'ES', name: 'Spain' }] },
  { code: 'NL', name: 'Dutch', countries: [
    { code: 'NL', name: 'Netherlands' }, { code: 'BE', name: 'Belgium' }
  ] },
  { code: 'IT', name: 'Italian', countries: [
    { code: 'IT', name: 'Italy' }, { code: 'CH', name: 'Switzerland' }
  ] },
  { code: 'PL', name: 'Polish', countries: [{ code: 'PL', name: 'Poland' }] },
  { code: 'PT', name: 'Portuguese', countries: [{ code: 'PT', name: 'Portugal' }] },
  { code: 'SV', name: 'Swedish', countries: [{ code: 'SE', name: 'Sweden' }] },
  { code: 'DA', name: 'Danish', countries: [{ code: 'DK', name: 'Denmark' }] },
  { code: 'CS', name: 'Czech', countries: [{ code: 'CZ', name: 'Czech Republic' }] }
];

export const DEFAULT_LANGUAGE_CODES = LANGUAGE_GROUPS.flatMap(group => [group.code, ...group.countries.map(country => `${group.code}_${country.code}`)]);

export type LanguageSettings = { selected: string[]; primary: string; extra: string[]; columnOrder: string[]; nameTemplate: string; numberStart: number };
export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = { selected: ['EN'], primary: 'EN', extra: [], columnOrder: [], nameTemplate: DEFAULT_NAME_TEMPLATE, numberStart: 1 };

function validCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    try {
      const code = normalizeLanguage(item);
      if (!codes.includes(code)) codes.push(code);
    } catch { /* Ignore obsolete or invalid saved codes. */ }
  }
  return codes;
}

export function readLanguageSettings(value: unknown): LanguageSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_LANGUAGE_SETTINGS, selected: ['EN'], extra: [], columnOrder: [] };
  const record = value as Record<string, unknown>;
  const selected = Array.isArray(record.selected) ? validCodes(record.selected) : ['EN'];
  let primary = 'EN';
  if (typeof record.primary === 'string') {
    try { primary = normalizeLanguage(record.primary); } catch { /* Keep EN. */ }
  }
  const extra = validCodes(record.extra);
  for (const code of [...selected, primary]) {
    if (!DEFAULT_LANGUAGE_CODES.includes(code) && !extra.includes(code)) extra.push(code);
    const root = code.split('_')[0];
    if (!DEFAULT_LANGUAGE_CODES.includes(root) && !extra.includes(root)) extra.push(root);
  }
  return { selected, primary, extra: extra.filter(code => !DEFAULT_LANGUAGE_CODES.includes(code)), columnOrder: validCodes(record.columnOrder),
    nameTemplate: typeof record.nameTemplate === 'string' && record.nameTemplate.trim() ? record.nameTemplate : DEFAULT_NAME_TEMPLATE,
    numberStart: Number.isInteger(record.numberStart) && (record.numberStart as number) >= 0 ? record.numberStart as number : 1 };
}

// Codes listed in the saved column order come first, in that order; the rest
// keep their catalog position after them.
export function orderColumns(codes: string[], order: string[]): string[] {
  const rank = new Map(order.map((code, index) => [code, index]));
  return codes.map((code, index) => ({ code, index }))
    .sort((a, b) => (rank.get(a.code) ?? Infinity) - (rank.get(b.code) ?? Infinity) || a.index - b.index)
    .map(item => item.code);
}

// Moves one visible column and keeps the saved position of columns not shown now.
export function moveColumn(visible: string[], order: string[], code: string, target: string, after: boolean): string[] {
  if (code === target || !visible.includes(code) || !visible.includes(target)) return order;
  const next = visible.filter(item => item !== code);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, code);
  return [...next, ...order.filter(item => !next.includes(item))];
}
