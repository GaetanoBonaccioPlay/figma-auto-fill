import {
  DEFAULT_NAMING, escapeMarkup, frameLabels, namingErrors, normalizeLanguage, outputName, outputGroupNames,
  parseMarkup, resolveValue, stripLanguageSuffix, uniqueKeys, validateRows,
  type FrameInfo, type MarkedSegment, type NameContext, type NamingOptions, type TranslationRow
} from './core';
import { DEFAULT_LANGUAGE_SETTINGS, readLanguageSettings, type LanguageSettings } from './language-catalog';
import type { AgentCommandMessage } from './agent-protocol';

type GenerateRequest = {
  kind: 'generate';
  frameIds: string[];
  rows: TranslationRow[];
  targets: string[];
  primary: string;
  baseNames: Record<string, string>;
  naming?: NamingOptions;
  sectionMode?: 'none' | 'locale' | 'base';
  collisionMode: 'replace' | 'version';
  confirmedReplacementIds: string[];
};
type InspectRequest = {
  kind: 'inspect'; frameIds: string[]; targets: string[]; primary: string;
  baseNames: Record<string, string>; naming?: NamingOptions;
};
type SaveLanguageSettingsRequest = { kind: 'save-language-settings'; settings: LanguageSettings };
type ReadLocalsRequest = { kind: 'read-locals'; frameIds: string[] };
type Replacement = { id: string; name: string; language: string; master: string; frameId: string; role: 'master' | 'locale' };
type PreparedUpdate = {
  text: string;
  baseFont: FontName;
  segments: Array<{ range: MarkedSegment; font: FontName }>;
};

figma.showUI(__html__, { width: 980, height: 780, themeColors: true });

const DATA = { role: 'autoFillRole', group: 'autoFillGroup', language: 'autoFillLanguage', primary: 'autoFillPrimary', source: 'autoFillSourceId', textSource: 'autoFillTextSourceId', sectionMode: 'autoFillSectionMode' } as const;
const LANGUAGE_SETTINGS_KEY = 'autoFillLanguageSettingsV1';
let settingsWrite = Promise.resolve();
let generationInProgress = false;
let selectionRevision = 0;

function managedRole(frame: FrameNode): 'master' | 'locale' | undefined {
  const role = frame.getPluginData(DATA.role);
  return role === 'master' || role === 'locale' ? role : undefined;
}

function groupId(frame: FrameNode): string {
  return frame.getPluginData(DATA.group);
}

function tagFrame(frame: FrameNode, role: 'master' | 'locale', group: string, language: string, primary: string, sourceId: string): void {
  frame.setPluginData(DATA.role, role);
  frame.setPluginData(DATA.group, group);
  frame.setPluginData(DATA.language, language);
  frame.setPluginData(DATA.primary, primary);
  frame.setPluginData(DATA.source, sourceId);
}

function textNodes(frame: FrameNode): TextNode[] {
  return frame.findAll(node => node.type === 'TEXT') as TextNode[];
}

function isShown(node: SceneNode, root: FrameNode): boolean {
  for (let current: BaseNode | null = node; current && current !== root; current = current.parent) {
    if ('visible' in current && current.visible === false) return false;
  }
  return true;
}

// Visible text layers with their row key; hidden layers (or layers inside a
// hidden parent) are left out of the translation sheet and never rewritten.
function keyedTextNodes(frame: FrameNode): { nodes: Array<{ node: TextNode; key: string }>; hidden: number; duplicates: Array<{ name: string; keys: string[] }> } {
  const all = textNodes(frame);
  const shown = all.filter(node => isShown(node, frame));
  const { keys, duplicates } = uniqueKeys(shown.map(node => node.name));
  return { nodes: shown.map((node, index) => ({ node, key: keys[index] })), hidden: all.length - shown.length, duplicates };
}

function tagTextSources(originals: TextNode[], copies: TextNode[], frameName: string): void {
  if (originals.length !== copies.length) throw new Error(`${frameName}: struttura del clone diversa dal modello`);
  originals.forEach((original, index) => {
    copies[index].setPluginData(DATA.textSource, original.getPluginData(DATA.textSource) || original.id);
    copies[index].autoRename = false;
  });
}

function styleFlags(segment: { fontName: FontName; fontWeight: number; textDecoration: TextDecoration }): { b: boolean; i: boolean; u: boolean; s: boolean } {
  return {
    b: segment.fontWeight >= 600 || /bold|heavy|black|demi/i.test(segment.fontName.style),
    i: /italic|oblique/i.test(segment.fontName.style),
    u: segment.textDecoration === 'UNDERLINE',
    s: segment.textDecoration === 'STRIKETHROUGH'
  };
}

