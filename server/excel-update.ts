import { rename, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { escapeMarkup, parseMarkup, resolveValue, type FrameInfo, type TranslationRow } from '../src/core';
import { cellText, columnLetter } from './excel-analyze';
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

// Marcatore scritto nelle proprietà del documento delle copie che generiamo: serve a riconoscerle quando si rigenerano.
export const GENERATED_MARKER = 'Generato da Figma Auto Fill: copia aggiornata, l\'originale non è stato modificato';

export async function isGeneratedCopy(path: string): Promise<boolean> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    return workbook.description === GENERATED_MARKER;
  } catch { return false; }
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

// L'Excel originale non va mai toccato. Il controllo è sul file, non sul testo del percorso: `..`, link simbolici,
// hard link e maiuscole/minuscole (il disco del Mac non le distingue) portano comunque allo stesso file.
// Un file già esistente si sovrascrive solo se `allowOverwrite` (una copia generata da noi).
export async function assertSafeOutput(input: string, output: string, allowOverwrite: boolean): Promise<void> {
  const sameFile = `Il file di output non può coincidere con l'Excel originale: ${basename(input)}`;
  if (extname(output).toLowerCase() !== '.xlsx') throw new Error(`Il file di output deve avere estensione .xlsx: ${output}`);
  let directory: string;
  try { directory = await realpath(dirname(output)); }
  catch (error) { throw isMissing(error) ? new Error(`Cartella di destinazione non trovata: ${dirname(output)}`) : error; }
  const originalPath = await realpath(input);
  if (join(directory, basename(output)) === originalPath) throw new Error(sameFile);
  let existing;
  try { existing = await stat(output); }
  catch (error) { if (isMissing(error)) return; throw error; }
  const original = await stat(input);
  if (existing.ino === original.ino && existing.dev === original.dev) throw new Error(sameFile);
  if (!allowOverwrite) {
    throw new Error(`${output} esiste già e non è una copia generata da questo strumento: scegli un altro nome`);
  }
}

type MergeRange = { top: number; left: number; bottom: number; right: number };

// ExcelJS non espone l'elenco delle celle unite (sheet.model lo ricostruisce serializzando tutto il foglio):
// si legge la mappa interna, in sola lettura. ExcelJS 4.4 è l'ultima versione e un test copre questo accesso.
function mergedRanges(sheet: ExcelJS.Worksheet): MergeRange[] {
  const merges = (sheet as unknown as { _merges?: Record<string, MergeRange | undefined> })._merges ?? {};
  return Object.values(merges).filter((range): range is MergeRange => Boolean(range))
    .map(({ top, left, bottom, right }) => ({ top, left, bottom, right }));
}

const rangeAddress = (range: MergeRange): string =>
  `${columnLetter(range.left)}${range.top}:${columnLetter(range.right)}${range.bottom}`;

// Toglie tutte le righe dopo `last`. spliceRows di ExcelJS non sa togliere un blocco che arriva in fondo al foglio (sposta
// l'ultima riga e lascia le altre) e, chiamato riga per riga, rifà ogni volta il giro fino all'ultima riga: con un foglio
// formattato fino in fondo (1.048.576 righe) servirebbero ore. Si accorcia l'elenco interno delle righe, come fa ExcelJS
// stesso con le righe vuote in coda (_lastRowNumber); un test copre questo accesso. Senza l'elenco, il giro lento.
function removeRowsAfter(sheet: ExcelJS.Worksheet, last: number): void {
  const rows = (sheet as unknown as { _rows?: unknown[] })._rows;
  if (Array.isArray(rows)) { if (rows.length > last) rows.length = last; return; }
  for (let row = sheet.rowCount; row > last; row--) sheet.spliceRows(row, 1);
}

const isFormula = (value: ExcelJS.CellValue): value is ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue =>
  value !== null && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value);

export type CopyNotes = {
  // Celle con formula nelle righe tenute, con l'indirizzo che hanno nella copia: i riferimenti non vengono aggiornati
  // e puntano ancora alle righe dell'Excel originale.
  formulaCells: string[];
  // Celle unite che attraversano righe tolte: nella copia restano unite solo le righe tenute.
  reducedMerges: string[];
  conditionalFormatting: boolean;
};

