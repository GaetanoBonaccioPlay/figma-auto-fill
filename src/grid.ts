import type { TranslationRow } from './core';

export type GridPoint = { row: number; col: number };
export type GridRange = { top: number; bottom: number; left: number; right: number };

export function gridRange(anchor: GridPoint, focus: GridPoint): GridRange {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col)
  };
}

export function toTsv(cells: string[][]): string {
  return cells.map(row => row.map(value => /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join('\t')).join('\r\n');
}

export function fromTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let endedWithNewline = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
      endedWithNewline = false;
      continue;
    }
    if (char === '"' && value === '') { quoted = true; endedWithNewline = false; continue; }
    if (char === '\t') { row.push(value); value = ''; endedWithNewline = false; continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      endedWithNewline = true;
      continue;
    }
    value += char;
    endedWithNewline = false;
  }
  if (!endedWithNewline || row.length) rows.push([...row, value]);
  return rows.length ? rows : [['']];
}

export function pasteGrid(
  rows: TranslationRow[], languages: string[], range: GridRange, cells: string[][],
  readOnly: (row: TranslationRow, language: string) => boolean
): { written: number; skipped: number; outside: number; end: GridPoint } {
  const fillRange = cells.length === 1 && cells[0].length === 1 && (range.bottom > range.top || range.right > range.left);
  const height = fillRange ? range.bottom - range.top + 1 : cells.length;
  const width = fillRange ? range.right - range.left + 1 : Math.max(...cells.map(row => row.length));
  let written = 0;
  let skipped = 0;
  let outside = 0;
  for (let rowOffset = 0; rowOffset < height; rowOffset++) {
    for (let colOffset = 0; colOffset < width; colOffset++) {
      const value = fillRange ? cells[0][0] : cells[rowOffset]?.[colOffset];
      if (value === undefined) continue;
      const targetRow = rows[range.top + rowOffset];
      const language = languages[range.left + colOffset];
      if (!targetRow || !language) { outside++; continue; }
      if (readOnly(targetRow, language)) { skipped++; continue; }
      targetRow.values[language] = value;
      written++;
    }
  }
  return {
    written, skipped, outside,
    end: { row: Math.min(range.top + height - 1, rows.length - 1), col: Math.min(range.left + width - 1, languages.length - 1) }
  };
}