function sourceMarkup(node: TextNode): string {
  if (!node.characters) return '';
  const styled = node.getStyledTextSegments(['fontName', 'fontWeight', 'textDecoration']);
  const allBold = styled.every(segment => styleFlags(segment).b);
  const allItalic = styled.every(segment => styleFlags(segment).i);
  let result = '';
  for (const segment of styled) {
    const flags = styleFlags(segment);
    const tags = [
      ...(flags.b && !allBold ? ['b'] : []),
      ...(flags.i && !allItalic ? ['i'] : []),
      ...(flags.u ? ['u'] : []),
      ...(flags.s ? ['s'] : [])
    ];
    result += tags.map(tag => `<${tag}>`).join('');
    result += escapeMarkup(segment.characters);
    result += tags.reverse().map(tag => `</${tag}>`).join('');
  }
  return result;
}

function selectedFrames(): FrameNode[] {
  const byId = new Map<string, FrameNode>();
  const collect = (node: SceneNode): void => {
    if (node.type === 'FRAME') {
      byId.set(node.id, node);
      return;
    }
    if (node.type === 'SECTION' || node.type === 'GROUP') {
      for (const child of node.children) collect(child);
    }
  };
  for (const node of figma.currentPage.selection) {
    if (node.type === 'FRAME' || node.type === 'SECTION') collect(node);
  }
  const frames = [...byId.values()];
  const path = (node: FrameNode): number[] => {
    const indices: number[] = [];
    let current: SceneNode = node;
    while (current.parent && 'children' in current.parent) {
      const parent = current.parent;
      indices.unshift(parent.children.findIndex(child => child.id === current.id));
      if (parent.type === 'PAGE') break;
      current = parent as SceneNode;
    }
    return indices;
  };
  const paths = new Map(frames.map(frame => [frame.id, path(frame)]));
  return frames.sort((a, b) => {
    const left = paths.get(a.id)!;
    const right = paths.get(b.id)!;
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
    return right.length - left.length;
  });
}

function selectionSnapshot(frames = selectedFrames()): FrameInfo[] {
  const labels = frameLabels(frames.map(frame => frame.name));
  return frames.map((frame, index) => {
    const keyed = keyedTextNodes(frame);
    return {
      id: frame.id,
      name: frame.name,
      label: labels[index],
      baseName: stripLanguageSuffix(frame.name),
      width: frame.width,
      height: frame.height,
      sourceLanguage: managedRole(frame) === 'master' ? frame.getPluginData(DATA.primary) || 'EN' : 'EN',
      managedRole: managedRole(frame),
      groupId: groupId(frame) || undefined,
      hiddenTextLayers: keyed.hidden,
      duplicateKeys: keyed.duplicates,
      textLayers: keyed.nodes.map(({ node, key }) => ({ id: node.id, key, text: node.characters, markup: sourceMarkup(node) }))
    };
  });
}

function translationsForGroup(reference: FrameNode, group: string, outputs: FrameNode[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  if (!group) return result;
  const referenceTexts = keyedTextNodes(reference).nodes;
  const referenceById = new Map(referenceTexts.map(({ node, key }) => [node.getPluginData(DATA.textSource) || node.id, key]));
  const referenceKeys = new Set(referenceTexts.map(({ key }) => key));
  const seenLanguages = new Set<string>();
  for (const output of outputs.filter(node => groupId(node) === group)) {
    const language = output.getPluginData(DATA.language);
    if (seenLanguages.has(language)) throw new Error(`${reference.name}: più export ${language} nello stesso gruppo`);
    seenLanguages.add(language);
    for (const [index, { node, key: ownKey }] of keyedTextNodes(output).nodes.entries()) {
      const sourceId = node.getPluginData(DATA.textSource);
      const key = referenceById.get(sourceId) ?? (referenceKeys.has(ownKey) ? ownKey : referenceTexts[index]?.key);
      if (!key) continue;
      result[key] ??= {};
      if (language in result[key]) throw new Error(`${output.name}: livelli di testo con Key duplicata`);
      result[key][language] = sourceMarkup(node);
    }
  }
  return result;
}

function versionNumber(name: string): number {
  const match = stripLanguageSuffix(name).match(/.*_v(\d+)(?!\d)/);
  return match ? Number(match[1]) : 1;
}

function exportSectionMode(master: FrameNode, outputs: FrameNode[]): 'none' | 'locale' | 'base' {
  const saved = master.getPluginData(DATA.sectionMode);
  if (saved === 'none' || saved === 'locale' || saved === 'base') return saved;
  if (master.parent?.type !== 'SECTION') return 'none';
  const variants = outputs.filter(node => groupId(node) === groupId(master) && node.getPluginData(DATA.language).includes('_'));
  return variants.some(node => node.parent === master.parent) ? 'base' : 'locale';
}

async function selectionSnapshotWithExports(frames: FrameNode[]): Promise<FrameInfo[]> {
  const snapshot = selectionSnapshot(frames);
  const page = exportPage();
  if (!page || !frames.length) return snapshot;
  await page.loadAsync();
  const outputs = exportFrames(page).filter(node => Boolean(managedRole(node)));
  const masters = outputs.filter(node => managedRole(node) === 'master');
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (managedRole(frame) === 'master') {
      snapshot[index].exportSectionMode = exportSectionMode(frame, outputs);
      snapshot[index].existingTranslations = translationsForGroup(frame, groupId(frame),
        outputs.filter(node => managedRole(node) === 'locale'));
      continue;
    }
    if (managedRole(frame)) continue;
    let candidates = masters.filter(node => node.getPluginData(DATA.source) === frame.id);
    if (!candidates.length) {
      const base = stripLanguageSuffix(frame.name);
      candidates = masters.filter(node => stripLanguageSuffix(node.name).replace(/_v\d+$/, '') === base);
    }
    const latest = candidates.map((node, order) => ({ node, order }))
      .sort((a, b) => versionNumber(b.node.name) - versionNumber(a.node.name) || b.order - a.order)[0]?.node;
    if (latest) {
      snapshot[index].exportSectionMode = exportSectionMode(latest, outputs);
      snapshot[index].existingTranslations = translationsForGroup(frame, groupId(latest), outputs);
    }
  }
  return snapshot;
}