export async function writeUpdatedWorkbook(options: {
  input: string; output: string; sheet: string; plan: UpdatePlan; idColumn?: number;
  // Con keepRows la copia contiene solo l'intestazione (righe fino a headerRow) e queste righe: le altre vengono tolte.
  keepRows?: number[]; headerRow?: number;
  // Ultima riga dell'Excel da cui planUpdates ha numerato le righe aggiunte (newRows): la prima va subito dopo le righe
  // tenute. Va passata la stessa usata dal piano, altrimenti due righe aggiunte possono finire nella stessa riga.
  appendAfter?: number;
  // true solo per una copia già generata da noi (vedi isGeneratedCopy): l'originale non si sovrascrive mai
  allowOverwrite?: boolean;
}): Promise<{ removedRows: number; copyNotes: CopyNotes | null }> {
  await assertSafeOutput(options.input, options.output, options.allowOverwrite ?? false);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.input);
  const sheet = workbook.getWorksheet(options.sheet);
  if (!sheet) throw new Error(`Foglio "${options.sheet}" non trovato`);
  // Le righe usate salgono a coprire quelle non usate, copiando cella per cella valore, stile e nota
  // (spliceRows di ExcelJS perde le note); poi si scrive con i numeri di riga rimappati.
  const rowMap = new Map<number, number>();
  const header = options.headerRow ?? 1;
  let appendAfter = 0;
  let keptRows = 0;
  let removedRows = 0;
  let copyNotes: CopyNotes | null = null;
  if (options.keepRows) {
    // Le righe solo formattate dopo l'ultimo valore non contano: un foglio formattato fino in fondo ne dichiara 1.048.576.
    // total: ultima riga con un valore qualsiasi (va tolta anche se contiene solo spazi). lastText: ultima riga con testo,
    // la stessa regola di readSheets da cui il piano numera le righe aggiunte, se appendAfter non è indicato.
    let total = header;
    let lastText = header;
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      if (number > total && (row.values as unknown[]).some(value => value !== null && value !== undefined && value !== '')) total = number;
      row.eachCell({ includeEmpty: false }, cell => { if (number > lastText && cellText(cell).trim()) lastText = number; });
    });
    appendAfter = options.appendAfter ?? lastText;
    const keep = [...new Set(options.keepRows)].filter(row => row > header && row <= total).sort((a, b) => a - b);
    const kept = new Set(keep);
    const targetOf = (row: number): number | undefined => row <= header ? row : rowMap.get(row);
    keep.forEach((source, index) => rowMap.set(source, header + 1 + index));

    // Celle unite: si sciolgono prima di spostare le righe e si ricreano sulle righe tenute.
    const merges = mergedRanges(sheet).filter(range => range.bottom > header);
    const restore: Array<{ range: MergeRange; value: ExcelJS.CellValue }> = [];
    const reducedMerges: string[] = [];
    for (const range of merges) {
      const rows = Array.from({ length: range.bottom - range.top + 1 }, (_, i) => range.top + i).filter(row => row <= header || kept.has(row));
      const master = sheet.getCell(range.top, range.left).value;
      sheet.unMergeCells(range.top, range.left, range.bottom, range.right);
      if (!rows.length) continue;
      if (rows.length !== range.bottom - range.top + 1) reducedMerges.push(rangeAddress(range));
      const top = targetOf(rows[0])!;
      const bottom = targetOf(rows[rows.length - 1])!;
      // Il valore sta nella cella in alto a sinistra: se quella riga è tolta, passa alla prima riga tenuta.
      if (rows[0] !== range.top) sheet.getCell(rows[0], range.left).value = master;
      restore.push({ range: { top, left: range.left, bottom, right: range.right }, value: master });
    }

    // Formule: i riferimenti non si riscrivono (si segnalano), ma una formula condivisa punta alla sua cella principale,
    // che può essere tolta, e renderebbe il file illeggibile: tutte diventano formule semplici prima di spostarle.
    // Una formula matrice (CSE) resta tale se il suo intervallo sta nella sua riga: diventando semplice cambierebbe risultato.
    const formulas: Array<{ cell: ExcelJS.Cell; value: ExcelJS.CellValue }> = [];
    for (const source of keep) {
      const target = rowMap.get(source)!;
      sheet.getRow(source).eachCell({ includeEmpty: false }, cell => {
        if (!isFormula(cell.value)) return;
        const raw = cell.value as { shareType?: string; ref?: string };
        const range = raw.shareType === 'array' ? /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(raw.ref ?? '') : null;
        const inRow = range && Number(range[2]) === source && (!range[4] || Number(range[4]) === source);
        const value = inRow
          ? { formula: cell.formula, result: cell.result, shareType: 'array', ref: `${range![1]}${target}${range![3] ? `:${range![3]}${target}` : ''}` }
          : { formula: cell.formula, result: cell.result };
        formulas.push({ cell, value: value as ExcelJS.CellValue });
      });
    }
    for (const { cell, value } of formulas) cell.value = value;
    const formulaCells = formulas.map(({ cell }) => `${columnLetter(Number(cell.col))}${rowMap.get(Number(cell.row))}`);
    for (const source of keep) {
      const from = sheet.getRow(source);
      const target = rowMap.get(source)!;
      if (source === target) continue;
      const to = sheet.getRow(target);
      // Le colonne della riga, non sheet.columnCount: un foglio formattato fino all'ultima colonna ne dichiara 16.384.
      const columns = Math.max(from.cellCount, to.cellCount);
      for (let column = 1; column <= columns; column++) {
        const cell = from.getCell(column);
        const copy = to.getCell(column);
        copy.value = cell.value;
        copy.style = JSON.parse(JSON.stringify(cell.style));
        copy.note = (cell.note ?? undefined) as ExcelJS.Cell['note'];
      }
      to.height = from.height;
    }
    removedRows = total - header - keep.length;
    keptRows = keep.length;
    removeRowsAfter(sheet, header + keep.length);
    for (const { range } of restore) {
      if (range.top === range.bottom && range.left === range.right) continue;
      sheet.mergeCells(range.top, range.left, range.bottom, range.right);
    }
    const conditionalFormatting = Boolean((sheet as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings?.length);
    if (formulaCells.length || reducedMerges.length || (conditionalFormatting && removedRows)) {
      copyNotes = { formulaCells, reducedMerges, conditionalFormatting: conditionalFormatting && removedRows > 0 };
    }
  }
  // Righe usate: la loro nuova posizione. Righe aggiunte (oltre appendAfter): in coda, subito dopo le righe tenute.
  // Una scrittura su una riga che non è tra quelle tenute finirebbe su un'altra riga del cliente: si rifiuta.
  const mapRow = (row: number): number => {
    if (!options.keepRows) return row;
    const mapped = rowMap.get(row);
    if (mapped !== undefined) return mapped;
    if (row > appendAfter) return header + keptRows + (row - appendAfter);
    throw new Error(`Riga ${row}: non è tra le righe usate dai frame, quindi non è nella copia. Rifai l'abbinamento o usa only_used_rows: false`);
  };
  const mark = (cell: ExcelJS.Cell, kind: string, note: string): void => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[kind] } };
    cell.note = note;
  };
  for (const write of options.plan.writes) {
    const cell = sheet.getCell(mapRow(write.row), write.column);
    cell.value = write.text;
    mark(cell, write.kind, write.kind === 'ai'
      ? 'Traduzione AI: da revisionare'
      : `Da Figma (${write.source.replace(/^figma:/, '')})${write.previous ? `. Prima: ${write.previous}` : ''}`);
  }
  for (const added of options.plan.newRows) {
    const row = mapRow(added.row);
    if (options.idColumn) sheet.getCell(row, options.idColumn).value = added.id;
    for (const item of added.cells) {
      const cell = sheet.getCell(row, item.column);
      cell.value = item.text;
      mark(cell, 'orphan', `Riga aggiunta da Figma (${added.id}): non presente nell'Excel cliente`);
    }
  }
  workbook.description = GENERATED_MARKER;
  // Scrittura atomica: file temporaneo accanto alla destinazione e poi rename, così un errore a metà
  // non lascia una copia corrotta e l'originale non viene mai aperto in scrittura.
  const temporary = `${options.output}.tmp-${process.pid}`;
  try {
    await workbook.xlsx.writeFile(temporary);
    await rename(temporary, options.output);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { removedRows, copyNotes };
}
