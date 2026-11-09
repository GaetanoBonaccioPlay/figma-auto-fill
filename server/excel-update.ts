import { basename, dirname, extname, join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { escapeMarkup, parseMarkup, resolveValue, type FrameInfo, type TranslationRow } from '../src/core';
import { normalizeText, type ExcelRow, type LayerRef } from './match';

// Markup del plugin ⇄ testo di cella. Una cella con tag di stile resta markup, altrimenti è testo semplice.
export function cellToMarkup(cell: string): string {
  return /<\/?[biusBIUS]>/.test(cell) ? cell : escapeMarkup(cell);
}

export function markupToCell(markup: string): string {
  try {
    const parsed = parseMarkup(markup);
    return parsed.segments.some(segment => segment.b || segment.i || segment.u || segment.s) ? markup : parsed.text;
  } catch { return markup; }
}

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();

export type PlannedWrite = {
  row: number; column: number; language: string; text: string; previous: string;
  kind: 'figma' | 'ai'; source: string;
};
export type UpdateConflict = {
  row: number; language: string; current: string; proposed: string; source: string;
  reason: 'cella-piena' | 'fonti-divergenti';
};
export type NewRow = { row: number; id: string; cells: Array<{ column: number; language: string; text: string }>; source: string };
export type UpdatePlan = { writes: PlannedWrite[]; conflicts: UpdateConflict[]; newRows: NewRow[] };

export type PlanInput = {
  rows: ExcelRow[];
  languageColumns: Record<string, number>;
  primary: string;
  sourceColumn: number;
  matches: Array<{ layer: LayerRef; row: number }>;
  orphans: LayerRef[];
  generated: TranslationRow[];
  figma: FrameInfo[];
  ai: Array<{ row: number; language: string; text: string }>;
  overwrite: Array<{ row: number; language: string }>;
  lastRow: number;
};

function expectedMarkup(row: TranslationRow | undefined, language: string, primary: string): string {
  if (!row) return '';
  try { return resolveValue(row, language, primary).markup; }
  catch { return ''; }
}

export function planUpdates(input: PlanInput): UpdatePlan {
  const rowByNumber = new Map(input.rows.map(row => [row.row, row]));
  const generated = new Map(input.generated.map(item => [`${item.frame}\u0000${item.key}`, item]));
  const figma = new Map(input.figma.map(frame => [frame.id, frame]));
  const overwrite = new Set(input.overwrite.map(item => `${item.row}\u0000${item.language}`));
  const languages = Object.keys(input.languageColumns).filter(code => code !== input.primary);
  const writes = new Map<string, PlannedWrite>();
  const conflicts: UpdateConflict[] = [];
  const blocked = new Set<string>();

  const propose = (row: number, language: string, proposed: string, kind: 'figma' | 'ai', source: string): void => {
    const id = `${row}\u0000${language}`;
    const current = rowByNumber.get(row)?.values[language] ?? '';
    const earlier = writes.get(id);
    if (earlier) {
      if (squash(earlier.text) !== squash(proposed) && kind === 'figma') {
        conflicts.push({ row, language, current: earlier.text, proposed, source, reason: 'fonti-divergenti' });
      }
      return;
    }
    if (blocked.has(id)) return;
    if (current.trim() === '' || overwrite.has(id)) {
      if (squash(current) === squash(proposed)) return;
      writes.set(id, { row, column: input.languageColumns[language], language, text: proposed, previous: current, kind, source });
    } else if (squash(current) !== squash(proposed)) {
      blocked.add(id);
      conflicts.push({ row, language, current, proposed, source, reason: 'cella-piena' });
    }
  };

  const differingTranslations = (layer: LayerRef): Array<{ language: string; text: string }> => {
    const frame = figma.get(layer.frameId);
    const translations = frame?.existingTranslations?.[layer.key];
    if (!translations) return [];
    const sent = generated.get(`${layer.frame}\u0000${layer.key}`);
    return languages.flatMap(language => {
      const found = translations[language];
      if (found === undefined) return [];
      return squash(found) === squash(expectedMarkup(sent, language, input.primary)) ? [] : [{ language, text: markupToCell(found) }];
    });
  };

  for (const { layer, row } of input.matches) {
    for (const item of differingTranslations(layer)) propose(row, item.language, item.text, 'figma', `figma:${layer.frame}`);
  }
  for (const item of input.ai) propose(item.row, item.language, item.text, 'ai', 'ai');

  const newRows: NewRow[] = [];
  const seen = new Set<string>();
  let nextRow = input.lastRow;
  for (const layer of input.orphans) {
    const text = normalizeText(layer.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    nextRow++;
    const sent = generated.get(`${layer.frame}\u0000${layer.key}`);
    const sourceText = markupToCell(sent?.values[input.primary] ?? escapeMarkup(layer.text));
    newRows.push({
      row: nextRow, id: `${layer.frame}/${layer.key}`, source: `figma:${layer.frame}`,
      cells: [
        { column: input.sourceColumn, language: input.primary, text: sourceText },
        ...differingTranslations(layer).map(item => ({ column: input.languageColumns[item.language], language: item.language, text: item.text }))
      ]
    });
  }
  return { writes: [...writes.values()], conflicts, newRows };
}

const FILL: Record<string, string> = { figma: 'FFFFF2CC', ai: 'FFDDEBF7', orphan: 'FFFCE4D6' };

export function defaultOutputPath(input: string): string {
  return join(dirname(input), `${basename(input, extname(input))}_updated.xlsx`);
}

export async function writeUpdatedWorkbook(options: {
  input: string; output: string; sheet: string; plan: UpdatePlan; idColumn?: number;
}): Promise<void> {
  if (resolve(options.input) === resolve(options.output)) throw new Error('Il file di output non può coincidere con l\'Excel originale');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.input);
  const sheet = workbook.getWorksheet(options.sheet);
  if (!sheet) throw new Error(`Foglio "${options.sheet}" non trovato`);
  const mark = (cell: ExcelJS.Cell, kind: string, note: string): void => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[kind] } };
    cell.note = note;
  };
  for (const write of options.plan.writes) {
    const cell = sheet.getCell(write.row, write.column);
    cell.value = write.text;
    mark(cell, write.kind, write.kind === 'ai'
      ? 'Traduzione AI: da revisionare'
      : `Da Figma (${write.source.replace(/^figma:/, '')})${write.previous ? `. Prima: ${write.previous}` : ''}`);
  }
  for (const added of options.plan.newRows) {
    if (options.idColumn) sheet.getCell(added.row, options.idColumn).value = added.id;
    for (const item of added.cells) {
      const cell = sheet.getCell(added.row, item.column);
      cell.value = item.text;
      mark(cell, 'orphan', `Riga aggiunta da Figma (${added.id}): non presente nell'Excel cliente`);
    }
  }
  await workbook.xlsx.writeFile(options.output);
}