async function sendSelection(): Promise<void> {
  if (generationInProgress) return;
  const revision = ++selectionRevision;
  try {
    const frames = await selectionSnapshotWithExports(selectedFrames());
    if (revision === selectionRevision && !generationInProgress) figma.ui.postMessage({ kind: 'selection', frames });
  } catch (error) {
    if (revision === selectionRevision && !generationInProgress) figma.ui.postMessage({ kind: 'error', message: (error as Error).message });
  }
}

figma.on('selectionchange', () => { void sendSelection(); });
void sendSelection();

function checkTextStyles(node: TextNode): FontName {
  if (node.hasMissingFont) throw new Error(`${node.name}: font mancante nel documento`);
  if (!node.characters) {
    if (node.fontName === figma.mixed) throw new Error(`${node.name}: impossibile determinare il font`);
    return node.fontName;
  }
  const segments = node.getStyledTextSegments(['fontName', 'fontWeight', 'textDecoration', 'fontSize', 'fills']);
  const first = segments[0];
  const fill = JSON.stringify(first.fills);
  for (const segment of segments) {
    if (segment.fontName.family !== first.fontName.family || segment.fontSize !== first.fontSize || JSON.stringify(segment.fills) !== fill) {
      throw new Error(`${node.name}: il livello usa differenze di famiglia, dimensione o colore non supportate`);
    }
  }
  const base = [...segments].sort((a, b) => {
    const aFlags = styleFlags(a);
    const bFlags = styleFlags(b);
    return Number(aFlags.b) + Number(aFlags.i) - Number(bFlags.b) - Number(bFlags.i);
  })[0];
  return base.fontName;
}

function fontTraits(font: FontName): { bold: boolean; italic: boolean } {
  return { bold: /bold|heavy|black|demi/i.test(font.style), italic: /italic|oblique/i.test(font.style) };
}

function fontForSegment(base: FontName, segment: MarkedSegment, available: FontName[]): FontName {
  const baseTraits = fontTraits(base);
  const bold = baseTraits.bold || segment.b;
  const italic = baseTraits.italic || segment.i;
  if (bold === baseTraits.bold && italic === baseTraits.italic) return base;
  const candidates = available.filter(font => font.family === base.family && fontTraits(font).bold === bold && fontTraits(font).italic === italic);
  if (!candidates.length) throw new Error(`Font ${base.family}: variante ${bold ? 'grassetto' : 'normale'}${italic ? ' corsivo' : ''} non disponibile`);
  const preferred = candidates.find(font => /^(bold italic|bold|italic|regular)$/i.test(font.style));
  return preferred ?? candidates[0];
}

async function prepareUpdate(node: TextNode, markup: string, available: FontName[], loaded: Set<string>): Promise<PreparedUpdate> {
  const baseFont = checkTextStyles(node);
  const parsed = parseMarkup(markup);
  const segments = parsed.segments.map(range => ({ range, font: fontForSegment(baseFont, range, available) }));
  // Figma requires every font already present in the text node to be loaded
  // before changing its characters, even if the replacement does not use it.
  const needed = [
    ...node.getStyledTextSegments(['fontName']).map(segment => segment.fontName),
    baseFont,
    ...segments.map(segment => segment.font)
  ];
  for (const font of needed) {
    const key = `${font.family}\u0000${font.style}`;
    if (loaded.has(key)) continue;
    try { await figma.loadFontAsync(font); }
    catch { throw new Error(`Font non disponibile: ${font.family} ${font.style}`); }
    loaded.add(key);
  }
  return { text: parsed.text, baseFont, segments };
}

function applyUpdate(node: TextNode, update: PreparedUpdate): void {
  node.characters = update.text;
  node.fontName = update.baseFont;
  node.textDecoration = 'NONE';
  for (const { range, font } of update.segments) {
    if (range.start === range.end) continue;
    if (font.family !== update.baseFont.family || font.style !== update.baseFont.style) node.setRangeFontName(range.start, range.end, font);
    if (range.u) node.setRangeTextDecoration(range.start, range.end, 'UNDERLINE');
    if (range.s) node.setRangeTextDecoration(range.start, range.end, 'STRIKETHROUGH');
  }
}

