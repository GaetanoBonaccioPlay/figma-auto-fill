import { Script, createContext } from 'node:vm';
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
    if (pattern.startsWith('re:')) return regexMatches(pattern, [layer.key, layer.text]);
    return pattern.trim().toLowerCase() === key || normalizeText(pattern) === text;
  });
}

// Un'espressione dei Livelli esclusi arriva da un profilo, anche importato da un collega: una regex catastrofica
// (es. ^(a+)+$) bloccherebbe il server. Si esegue in un contesto vm con un tempo massimo, che interrompe anche la regex.
const REGEX_TIMEOUT_MS = 100;
const regexContext = createContext({});
// Compilato una volta: il pattern arriva come dato (source), mai come codice.
const regexScript = new Script('(() => { const re = new RegExp(source, "i"); return inputs.some(input => re.test(input)); })()');
function regexMatches(pattern: string, inputs: string[]): boolean {
  regexContext.source = pattern.slice(3);
  regexContext.inputs = inputs;
  try {
    return regexScript.runInContext(regexContext, { timeout: REGEX_TIMEOUT_MS }) === true;
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error(`Il Livello escluso "${pattern}" è un'espressione regolare troppo lenta: toglila con exclude_layers (remove) e scrivila più semplice`);
    }
    // Un errore nato nel contesto vm non è un Error di questo contesto: si riporta come tale.
    throw new Error(`Livello escluso "${pattern}": ${(error as { message?: string }).message ?? String(error)}`);
  }
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
// Più righe con lo stesso testo sorgente e traduzioni in conflitto (es. la stessa CTA tradotta in modo diverso in due blocchi):
// non si sceglie in silenzio, decide il designer.
export type AmbiguousMatch = { layer: LayerRef; rows: number[] };

export type MatchResult = {
  exact: ExactMatch[];
  similar: SimilarMatch[];
  ambiguous: AmbiguousMatch[];
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

function translationsConflict(rows: ExcelRow[]): boolean {
  const languages = new Set(rows.flatMap(row => Object.keys(row.values)));
  return [...languages].some(language =>
    new Set(rows.map(row => normalizeText(row.values[language] ?? '')).filter(Boolean)).size > 1);
}

export const layerId =(layer: { frameId: string; key: string }): string => `${layer.frameId}\u0000${layer.key}`;

export function matchLayers(input: {
  layers: LayerRef[]; rows: ExcelRow[]; confirmed?: ConfirmedMatch[]; threshold?: number;
}): MatchResult {
  const threshold = input.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const layerTexts = new Map(input.layers.map(layer => [layerId(layer), normalizeText(layer.text)]));
  const rowTexts = new Map(input.rows.map(row => [row.row, normalizeText(row.source)]));
  const multiLevel = findMultiLevel(input.layers, input.rows, layerTexts);
  const multiRows = new Set(multiLevel.map(cell => cell.row));
  const candidates = input.rows.filter(row => rowTexts.get(row.row) && !multiRows.has(row.row));

  const byText = new Map<string, ExcelRow[]>();
  for (const row of candidates) {
    const text = rowTexts.get(row.row)!;
    byText.set(text, [...(byText.get(text) ?? []), row]);
  }
  // Righe con lo stesso testo: se le traduzioni non si contraddicono vale la più completa (a parità, la prima);
  // se in qualche lingua due righe hanno testi diversi, l'abbinamento è ambiguo.
  const firstByText = new Map<string, ExcelRow>();
  const conflicting = new Map<string, ExcelRow[]>();
  for (const [text, group] of byText) {
    if (group.length > 1 && translationsConflict(group)) { conflicting.set(text, group); continue; }
    const filled = (row: ExcelRow) => Object.values(row.values).filter(value => value.trim()).length;
    firstByText.set(text, group.reduce((best, row) => filled(row) > filled(best) ? row : best));
  }

  const result: MatchResult = { exact: [], similar: [], ambiguous: [], orphans: [], multiLevel, staleConfirmed: [], skippedEmpty: 0 };
  const stale = new Set<ConfirmedMatch>();
  const multiByLayer = new Map(multiLevel.flatMap(cell => cell.layers.map(layer => [layerId(layer), cell.row] as const)));

  for (const layer of input.layers) {
    const text = layerTexts.get(layerId(layer))!;
    if (!text) { result.skippedEmpty++; continue; }

    const exact = firstByText.get(text);
    if (exact) { result.exact.push({ layer, row: exact.row, via: 'text' }); continue; }

    // Un Abbinamento confermato risolve anche l'ambiguità, purché indichi la riga con il suo ID.
    const confirmed = (input.confirmed ?? []).find(item => item.source === text);
    if (confirmed) {
      const target = confirmed.rowId !== undefined
        ? candidates.find(row => row.id === confirmed.rowId)
        : firstByText.get(confirmed.rowSource);
      if (target) { result.exact.push({ layer, row: target.row, via: 'confirmed' }); continue; }
      if (!conflicting.has(confirmed.rowSource)) stale.add(confirmed);
    }

    const ambiguous = conflicting.get(text);
    if (ambiguous) { result.ambiguous.push({ layer, rows: ambiguous.map(row => row.row) }); continue; }

    let best: { row: ExcelRow; score: number } | null = null;
    for (const row of candidates) {
      const score = similarity(text, rowTexts.get(row.row)!);
      if (!best || score > best.score) best = { row, score };
    }
    // Simile a un testo che compare in più righe con traduzioni diverse: ambiguo anche lui, non si sceglie la prima.
    const similarGroup = best && best.score >= threshold ? conflicting.get(rowTexts.get(best.row.row)!) : undefined;
    if (similarGroup) {
      result.ambiguous.push({ layer, rows: similarGroup.map(row => row.row) });
    } else if (best && best.score >= threshold) {
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
