import ExcelJS from 'exceljs';
import { ISO_COUNTRIES, ISO_LANGUAGES } from '../src/iso-codes';
import { normalizeLanguage } from '../src/core';
import { LANGUAGE_GROUPS } from '../src/language-catalog';

export type SheetData = { name: string; rows: string[][] };

export async function readSheets(path: string): Promise<SheetData[]> {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.readFile(path); }
  catch (error) { throw new Error(`Excel non leggibile (${path}): ${(error as Error).message}`); }
  return workbook.worksheets.filter(sheet => sheet.state === 'visible').map(sheet => {
    const rows: string[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) cells.push(cellText(row.getCell(c)));
      rows.push(cells);
    }
    return { name: sheet.name, rows };
  });
}

export function cellText(cell: ExcelJS.Cell): string {
  try { return (cell.text ?? '').toString(); }
  catch { return ''; }
}

export function columnLetter(column: number): string {
  let letters = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

export function columnNumber(reference: string | number): number {
  if (typeof reference === 'number') return reference;
  if (/^\d+$/.test(reference)) return Number(reference);
  const letters = reference.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(letters)) throw new Error(`Riferimento di colonna non valido: ${reference}`);
  return [...letters].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const LANGUAGE_NAMES: Record<string, string[]> = {
  EN: ['english', 'inglese', 'anglais', 'englisch', 'ingles'],
  DE: ['german', 'tedesco', 'deutsch', 'allemand', 'aleman'],
  FR: ['french', 'francese', 'francais', 'frances', 'franzosisch'],
  ES: ['spanish', 'spagnolo', 'espanol', 'castellano', 'spanisch', 'espagnol'],
  NL: ['dutch', 'olandese', 'nederlands', 'neerlandese', 'niederlandisch'],
  IT: ['italian', 'italiano', 'italienisch', 'italien'],
  PL: ['polish', 'polacco', 'polski', 'polnisch'],
  PT: ['portuguese', 'portoghese', 'portugues', 'portugiesisch'],
  SV: ['swedish', 'svedese', 'svenska', 'schwedisch'],
  DA: ['danish', 'danese', 'dansk', 'danisch'],
  CS: ['czech', 'ceco', 'cestina', 'cesky', 'tschechisch']
};
const NAME_TO_CODE = new Map(Object.entries(LANGUAGE_NAMES).flatMap(([code, names]) => names.map(name => [name, code] as const)));
const COUNTRY_NAMES = new Map(LANGUAGE_GROUPS.flatMap(group => group.countries.map(country => [fold(country.name), country.code] as const)));
const COUNTRY_ALIASES = new Map([['uk', 'GB'], ['england', 'GB'], ['great britain', 'GB'], ['svizzera', 'CH'], ['switzerland', 'CH']]);
// Parole che accompagnano il nome della lingua nelle intestazioni ("Testo italiano", "Translation EN")
const FILLER = new Set(['testo', 'text', 'copy', 'translation', 'traduzione', 'lang', 'language', 'lingua', 'locale', 'version', 'versione', 'in']);
// Intestazioni che sembrano codici ISO ma sono altro
const NOT_A_LANGUAGE = new Set(['id', 'no', 'nr', 'n', 'ref', 'key']);
const ID_HEADERS = new Set(['id', 'key', 'chiave', 'codice', 'code', 'ref', 'riferimento', 'string id', 'stringid', 'label', 'identificativo']);

export type LanguageGuess = { code: string; confidence: number };

export function languageFromHeader(header: string): LanguageGuess | null {
  const folded = fold(header);
  if (!folded || NOT_A_LANGUAGE.has(folded)) return null;
  const tokens = folded.split(/[\s()[\]_\-/,.:;]+/).filter(token => token && !FILLER.has(token));
  if (!tokens.length || tokens.length > 4) return null;
  const [first, ...rest] = tokens;
  let language = NAME_TO_CODE.get(first) ?? null;
  let confidence = 0.95;
  if (!language && /^[a-z]{2}$/.test(first) && !NOT_A_LANGUAGE.has(first) && ISO_LANGUAGES.has(first.toUpperCase())) {
    language = first.toUpperCase();
    confidence = 0.85;
  }
  if (!language) return null;
  let country: string | null = null;
  const remainder = rest.join(' ');
  if (remainder) {
    const alias = COUNTRY_ALIASES.get(remainder) ?? COUNTRY_NAMES.get(remainder);
    if (alias) country = alias;
    else if (rest.length === 1 && /^[a-z]{2}$/.test(rest[0]) && ISO_COUNTRIES.has(rest[0].toUpperCase())) country = rest[0].toUpperCase();
    else return null;
  }
  const code = country ? `${language}_${country}` : language;
  try { return { code: normalizeLanguage(code), confidence }; }
  catch { return null; }
}

export type AnalyzedColumn = { column: number; letter: string; header: string; code: string; confidence: number };
export type IgnoredColumn = { column: number; letter: string; header: string; reason: string };

export type SheetAnalysis = {
  sheet: string;
  headerRow: number;
  languageColumns: AnalyzedColumn[];
  ignoredColumns: IgnoredColumn[];
  idColumn?: number;
  dataRows: number;
  warnings: string[];
};

const HEADER_SCAN_ROWS = 10;

export function analyzeSheet(sheet: SheetData): SheetAnalysis {
  let best: { index: number; columns: AnalyzedColumn[] } | null = null;
  for (let index = 0; index < Math.min(sheet.rows.length, HEADER_SCAN_ROWS); index++) {
    const columns: AnalyzedColumn[] = [];
    sheet.rows[index].forEach((header, offset) => {
      const guess = languageFromHeader(header);
      if (guess) columns.push({ column: offset + 1, letter: columnLetter(offset + 1), header: header.trim(), ...guess });
    });
    if (columns.length && (!best || columns.length > best.columns.length)) best = { index, columns };
  }
  const warnings: string[] = [];
  if (!best) return { sheet: sheet.name, headerRow: 0, languageColumns: [], ignoredColumns: [], dataRows: 0, warnings: ['Nessuna colonna lingua riconosciuta'] };
  const headerCells = sheet.rows[best.index];
  const languageSet = new Set(best.columns.map(item => item.column));
  const ignoredColumns: IgnoredColumn[] = headerCells.flatMap((header, offset) =>
    header.trim() && !languageSet.has(offset + 1)
      ? [{ column: offset + 1, letter: columnLetter(offset + 1), header: header.trim(), reason: 'non è una colonna lingua' }]
      : []);
  const idIndex = headerCells.findIndex(header => ID_HEADERS.has(fold(header)));
  const dataRows = sheet.rows.slice(best.index + 1)
    .filter(row => best!.columns.some(item => (row[item.column - 1] ?? '').trim() !== '')).length;
  const counts = new Map<string, AnalyzedColumn[]>();
  for (const item of best.columns) counts.set(item.code, [...(counts.get(item.code) ?? []), item]);
  for (const [code, items] of counts) {
    if (items.length > 1) warnings.push(`Lingua ${code} in più colonne (${items.map(item => item.letter).join(', ')}): indica quella da usare`);
  }
  if (best.columns.some(item => item.confidence < 0.9)) {
    warnings.push('Alcune intestazioni sono state riconosciute solo come codice lingua: verifica la mappatura');
  }
  return {
    sheet: sheet.name, headerRow: best.index + 1, languageColumns: best.columns, ignoredColumns,
    idColumn: idIndex >= 0 ? idIndex + 1 : undefined, dataRows, warnings
  };
}

export type SourceColumnGuess = { column: number; letter: string; code: string };

export function proposeSourceColumn(columns: AnalyzedColumn[], primary: string): SourceColumnGuess | null {
  const exact = columns.find(item => item.code === primary);
  const sameLanguage = !primary.includes('_') ? columns.find(item => item.code.split('_')[0] === primary) : undefined;
  const pick = exact ?? sameLanguage;
  return pick ? { column: pick.column, letter: pick.letter, code: pick.code } : null;
}

export function languageDifferences(excelCodes: string[], profileCodes: string[]): { missingInExcel: string[]; extraInExcel: string[] } {
  const excel = new Set(excelCodes);
  const profile = new Set(profileCodes);
  return {
    missingInExcel: profileCodes.filter(code => !excel.has(code)),
    extraInExcel: excelCodes.filter(code => !profile.has(code))
  };
}

export type AnalysisReport = {
  path: string;
  sheets: Array<{ name: string; languageColumns: number; dataRows: number }>;
  analysis: SheetAnalysis;
  sourceColumn: SourceColumnGuess | null;
  differences: { missingInExcel: string[]; extraInExcel: string[] } | null;
  warnings: string[];
};

export function analyzeWorkbook(
  path: string, sheets: SheetData[], options: { sheet?: string; primary?: string; profileLanguages?: string[] } = {}
): AnalysisReport {
  if (!sheets.length) throw new Error('Il file non contiene fogli visibili');
  const analyses = sheets.map(analyzeSheet);
  let chosen: SheetAnalysis | undefined;
  if (options.sheet) {
    chosen = analyses.find(item => item.sheet === options.sheet);
    if (!chosen) throw new Error(`Foglio "${options.sheet}" non trovato. Fogli disponibili: ${analyses.map(item => item.sheet).join(', ')}`);
  } else {
    chosen = [...analyses].sort((a, b) => b.languageColumns.length * 1000 + b.dataRows - (a.languageColumns.length * 1000 + a.dataRows))[0];
  }
  const warnings = [...chosen.warnings];
  if (!options.sheet && analyses.filter(item => item.languageColumns.length).length > 1) {
    warnings.push(`Più fogli con colonne lingua: proposto "${chosen.sheet}", conferma o indica un altro foglio`);
  }
  const codes = chosen.languageColumns.map(item => item.code);
  const sourceColumn = options.primary ? proposeSourceColumn(chosen.languageColumns, options.primary) : null;
  if (options.primary && !sourceColumn) warnings.push(`Nessuna colonna per la lingua principale ${options.primary}: indica tu la Colonna sorgente`);
  const differences = options.profileLanguages?.length ? languageDifferences(codes, options.profileLanguages) : null;
  if (differences && (differences.missingInExcel.length || differences.extraInExcel.length)) {
    warnings.push('Le lingue dell\'Excel differiscono da quelle del Profilo brand: vale l\'Excel');
  }
  return {
    path,
    sheets: analyses.map(item => ({ name: item.sheet, languageColumns: item.languageColumns.length, dataRows: item.dataRows })),
    analysis: chosen, sourceColumn, differences, warnings
  };
}