function selectedForRequest(frameIds: string[]): FrameNode[] {
  const frames = selectedFrames();
  const selectedIds = frames.map(frame => frame.id).sort().join('|');
  if (selectedIds !== [...frameIds].sort().join('|')) throw new Error('La selezione Figma è cambiata: ripeti l’anteprima prima di generare');
  if (!frames.length) throw new Error('Seleziona almeno un frame');
  if (frames.some(frame => managedRole(frame) === 'locale')) throw new Error('Per rieditare seleziona il frame MASTER in EXPORT');
  return frames;
}

function exportPage(): PageNode | null {
  const pages = figma.root.children.filter(page => page.name === 'EXPORT');
  if (pages.length > 1) throw new Error('Esistono più pagine chiamate EXPORT: rinominale prima di continuare');
  return pages[0] ?? null;
}

function exportFrames(page: PageNode): FrameNode[] {
  const result: FrameNode[] = [];
  const visit = (parent: PageNode | SectionNode): void => {
    for (const child of parent.children) {
      if (child.type === 'FRAME') result.push(child);
      if (child.type === 'SECTION') visit(child);
    }
  };
  visit(page);
  return result;
}

function exportParentPage(node: SceneNode): PageNode | null {
  let parent = node.parent;
  while (parent && parent.type !== 'PAGE') parent = parent.parent;
  return parent?.type === 'PAGE' ? parent : null;
}

function sectionKey(language: string, mode: 'locale' | 'base'): string {
  return (mode === 'base' ? language.split('_')[0] : language).toLowerCase();
}

type LayerContainer = PageNode | SectionNode;
type LayerOrderSnapshot = { container: LayerContainer; children: SceneNode[] };

function orderCanvasLayers(container: LayerContainer, type: 'FRAME' | 'SECTION', snapshots: LayerOrderSnapshot[]): void {
  const original = [...container.children];
  const backToFront = original.map((node, index) => ({ node, index }))
    .filter(item => item.node.type === type)
    .sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x || b.index - a.index)
    .map(item => item.node)
    .reverse();
  let next = 0;
  const desired = original.map(node => node.type === type ? backToFront[next++] : node);
  if (desired.every((node, index) => node.id === original[index].id)) return;
  snapshots.push({ container, children: original });
  desired.forEach((node, index) => {
    if (container.children[index].id !== node.id) container.insertChild(index, node);
  });
}

function nameContexts(frames: FrameNode[], baseNames: Record<string, string>): Map<string, NameContext> {
  return new Map(frames.map((frame, index) => [frame.id, {
    name: baseNames[frame.id] ?? stripLanguageSuffix(frame.name),
    index, count: frames.length, width: frame.width, height: frame.height
  }]));
}

async function replacementsFor(
  frames: FrameNode[], targets: string[], primary: string,
  baseNames: Record<string, string>, naming: NamingOptions
): Promise<Replacement[]> {
  const contexts = nameContexts(frames, baseNames);
  const masters = frames.filter(frame => managedRole(frame) === 'master');
  for (const master of masters) {
    if (exportParentPage(master)?.name !== 'EXPORT') throw new Error(`${master.name}: MASTER non si trova in EXPORT`);
    if (master.getPluginData(DATA.primary) !== primary) throw new Error(`${master.name}: la lingua principale del MASTER è ${master.getPluginData(DATA.primary)}`);
  }
  const page = exportPage();
  if (!page) return [];
  await page.loadAsync();
  const candidates: Replacement[] = [];
  for (const frame of frames) {
    for (const language of targets) {
      if (managedRole(frame) === 'master' && language === primary) continue;
      const desiredName = outputName(contexts.get(frame.id)!, language, naming, new Set());
      const old = exportFrames(page).find(node => {
        if (!managedRole(node) || node.getPluginData(DATA.language) !== language) return false;
        if (managedRole(frame) === 'master') return managedRole(node) === 'locale' && groupId(node) === groupId(frame);
        if (managedRole(node) !== (language === primary ? 'master' : 'locale')) return false;
        return node.name === desiredName;
      });
      if (old) candidates.push({
        id: old.id, name: old.name, language, master: frame.name, frameId: frame.id,
        role: managedRole(old)!
      });
    }
  }
  if (new Set(candidates.map(item => item.id)).size !== candidates.length) {
    throw new Error('Più frame selezionati corrispondono allo stesso export: usa nomi base diversi');
  }
  return candidates;
}

