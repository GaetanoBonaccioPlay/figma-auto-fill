import type { ConfirmedMatch } from '../src/profiles';

export type LayerRef = { frameId: string; frame: string; key: string; text: string };
export type ExcelRow = { row: number; id?: string; source: string; values: Record<string, string> };

export const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

// Un livello è ignorato se una voce coincide con il suo nome o con il suo testo (normalizzato),
// oppure, con prefisso "re:", se l'espressione regolare ne riconosce nome o testo.
export function isIgnoredLayer(layer: { key: string; text: string }, patterns: string[]): boolean {
  const key = layer.key.trim().toLowerCase();
  const text = normalizeText(layer.text);
  return patterns.some(pattern => {
    if (pattern.startsWith('re:')) {
      const expression = new RegExp(pattern.slice(3), 'i');
      return expression.test(layer.key) || expression.test(layer.text);
    }
    return pattern.trim().toLowerCase() === key || normalizeText(pattern) === text;
  });
}

const TAGS = /<\/?[biusBIUS]>/g;

// Chiave di confronto: senza tag di formattazione, spazi multipli, maiuscole e punteggiatura finale.
export function normalizeText(text: string): string {
  return text
    .replace(TAGS, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s.!?:;,…]+$/u, '');
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

export type ExactMatch = { layer: LayerRef; row: number; via: 'text' | 'confirmed' };
export type SimilarMatch = { layer: LayerRef; row: number; score: number; rowText: string };
export type MultiLevelCell = { row: number; text: string; layers: LayerRef[] };
export type Orphan = { layer: LayerRef; reason: 'no-match' | 'multi-level'; row?: number };

export type MatchResult = {
  exact: ExactMatch[];
  similar: SimilarMatch[];
  orphans: Orphan[];
  multiLevel: MultiLevelCell[];
  staleConfirmed: ConfirmedMatch[];
  skippedEmpty: number;
};

// Una cella con più righe che coincidono con almeno due livelli dello stesso frame
// non è abbinabile in automatico: la sistema il designer.
function findMultiLevel(layers: LayerRef[], rows: ExcelRow[], layerTexts: Map<string, string>): MultiLevelCell[] {
  const fullTexts = new Set(layerTexts.values());
  const cells: MultiLevelCell[] = [];
  for (const row of rows) {
    if (!/\r?\n/.test(row.source) || fullTexts.has(normalizeText(row.source))) continue;
    const parts = new Set(row.source.split(/\r?\n+/).map(normalizeText).filter(Boolean));
    if (parts.size < 2) continue;
    const byFrame = new Map<string, LayerRef[]>();
    for (const layer of layers) {
      if (parts.has(layerTexts.get(layerId(layer))!)) byFrame.set(layer.frameId, [...(byFrame.get(layer.frameId) ?? []), layer]);
    }
    const involved = [...byFrame.values()].filter(group => new Set(group.map(layer => layerTexts.get(layerId(layer)))).size >= 2).flat();
    if (involved.length) cells.push({ row: row.row, text: row.source, layers: involved });
  }
  return cells;
}

export const layerId = (layer: { frameId: string; key: string }): string => `${layer.frameId}\u0000${layer.key}`;

export function matchLayers(input: {
  layers: LayerRef[]; rows: ExcelRow[]; confirmed?: ConfirmedMatch[]; threshold?: number;
}): MatchResult {
  const threshold = input.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const layerTexts = new Map(input.layers.map(layer => [layerId(layer), normalizeText(layer.text)]));
  const rowTexts = new Map(input.rows.map(row => [row.row, normalizeText(row.source)]));
  const multiLevel = findMultiLevel(input.layers, input.rows, layerTexts);
  const multiRows = new Set(multiLevel.map(cell => cell.row));
  const candidates = input.rows.filter(row => rowTexts.get(row.row) && !multiRows.has(row.row));

  const firstByText = new Map<string, ExcelRow>();
  for (const row of candidates) if (!firstByText.has(rowTexts.get(row.row)!)) firstByText.set(rowTexts.get(row.row)!, row);

  const result: MatchResult = { exact: [], similar: [], orphans: [], multiLevel, staleConfirmed: [], skippedEmpty: 0 };
  const stale = new Set<ConfirmedMatch>();
  const multiByLayer = new Map(multiLevel.flatMap(cell => cell.layers.map(layer => [layerId(layer), cell.row] as const)));

  for (const layer of input.layers) {
    const text = layerTexts.get(layerId(layer))!;
    if (!text) { result.skippedEmpty++; continue; }

    const exact = firstByText.get(text);
    if (exact) { result.exact.push({ layer, row: exact.row, via: 'text' }); continue; }

    const confirmed = (input.confirmed ?? []).find(item => item.source === text);
    if (confirmed) {
      const target = confirmed.rowId !== undefined
        ? candidates.find(row => row.id === confirmed.rowId)
        : firstByText.get(confirmed.rowSource);
      if (target) { result.exact.push({ layer, row: target.row, via: 'confirmed' }); continue; }
      stale.add(confirmed);
    }

    let best: { row: ExcelRow; score: number } | null = null;
    for (const row of candidates) {
      const score = similarity(text, rowTexts.get(row.row)!);
      if (!best || score > best.score) best = { row, score };
    }
    if (best && best.score >= threshold) {
      result.similar.push({ layer, row: best.row.row, score: Math.round(best.score * 100) / 100, rowText: best.row.source });
    } else if (multiByLayer.has(layerId(layer))) {
      result.orphans.push({ layer, reason: 'multi-level', row: multiByLayer.get(layerId(layer)) });
    } else {
      result.orphans.push({ layer, reason: 'no-match' });
    }
  }
  result.staleConfirmed = [...stale];
  return result;
}