async function generate(request: GenerateRequest): Promise<{ names: string[]; warnings: string[] }> {
  const frames = selectedForRequest(request.frameIds);
  const primary = normalizeLanguage(request.primary);
  const targets = [...new Set([primary, ...request.targets.map(normalizeLanguage)])];
  if (request.collisionMode !== 'replace' && request.collisionMode !== 'version') throw new Error('Scegli se sostituire l’export o creare una nuova versione');
  const sectionMode = request.sectionMode ?? 'none';
  if (!['none', 'locale', 'base'].includes(sectionMode)) throw new Error('Modalità section non valida');
  const naming = request.naming ?? DEFAULT_NAMING;
  const contexts = nameContexts(frames, request.baseNames);
  const nameLabels = frameLabels(frames.map(frame => frame.name));
  const nameProblems = namingErrors(frames.map((frame, index) => ({ ...contexts.get(frame.id)!, label: nameLabels[index] })), targets, naming);
  if (nameProblems.length) throw new Error(nameProblems.join('\n'));
  const candidates = await replacementsFor(frames, targets, primary, request.baseNames, naming);
  const replacements = request.collisionMode === 'replace' ? candidates : [];
  if (replacements.map(item => item.id).sort().join('|') !== [...request.confirmedReplacementIds].sort().join('|')) {
    throw new Error('I frame da sostituire sono cambiati: verifica di nuovo la lista');
  }
  const replaceByFrameLanguage = new Map(replacements.map(item => [`${item.frameId}\u0000${item.language}`, item]));
  const snapshot = selectionSnapshot();
  const errors = validateRows(request.rows, snapshot, targets, primary);
  if (errors.length) throw new Error(errors.join('\n'));
  const labels = new Map(snapshot.map(frame => [frame.id, frame.label ?? frame.name]));

  const activeRows = request.rows.filter(row => row.translate);
  const available = (await figma.listAvailableFontsAsync()).map(font => font.fontName);
  const loaded = new Set<string>();
  const updates = new Map<string, Map<string, Map<string, PreparedUpdate>>>();
  const keysByNodeId = new Map<string, Map<string, string>>();
  const updateFor = (frame: FrameNode, language: string, original: TextNode): PreparedUpdate | undefined => {
    const key = keysByNodeId.get(frame.id)!.get(original.id);
    return key === undefined ? undefined : updates.get(frame.id)!.get(language)!.get(key);
  };
  const warnings: string[] = [];
  for (const frame of frames) {
    const keyed = keyedTextNodes(frame);
    const label = labels.get(frame.id)!;
    for (const { name, keys } of keyed.duplicates) warnings.push(`${label}: Key "${name}" duplicata, rinominata in ${keys.join(', ')}`);
    keysByNodeId.set(frame.id, new Map(keyed.nodes.map(({ node, key }) => [node.id, key])));
    const nodeByKey = new Map(keyed.nodes.map(({ node, key }) => [key, node]));
    const perLanguage = new Map<string, Map<string, PreparedUpdate>>();
    for (const language of targets) {
      const byKey = new Map<string, PreparedUpdate>();
      for (const row of activeRows.filter(row => row.frame === label)) {
        const node = nodeByKey.get(row.key)!;
        const resolved = resolveValue(row, language, primary);
        if (resolved.fallback) warnings.push(`${label} / ${row.key} / ${language}: usato ${resolved.sourceLanguage}`);
        const update = await prepareUpdate(node, resolved.markup, available, loaded);
        if (node.textAutoResize === 'NONE' && update.text.length > node.characters.length * 1.2 + 4) {
          warnings.push(`${label} / ${row.key} / ${language}: verifica possibile overflow`);
        }
        byKey.set(row.key, update);
      }
      perLanguage.set(language, byKey);
    }
    updates.set(frame.id, perLanguage);
  }

  let page = exportPage();
  const originalPage = figma.currentPage;
  let newPage = false;
  if (!page) {
    try { page = figma.createPage(); page.name = 'EXPORT'; newPage = true; }
    catch { throw new Error('Impossibile creare EXPORT: controlla il limite di pagine del file Figma'); }
  }
  const created: FrameNode[] = [];
  const createdSections: SectionNode[] = [];
  const resizedSections: Array<{ section: SectionNode; width: number; height: number }> = [];
  const positionedSections: Array<{ section: SectionNode; x: number }> = [];
  const movedMasters: Array<{ frame: FrameNode; parent: BaseNode & ChildrenMixin; x: number; y: number }> = [];
  const reorderedLayers: LayerOrderSnapshot[] = [];
  try {
    await page.loadAsync();
    const occupied = new Set([...page.children.map(node => node.name), ...exportFrames(page).map(node => node.name)]);
    const gap = 80;
    const columnWidth = Math.max(
      ...frames.map(frame => frame.width),
      ...exportFrames(page).filter(node => Boolean(managedRole(node))).map(node => node.width)
    );
    if (sectionMode !== 'none') {
      const padding = 56;
      const allExportFrames = exportFrames(page);
      const byId = new Map(allExportFrames.map(node => [node.id, node]));
      const sectionByKey = new Map<string, SectionNode>();
      const laneByLanguage = new Map<string, number>();
      let nextSectionX = page.children.length ? Math.max(...page.children.map(node => node.x + node.width)) + gap : 0;
      for (const language of targets) {
        const key = sectionKey(language, sectionMode);
        let section = sectionByKey.get(key);
        if (!section) {
          section = page.children.find((node): node is SectionNode => node.type === 'SECTION' && node.name === `${key}/`);
          if (!section) {
            section = figma.createSection();
            createdSections.push(section);
            page.appendChild(section);
            section.name = `${key}/`;
            section.x = nextSectionX;
            section.y = 0;
            section.resize(columnWidth + padding * 2, padding * 2 + Math.max(...frames.map(frame => frame.height)));
            nextSectionX += section.width + gap;
          } else {
            resizedSections.push({ section, width: section.width, height: section.height });
          }
          sectionByKey.set(key, section);
        }
        const oldLane = section.children.find((node): node is FrameNode =>
          node.type === 'FRAME' && managedRole(node) !== undefined && node.getPluginData(DATA.language) === language);
        const used = [...laneByLanguage].filter(([code]) => sectionKey(code, sectionMode) === key).map(([, x]) => x + columnWidth + gap);
        const existing = oldLane ? [] : section.children.filter(node => node.type === 'FRAME').map(node => node.x + node.width + gap);
        laneByLanguage.set(language, Math.max(padding, oldLane?.x ?? padding, ...used, ...existing));
      }
      const targetSections = [...new Set(sectionByKey.values())];
      let nextRowY = Math.max(padding, ...targetSections.flatMap(section => section.children.map(node => node.y + node.height + gap)));
      const selectedMasters: FrameNode[] = [];
      for (const frame of frames) {
        const existingMaster = managedRole(frame) === 'master' && request.collisionMode === 'replace';
        const context = contexts.get(frame.id)!;
        const groupNames = request.collisionMode === 'version' ? outputGroupNames(context, targets, naming, occupied) : null;
        const masterSection = sectionByKey.get(sectionKey(primary, sectionMode))!;
        const oldMaster = replaceByFrameLanguage.get(`${frame.id}\u0000${primary}`);
        const oldMasterNode = oldMaster ? byId.get(oldMaster.id) : undefined;
        const rowY = existingMaster && frame.parent === masterSection ? frame.y
          : oldMasterNode?.parent === masterSection ? oldMasterNode.y : nextRowY;
        let master = frame;
        if (existingMaster && frame.parent !== masterSection) {
          if (!frame.parent || !('appendChild' in frame.parent)) throw new Error(`${frame.name}: parent del MASTER non valido`);
          movedMasters.push({ frame, parent: frame.parent, x: frame.x, y: frame.y });
          masterSection.appendChild(frame);
          frame.x = laneByLanguage.get(primary)!;
          frame.y = rowY;
        }
        if (!existingMaster) {
          master = frame.clone();
          created.push(master);
          masterSection.appendChild(master);
          master.name = oldMaster?.name ?? groupNames?.get(primary) ?? outputName(context, primary, naming, occupied);
          master.x = laneByLanguage.get(primary)!;
          master.y = rowY;
          const copiedTexts = textNodes(master);
          const originals = textNodes(frame);
          tagTextSources(originals, copiedTexts, frame.name);
          originals.forEach((original, index) => {
            const update = updateFor(frame, primary, original);
            if (update) applyUpdate(copiedTexts[index], update);
          });
          tagFrame(master, 'master', oldMasterNode ? groupId(oldMasterNode) || master.id : master.id,
            primary, primary, frame.getPluginData(DATA.source) || frame.id);
        }
        selectedMasters.push(master);
        for (const language of targets.filter(code => code !== primary)) {
          const section = sectionByKey.get(sectionKey(language, sectionMode))!;
          const oldCandidate = replaceByFrameLanguage.get(`${frame.id}\u0000${language}`);
          const old = oldCandidate ? byId.get(oldCandidate.id) : undefined;
          const clone = master.clone();
          created.push(clone);
          section.appendChild(clone);
          clone.name = old?.name ?? groupNames?.get(language) ?? outputName(context, language, naming, occupied);
          clone.x = laneByLanguage.get(language)!;
          clone.y = old?.parent === section ? old.y : rowY;
          tagFrame(clone, 'locale', groupId(master), language, primary, master.getPluginData(DATA.source));
          const copiedTexts = textNodes(clone);
          const originals = textNodes(frame);
          tagTextSources(originals, copiedTexts, frame.name);
          originals.forEach((original, index) => {
            const update = updateFor(frame, language, original);
            if (update) applyUpdate(copiedTexts[index], update);
          });
        }
        if (rowY === nextRowY) nextRowY += Math.max(frame.height, master.height) + gap;
      }
      for (const section of targetSections) {
        const children = section.children.filter(node => node.type === 'FRAME');
        section.resize(
          Math.max(section.width, padding, ...children.map(node => node.x + node.width + padding)),
          Math.max(section.height, padding, ...children.map(node => node.y + node.height + padding))
        );
      }
      let sectionX = Math.max(0, ...page.children.filter(node => !targetSections.includes(node as SectionNode)).map(node => node.x + node.width + gap));
      for (const section of targetSections) {
        if (!createdSections.includes(section)) positionedSections.push({ section, x: section.x });
        section.x = sectionX;
        sectionX += section.width + gap;
      }
      for (const section of targetSections) orderCanvasLayers(section, 'FRAME', reorderedLayers);
      orderCanvasLayers(page, 'SECTION', reorderedLayers);
      await figma.setCurrentPageAsync(page);
      page.selection = selectedMasters;
      figma.viewport.scrollAndZoomIntoView(selectedMasters);
      for (const old of replacements) byId.get(old.id)?.remove();
      for (const master of selectedMasters) master.setPluginData(DATA.sectionMode, sectionMode);
      return { names: created.map(node => node.name), warnings };
    }
    const columnX = new Map(targets.map((language, index) => [language, index * (columnWidth + gap)]));
    let nextY = page.children.length ? Math.max(...page.children.map(node => node.y + node.height)) + gap : 0;
    const selectedMasters: FrameNode[] = [];
    for (const frame of frames) {
      const existingMaster = managedRole(frame) === 'master' && request.collisionMode === 'replace';
      const context = contexts.get(frame.id)!;
      const groupNames = request.collisionMode === 'version' ? outputGroupNames(context, targets, naming, occupied) : null;
      const oldMaster = replaceByFrameLanguage.get(`${frame.id}\u0000${primary}`);
      const oldMasterNode = oldMaster ? exportFrames(page).find(node => node.id === oldMaster.id) : undefined;
      const rowY = existingMaster ? frame.y : oldMasterNode?.parent === page ? oldMasterNode.y : nextY;
      let master = frame;
      if (!existingMaster) {
        master = frame.clone();
        created.push(master);
        page.appendChild(master);
        master.name = oldMaster?.name ?? groupNames?.get(primary) ?? outputName(context, primary, naming, occupied);
        master.x = 0;
        master.y = rowY;
        const copiedTexts = textNodes(master);
        const originals = textNodes(frame);
        tagTextSources(originals, copiedTexts, frame.name);
        originals.forEach((original, index) => {
          const update = updateFor(frame, primary, original);
          if (update) applyUpdate(copiedTexts[index], update);
        });
        tagFrame(master, 'master', oldMasterNode ? groupId(oldMasterNode) || master.id : master.id,
          primary, primary, frame.getPluginData(DATA.source) || frame.id);
      }
      selectedMasters.push(master);
      const group = groupId(master);
      for (const language of targets.filter(code => code !== primary)) {
        const oldCandidate = replaceByFrameLanguage.get(`${frame.id}\u0000${language}`);
        const old = oldCandidate ? exportFrames(page).find(node => node.id === oldCandidate.id) : undefined;
        const clone = master.clone();
        created.push(clone);
        page.appendChild(clone);
        clone.name = old?.name ?? groupNames?.get(language) ?? outputName(context, language, naming, occupied);
        clone.x = master.x + columnX.get(language)!;
        clone.y = master.y;
        tagFrame(clone, 'locale', group, language, primary, master.getPluginData(DATA.source));
        const copiedTexts = textNodes(clone);
        const originals = textNodes(frame);
        tagTextSources(originals, copiedTexts, frame.name);
        originals.forEach((original, index) => {
          const update = updateFor(frame, language, original);
          if (update) applyUpdate(copiedTexts[index], update);
        });
      }
      if (!existingMaster && !oldMasterNode) nextY += master.height + gap;
    }
    orderCanvasLayers(page, 'FRAME', reorderedLayers);
    await figma.setCurrentPageAsync(page);
    page.selection = selectedMasters;
    figma.viewport.scrollAndZoomIntoView(selectedMasters);
    for (const old of replacements) {
      const node = exportFrames(page).find(child => child.id === old.id);
      if (node) node.remove();
    }
    for (const master of selectedMasters) master.setPluginData(DATA.sectionMode, sectionMode);
    return { names: created.map(node => node.name), warnings };
  } catch (error) {
    for (const node of created) if (!node.removed) node.remove();
    for (const { frame, parent, x, y } of movedMasters.reverse()) {
      if (!frame.removed) { parent.appendChild(frame); frame.x = x; frame.y = y; }
    }
    for (const node of createdSections) if (!node.removed) node.remove();
    for (const { section, x } of positionedSections) if (!section.removed) section.x = x;
    for (const { section, width, height } of resizedSections) if (!section.removed) section.resize(width, height);
    for (const { container, children } of reorderedLayers.reverse()) {
      if (container.removed) continue;
      children.filter(node => !node.removed && node.parent === container)
        .forEach((node, index) => container.insertChild(index, node));
    }
    if (newPage && figma.currentPage === page) await figma.setCurrentPageAsync(originalPage);
    if (newPage && !page.removed) page.remove();
    throw error;
  }
}

async function planFor(message: InspectRequest): Promise<{ replacements: Replacement[]; selections: Array<{ frame: string; language: string; action: 'master' | 'replace' | 'create' }> }> {
  const frames = selectedForRequest(message.frameIds);
  const primary = normalizeLanguage(message.primary);
  const targets = [...new Set([primary, ...message.targets.map(normalizeLanguage)])];
  const replacements = await replacementsFor(frames, targets, primary, message.baseNames, message.naming ?? DEFAULT_NAMING);
  const selections = frames.flatMap(frame => targets.map(language => ({
    frame: frame.name,
    language,
    action: (managedRole(frame) === 'master' && language === primary ? 'master' : replacements.some(item => item.frameId === frame.id && item.language === language) ? 'replace' : 'create') as 'master' | 'replace' | 'create'
  })));
  return { replacements, selections };
}

// Dopo una generazione Figma seleziona i MASTER: per ripetere plan/generate sugli stessi frame sorgente
// (per esempio dopo le Traduzioni AI) l'agente indica gli id e il plugin ripristina la selezione.
async function ensureSelection(frameIds: string[]): Promise<void> {
  if (selectedFrames().map(frame => frame.id).sort().join('|') === [...frameIds].sort().join('|')) return;
  const frames: FrameNode[] = [];
  for (const id of frameIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type !== 'FRAME' || node.removed) throw new Error('Un frame selezionato non esiste più: seleziona di nuovo i frame in Figma e ripeti l’abbinamento');
    frames.push(node);
  }
  const pages = new Set(frames.map(frame => exportParentPage(frame)));
  const page = [...pages][0];
  if (pages.size !== 1 || !page) throw new Error('I frame selezionati si trovano su pagine diverse');
  await figma.setCurrentPageAsync(page);
  page.selection = frames;
}

// Comandi inviati dal server MCP tramite il bridge: riusano gli stessi flussi della UI.
async function runAgentCommand(message: AgentCommandMessage): Promise<unknown> {
  if (message.command === 'snapshot') {
    const ids = (message.payload as { frameIds?: string[] } | undefined)?.frameIds;
    let frames: FrameNode[];
    if (ids) {
      frames = [];
      for (const id of ids) {
        const node = await figma.getNodeByIdAsync(id);
        if (node && node.type === 'FRAME') frames.push(node);
      }
    } else {
      frames = selectedFrames();
    }
    return { frames: await selectionSnapshotWithExports(frames) };
  }
  if (message.command === 'plan' || message.command === 'generate') {
    await ensureSelection((message.payload as { frameIds: string[] }).frameIds);
  }
  if (message.command === 'plan') return planFor(message.payload as InspectRequest);
  if (message.command === 'generate') {
    generationInProgress = true;
    try { return await generate(message.payload as GenerateRequest); }
    finally { generationInProgress = false; await sendSelection(); }
  }
  throw new Error(`Comando sconosciuto: ${String(message.command)}`);
}

figma.ui.onmessage = async (message: GenerateRequest | InspectRequest | SaveLanguageSettingsRequest | ReadLocalsRequest | AgentCommandMessage | { kind: 'ready' }) => {
  if (message.kind === 'ready') {
    let settings: unknown = DEFAULT_LANGUAGE_SETTINGS;
    try { settings = await figma.clientStorage.getAsync(LANGUAGE_SETTINGS_KEY); }
    catch { /* A fresh configuration is still usable if local storage is unavailable. */ }
    figma.ui.postMessage({ kind: 'language-settings', settings: readLanguageSettings(settings) });
    await sendSelection();
    return;
  }
  if (message.kind === 'agent-command') {
    try {
      figma.ui.postMessage({ kind: 'agent-result', id: message.id, ok: true, data: await runAgentCommand(message) });
    } catch (error) {
      figma.ui.postMessage({ kind: 'agent-result', id: message.id, ok: false, error: (error as Error).message });
    }
    return;
  }
  try {
    if (message.kind === 'save-language-settings') {
      const settings = readLanguageSettings(message.settings);
      settingsWrite = settingsWrite.catch(() => {}).then(() => figma.clientStorage.setAsync(LANGUAGE_SETTINGS_KEY, settings));
      await settingsWrite;
    } else if (message.kind === 'read-locals') {
      const frames = selectedForRequest(message.frameIds);
      const snapshot = await selectionSnapshotWithExports(frames);
      selectedForRequest(message.frameIds);
      figma.ui.postMessage({ kind: 'locals-source', frames: snapshot });
    } else if (message.kind === 'inspect') {
      figma.ui.postMessage({ kind: 'generation-plan', ...await planFor(message) });
    } else if (message.kind === 'generate') {
      generationInProgress = true;
      let result: { names: string[]; warnings: string[] };
      try { result = await generate(message); }
      finally { generationInProgress = false; await sendSelection(); }
      figma.ui.postMessage({ kind: 'done', ...result });
    }
  } catch (error) {
    figma.ui.postMessage({ kind: 'error', message: (error as Error).message });
  }
};
