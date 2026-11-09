import {
  DEFAULT_NAME_TEMPLATE, NAME_TOKENS, frameLabel, namingErrors, normalizeLanguage, parseMarkup, renderOutputName, validateRows,
  resolveValue, orderRowsByFrames, rowsFromFrames, type FrameInfo, type NameContext, type NamingOptions, type TranslationRow
} from './core';
import { DEFAULT_LANGUAGE_CODES, DEFAULT_LANGUAGE_SETTINGS, LANGUAGE_GROUPS, moveColumn, orderColumns, readLanguageSettings } from './language-catalog';
import { readWorkbook, writeWorkbook } from './workbook';
import { fromTsv, toTsv, gridRange, pasteGrid, type GridPoint } from './grid';
import { richClipboardCells, richClipboardText } from './rich-text';
import { startAgentBridge } from './agent-bridge';
import { ProfilesController, prefillFrom, type ImportChoice, type Prefill } from './profiles-ui';
import type { ImportResult, ProfilesState, SectionMode } from './profiles';

type SelectionMessage = { kind: 'selection'; frames: FrameInfo[] };
type LocalsSourceMessage = { kind: 'locals-source'; frames: FrameInfo[] };
type DoneMessage = { kind: 'done'; names: string[]; warnings: string[] };
type ErrorMessage = { kind: 'error'; message: string };
type Replacement = { id: string; name: string; language: string; master: string };
type PlanMessage = { kind: 'generation-plan'; replacements: Replacement[]; selections: Array<{ frame: string; language: string; action: 'master' | 'replace' | 'create' }> };
type SettingsMessage = { kind: 'language-settings'; settings: unknown };
type PluginMessage = SelectionMessage | LocalsSourceMessage | DoneMessage | ErrorMessage | PlanMessage | SettingsMessage;
type GenerateRequest = {
  kind: 'generate'; frameIds: string[]; rows: TranslationRow[]; targets: string[];
  primary: string; baseNames: Record<string, string>; naming: NamingOptions;
  collisionMode: 'replace' | 'version'; confirmedReplacementIds: string[];
  sectionMode: 'none' | 'locale' | 'base';
};

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const state = {
  frames: [] as FrameInfo[],
  rows: [] as TranslationRow[],
  languages: [...DEFAULT_LANGUAGE_CODES],
  columnOrder: [] as string[],
  nameTemplate: DEFAULT_NAME_TEMPLATE,
  numberStart: 1,
  targets: new Set(['EN']),
  primary: 'EN',
  settingsLoaded: false,
  openGroup: null as string | null,
  baseNames: new Map<string, string>(),
  sourceLanguages: new Map<string, string>(),
  importedName: '',
  busy: false,
  pendingRequest: null as GenerateRequest | null,
  pendingLocalsFrameIds: null as string[] | null,
  gridSelection: null as { anchor: GridPoint; focus: GridPoint } | null,
  draggingGrid: false
};

const today = new Date();
const TODAY = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

function naming(): NamingOptions {
  return { template: state.nameTemplate, start: state.numberStart, date: TODAY };
}

function nameContext(frame: FrameInfo, index: number): NameContext {
  return {
    name: state.baseNames.get(frame.id) ?? frame.baseName,
    index, count: state.frames.length, width: frame.width ?? 0, height: frame.height ?? 0
  };
}

function outputLanguages(): string[] {
  return [...new Set([state.primary, ...state.targets])];
}

function renderNamePreviews(): void {
  state.frames.forEach((frame, index) => {
    const host = document.querySelector<HTMLElement>(`.name-preview[data-frame="${CSS.escape(frame.id)}"]`);
    if (!host) return;
    host.replaceChildren();
    const languages = outputLanguages();
    try {
      host.append('Export: ');
      languages.slice(0, 4).forEach((language, position) => {
        if (position) host.append(', ');
        const code = document.createElement('code');
        code.textContent = renderOutputName(nameContext(frame, index), language, naming());
        host.append(code);
      });
      if (languages.length > 4) host.append(` e altri ${languages.length - 4}`);
    } catch (error) { host.textContent = (error as Error).message; }
  });
}

function renderNameTokens(): void {
  const host = element('name-tokens');
  const input = element<HTMLInputElement>('name-template');
  for (const { token, label } of NAME_TOKENS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = label;
    button.title = `Inserisci ${token}`;
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', () => {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.focus();
      input.setRangeText(token, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    host.append(button);
  }
}

function option(value: string, label = value): HTMLOptionElement {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  element('result').textContent = message;
  element('result').className = 'error';
}

function renderFrames(): void {
  const host = element('frames');
  host.replaceChildren();
  element('selection-count').textContent = `${state.frames.length} frame`;
  if (!state.frames.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nessun frame selezionato. Seleziona i frame nella pagina Figma.';
    host.append(p);
    return;
  }
  for (const frame of state.frames) {
    const card = document.createElement('div');
    card.className = 'frame';
    const title = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = frameLabel(frame);
    const small = document.createElement('small');
    small.textContent = `${frame.textLayers.length} livelli di testo${frame.hiddenTextLayers ? ` · ${frame.hiddenTextLayers} nascosti esclusi` : ''}${frame.managedRole === 'master' ? ' · MASTER' : frame.managedRole === 'locale' ? ' · Locale generato' : ''}`;
    title.append(strong, small);
    const source = document.createElement('label');
    source.textContent = 'Lingua modello';
    const sourceInput = document.createElement('input');
    sourceInput.value = state.sourceLanguages.get(frame.id) ?? frame.sourceLanguage;
    sourceInput.maxLength = 5;
    sourceInput.disabled = frame.managedRole === 'master';
    sourceInput.addEventListener('change', () => {
      try {
        state.sourceLanguages.set(frame.id, normalizeLanguage(sourceInput.value));
        sourceInput.value = state.sourceLanguages.get(frame.id)!;
        ensureLanguages([sourceInput.value, sourceInput.value.split('_')[0]]);
        renderValidation();
      } catch (error) { showError(error); }
    });
    source.append(sourceInput);
    const base = document.createElement('label');
    base.textContent = 'Nome base · {Nome}';
    const baseInput = document.createElement('input');
    baseInput.value = state.baseNames.get(frame.id) ?? frame.baseName;
    baseInput.addEventListener('input', () => {
      state.baseNames.set(frame.id, baseInput.value);
      renderNamePreviews();
      renderValidation();
    });
    base.append(baseInput);
    const preview = document.createElement('div');
    preview.className = 'name-preview';
    preview.dataset.frame = frame.id;
    card.append(title, source, base, preview);
    host.append(card);
  }
  renderNamePreviews();
}

function saveLanguageSettings(): void {
  if (!state.settingsLoaded) return;
  send({ kind: 'save-language-settings', settings: {
    selected: [...state.targets], primary: state.primary,
    extra: state.languages.filter(code => !DEFAULT_LANGUAGE_CODES.includes(code)),
    columnOrder: state.columnOrder,
    nameTemplate: state.nameTemplate, numberStart: state.numberStart
  } });
}

function languageChip(language: string, countryName?: string): HTMLElement {
  const chip = document.createElement('div');
  chip.className = `language${state.targets.has(language) ? ' selected' : ''}${countryName ? ' variant' : ' main-language'}`;
  const label = document.createElement('label');
  label.className = 'language-choice';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = state.targets.has(language);
  checkbox.disabled = !state.settingsLoaded;
  checkbox.setAttribute('aria-label', `Genera ${language}${countryName ? ` · ${countryName}` : ''}`);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      state.targets.add(language);
      ensureLanguages([language, language.split('_')[0]]);
    }
    else state.targets.delete(language);
    saveLanguageSettings();
    renderLanguages();
    renderPreview();
    renderValidation();
  });
  const code = document.createElement('span');
  code.className = 'language-code';
  code.textContent = language;
  label.append(checkbox, code);
  if (countryName) {
    const caption = document.createElement('small');
    caption.textContent = countryName;
    label.append(caption);
  }
  chip.append(label);
  if (!DEFAULT_LANGUAGE_CODES.includes(language)) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-language';
    remove.setAttribute('aria-label', `Rimuovi ${language}`);
    const sourceCodes = state.frames.map(frame => state.sourceLanguages.get(frame.id) ?? frame.sourceLanguage);
    const required = language === state.primary || sourceCodes.includes(language) || [...state.targets, state.primary, ...sourceCodes].some(code => code.includes('_') && code.split('_')[0] === language);
    remove.disabled = required || !state.settingsLoaded;
    remove.title = required ? 'Lingua principale, modello o fallback di una variante: modifica prima la selezione' : `Rimuovi ${language}`;
    remove.addEventListener('click', () => {
      state.languages = state.languages.filter(code => code !== language);
      state.targets.delete(language);
      saveLanguageSettings();
      renderLanguages();
      renderPreview();
      renderValidation();
    });
    chip.append(remove);
  }
  return chip;
}

function renderLanguages(): void {
  const host = element('languages');
  host.replaceChildren();
  const tabs = document.createElement('div');
  tabs.className = 'language-tabs';
  let activePanel: HTMLElement | null = null;
  for (const group of LANGUAGE_GROUPS) {
    const codes = [group.code, ...group.countries.map(country => `${group.code}_${country.code}`),
      ...state.languages.filter(code => code.startsWith(`${group.code}_`) && !DEFAULT_LANGUAGE_CODES.includes(code))];
    const tab = document.createElement('div');
    tab.className = `language-tab${state.openGroup === group.code ? ' open' : ''}`;
    tab.append(languageChip(group.code));
    tab.title = `${group.name}: ${codes.filter(code => state.targets.has(code)).length}/${codes.length} lingue selezionate`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'language-toggle secondary';
    const opened = state.openGroup === group.code;
    toggle.textContent = opened ? '▴' : '▾';
    toggle.setAttribute('aria-label', `${opened ? 'Nascondi' : 'Mostra'} paesi ${group.name}`);
    toggle.setAttribute('aria-expanded', String(opened));
    toggle.setAttribute('aria-controls', 'country-panel');
    toggle.addEventListener('click', () => {
      state.openGroup = opened ? null : group.code;
      renderLanguages();
    });
    tab.append(toggle);
    tabs.append(tab);
    if (!opened) continue;
    const panel = document.createElement('div');
    panel.id = 'country-panel';
    panel.className = 'country-panel';
    const variants = document.createElement('div');
    variants.className = 'country-options';
    for (const country of group.countries) variants.append(languageChip(`${group.code}_${country.code}`, country.name));
    for (const code of codes.slice(1 + group.countries.length)) variants.append(languageChip(code, 'Personalizzata'));
    const preset = document.createElement('button');
    preset.type = 'button';
    preset.className = 'preset-button secondary';
    preset.textContent = `Tutte le ${group.code}`;
    preset.disabled = !state.settingsLoaded;
    preset.addEventListener('click', () => {
      codes.forEach(code => state.targets.add(code));
      ensureLanguages(codes);
      saveLanguageSettings();
      renderLanguages();
      renderPreview();
      renderValidation();
    });
    panel.append(variants, preset);
    activePanel = panel;
  }
  const other = state.languages.filter(code => !LANGUAGE_GROUPS.some(group => code === group.code || code.startsWith(`${group.code}_`)));
  if (other.length) {
    const tab = document.createElement('div');
    tab.className = `language-tab other-tab${state.openGroup === 'OTHER' ? ' open' : ''}`;
    const title = document.createElement('strong');
    title.textContent = 'Altre lingue';
    const count = document.createElement('span');
    count.className = 'language-count';
    count.textContent = `${other.filter(code => state.targets.has(code)).length}/${other.length}`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'language-toggle secondary';
    toggle.textContent = state.openGroup === 'OTHER' ? '▴' : '▾';
    toggle.setAttribute('aria-label', `${state.openGroup === 'OTHER' ? 'Nascondi' : 'Mostra'} altre lingue`);
    toggle.setAttribute('aria-expanded', String(state.openGroup === 'OTHER'));
    toggle.setAttribute('aria-controls', 'country-panel');
    toggle.addEventListener('click', () => { state.openGroup = state.openGroup === 'OTHER' ? null : 'OTHER'; renderLanguages(); });
    tab.append(title, count, toggle);
    tabs.append(tab);
    if (state.openGroup === 'OTHER') {
      const panel = document.createElement('div');
      panel.id = 'country-panel';
      panel.className = 'country-panel';
      const chips = document.createElement('div');
      chips.className = 'country-options';
      other.forEach(code => chips.append(languageChip(code, code.includes('_') ? 'Personalizzata' : undefined)));
      panel.append(chips);
      activePanel = panel;
    }
  }
  host.append(tabs);
  if (activePanel) host.append(activePanel);
  const select = element<HTMLSelectElement>('primary-language');
  select.replaceChildren();
  for (const group of LANGUAGE_GROUPS) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.name;
    optgroup.append(option(group.code, `${group.code} · ${group.name}`));
    for (const country of group.countries) optgroup.append(option(`${group.code}_${country.code}`, `${group.code}_${country.code} · ${country.name}`));
    for (const code of state.languages.filter(code => code.startsWith(`${group.code}_`) && !DEFAULT_LANGUAGE_CODES.includes(code))) optgroup.append(option(code));
    select.append(optgroup);
  }
  if (other.length) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = 'Altre lingue';
    other.forEach(code => optgroup.append(option(code)));
    select.append(optgroup);
  }
  select.value = state.primary;
  select.disabled = !state.settingsLoaded || state.frames.some(frame => frame.managedRole === 'master');
  element<HTMLButtonElement>('reset-languages').disabled = !state.settingsLoaded;
  element<HTMLButtonElement>('show-custom-language').disabled = !state.settingsLoaded;
}

function ensureLanguages(codes: string[]): void {
  for (const code of codes) {
    if (!state.languages.includes(code)) state.languages.push(code);
    for (const row of state.rows) if (!(code in row.values)) row.values[code] = '';
  }
  renderLanguages();
}

function workbookLanguages(): string[] {
  const codes = new Set<string>([...state.targets, state.primary]);
  for (const frame of state.frames) codes.add(state.sourceLanguages.get(frame.id) ?? frame.sourceLanguage);
  for (const code of [...codes]) if (code.includes('_')) codes.add(code.split('_')[0]);
  return [...codes];
}

function visibleLanguages(): string[] {
  const sourceCodes = state.frames.map(frame => state.sourceLanguages.get(frame.id) ?? frame.sourceLanguage);
  const parentCodes = workbookLanguages().filter(code => [...state.targets, state.primary, ...sourceCodes].some(selected => selected.includes('_') && selected.split('_')[0] === code));
  return orderColumns(state.languages, state.columnOrder).filter(code => state.rows.some(row => code in row.values) && (state.importedName !== 'locals' || state.targets.has(code) || code === state.primary || sourceCodes.includes(code) || parentCodes.includes(code)));
}

function generateLocals(): void {
  if (!state.frames.length) throw new Error('Seleziona almeno un frame Figma');
  if (!state.targets.size) throw new Error('Seleziona almeno una lingua da generare');
  const languages = workbookLanguages();
  ensureLanguages(languages);
  state.rows = rowsFromFrames(state.frames, languages, state.rows, state.sourceLanguages);
  ensureLanguages(state.rows.flatMap(row => Object.keys(row.values)));
  state.importedName = 'locals';
  renderPreview();
  renderValidation();
}

function downloadWorkbook(filename: string): void {
  const languages = [...new Set([...visibleLanguages(), ...workbookLanguages()])];
  const bytes = writeWorkbook(state.rows, languages);
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function importWorkbook(file: File): Promise<void> {
  const parsed = readWorkbook(await file.arrayBuffer());
  state.rows = orderRowsByFrames(parsed.rows, state.frames.map(frameLabel));
  state.gridSelection = null;
  state.importedName = file.name;
  const codes = [...parsed.languages, ...workbookLanguages()];
  ensureLanguages([...codes, ...codes.filter(code => code.includes('_')).map(code => code.split('_')[0])]);
  renderPreview();
  renderValidation();
}

function isReadOnlyCell(row: TranslationRow, language: string): boolean {
  return language === state.primary && state.frames.some(frame => frameLabel(frame) === row.frame && frame.managedRole === 'master');
}

function markFallbackCell(cell: HTMLTableCellElement, row: TranslationRow, language: string): void {
  cell.classList.remove('fallback', 'missing');
  cell.title = isReadOnlyCell(row, language) ? 'Modifica il MASTER direttamente in Figma' : '';
  if (!row.translate || !state.targets.has(language) || (row.values[language] ?? '').trim()) return;
  try {
    const resolved = resolveValue(row, language, state.primary);
    cell.classList.add('fallback');
    cell.title = `Usa ${resolved.sourceLanguage} come fallback`;
  } catch (error) {
    cell.classList.add('missing');
    cell.title = (error as Error).message;
  }
}

function gridCellAt(point: GridPoint): HTMLTableCellElement | null {
  return element('preview').querySelector<HTMLTableCellElement>(`td.translation-cell[data-row="${point.row}"][data-col="${point.col}"]`);
}

function setGridSelection(anchor: GridPoint, focus: GridPoint, focusCell = true): void {
  state.gridSelection = { anchor, focus };
  const range = gridRange(anchor, focus);
  element('preview').querySelectorAll<HTMLTableCellElement>('td.translation-cell').forEach(cell => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const selected = row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
    cell.classList.toggle('grid-selected', selected);
    cell.setAttribute('aria-selected', String(selected));
  });
  element('sheet-status').textContent = `${range.bottom - range.top + 1} × ${range.right - range.left + 1} celle selezionate`;
  if (focusCell) gridCellAt(focus)?.focus({ preventScroll: true });
}

function refreshFallbackRow(rowIndex: number, languages: string[]): void {
  const row = state.rows[rowIndex];
  languages.forEach((language, col) => {
    const cell = gridCellAt({ row: rowIndex, col });
    if (cell) markFallbackCell(cell, row, language);
  });
}

function fillCellPreview(display: HTMLElement, value: string): void {
  display.replaceChildren();
  try {
    const parsed = parseMarkup(value);
    for (const segment of parsed.segments) {
      const span = document.createElement('span');
      span.textContent = segment.text;
      if (segment.b) span.style.fontWeight = '700';
      if (segment.i) span.style.fontStyle = 'italic';
      if (segment.u) span.style.textDecoration = 'underline';
      if (segment.s) span.style.textDecoration = 'line-through';
      display.append(span);
    }
  } catch { display.textContent = value; }
}

function beginCellEdit(cell: HTMLTableCellElement, languages: string[]): void {
  const rowIndex = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const row = state.rows[rowIndex];
  const language = languages[col];
  if (!row || !language) return;
  if (isReadOnlyCell(row, language)) {
    element('sheet-status').textContent = `Modifica ${language} nel MASTER direttamente in Figma.`;
    return;
  }
  if (cell.querySelector('textarea')) return;
  const display = cell.querySelector<HTMLElement>('.cell-preview')!;
  const original = row.values[language] ?? '';
  const editor = document.createElement('textarea');
  editor.className = 'cell-editor';
  editor.value = original;
  editor.setAttribute('aria-label', `${row.frame} ${row.key} ${language}`);
  let cancelled = false;
  editor.addEventListener('input', () => {
    row.values[language] = editor.value;
    refreshFallbackRow(rowIndex, languages);
    renderValidation();
  });
  editor.addEventListener('paste', event => {
    if (!event.clipboardData) return;
    const markup = richClipboardText(event.clipboardData);
    if (!markup) return;
    event.preventDefault();
    editor.setRangeText(markup, editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') { cancelled = true; event.preventDefault(); editor.blur(); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); editor.blur(); }
    else if (event.key === 'Tab') {
      event.preventDefault();
      editor.blur();
      const nextCol = col + (event.shiftKey ? -1 : 1);
      const next = nextCol >= 0 && nextCol < languages.length ? { row: rowIndex, col: nextCol } : { row: rowIndex + (event.shiftKey ? -1 : 1), col: event.shiftKey ? languages.length - 1 : 0 };
      if (next.row >= 0 && next.row < state.rows.length) setGridSelection(next, next);
    }
  });
  editor.addEventListener('blur', () => {
    if (cancelled) row.values[language] = original;
    fillCellPreview(display, row.values[language] ?? '');
    cell.replaceChildren(display);
    cell.classList.remove('editing');
    refreshFallbackRow(rowIndex, languages);
    renderValidation();
    cell.focus({ preventScroll: true });
  }, { once: true });
  cell.classList.add('editing');
  cell.replaceChildren(editor);
  editor.focus();
  editor.select();
}

function attachGridEvents(table: HTMLTableElement, languages: string[]): void {
  table.addEventListener('keydown', event => {
    if (event.target instanceof HTMLTextAreaElement) return;
    const selection = state.gridSelection;
    if (!selection) return;
    const focus = selection.focus;
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      const cell = gridCellAt(focus);
      if (cell) beginCellEdit(cell, languages);
      return;
    }
    const movement: Record<string, GridPoint> = {
      ArrowUp: { row: -1, col: 0 }, ArrowDown: { row: 1, col: 0 },
      ArrowLeft: { row: 0, col: -1 }, ArrowRight: { row: 0, col: 1 },
      Tab: { row: 0, col: event.shiftKey ? -1 : 1 }
    };
    if (event.key in movement) {
      const move = movement[event.key];
      let next = { row: focus.row + move.row, col: focus.col + move.col };
      if (event.key === 'Tab' && next.col >= languages.length) next = { row: focus.row + 1, col: 0 };
      if (event.key === 'Tab' && next.col < 0) next = { row: focus.row - 1, col: languages.length - 1 };
      if (next.row < 0 || next.row >= state.rows.length || next.col < 0 || next.col >= languages.length) return;
      event.preventDefault();
      setGridSelection(event.shiftKey && event.key !== 'Tab' ? selection.anchor : next, next);
      return;
    }
    if (event.key === 'Escape') {
      state.gridSelection = null;
      table.querySelectorAll<HTMLTableCellElement>('td.grid-selected').forEach(cell => {
        cell.classList.remove('grid-selected');
        cell.setAttribute('aria-selected', 'false');
      });
      element('sheet-status').textContent = '';
    }
  });
  table.addEventListener('copy', event => {
    if (event.target instanceof HTMLTextAreaElement || !state.gridSelection || !event.clipboardData) return;
    const range = gridRange(state.gridSelection.anchor, state.gridSelection.focus);
    const values: string[][] = [];
    for (let row = range.top; row <= range.bottom; row++) {
      values.push(languages.slice(range.left, range.right + 1).map(language => state.rows[row]?.values[language] ?? ''));
    }
    event.clipboardData.setData('text/plain', toTsv(values));
    event.preventDefault();
    element('sheet-status').textContent = `Copiate ${values.length} × ${values[0]?.length ?? 0} celle.`;
  });
  table.addEventListener('paste', event => {
    if (event.target instanceof HTMLTextAreaElement || !state.gridSelection || !event.clipboardData) return;
    event.preventDefault();
    const range = gridRange(state.gridSelection.anchor, state.gridSelection.focus);
    const cells = richClipboardCells(event.clipboardData) ?? fromTsv(event.clipboardData.getData('text/plain'));
    const result = pasteGrid(state.rows, languages, range, cells, isReadOnlyCell);
    renderPreview();
    const anchor = { row: range.top, col: range.left };
    setGridSelection(anchor, result.end);
    renderValidation();
    const notes = [result.skipped ? `${result.skipped} celle MASTER saltate` : '', result.outside ? `${result.outside} celle fuori dal foglio` : ''].filter(Boolean);
    element('sheet-status').textContent = `Incollate ${result.written} celle${notes.length ? `; ${notes.join(', ')}` : ''}.`;
  });
}

function moveLanguage(code: string, target: string, after: boolean): void {
  if (code === target) return;
  state.columnOrder = moveColumn(visibleLanguages(), state.columnOrder, code, target, after);
  state.gridSelection = null;
  saveLanguageSettings();
  renderPreview();
}

// Pointer-driven drag (not native HTML5 DnD) so the closed-hand cursor, the
// floating label and the drop marker stay under our control while dragging.
function languageHeader(language: string, col: number): HTMLTableCellElement {
  const th = document.createElement('th');
  th.scope = 'col';
  th.className = 'language-header';
  th.textContent = language;
  th.dataset.language = language;
  th.title = 'Trascina per spostare la colonna';
  th.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const table = th.closest('table')!;
    const scroller = element('preview');
    const startX = event.clientX;
    let ghost: HTMLElement | null = null;
    let drop: { target: string; after: boolean } | null = null;
    const headers = (): HTMLTableCellElement[] => Array.from(table.querySelectorAll<HTMLTableCellElement>('th.language-header'));
    const clearMarks = (): void => headers().forEach(header => header.classList.remove('drop-before', 'drop-after'));
    const begin = (): void => {
      document.body.classList.add('column-dragging');
      th.classList.add('dragging');
      table.querySelectorAll(`td.translation-cell[data-col="${col}"]`).forEach(cell => cell.classList.add('column-dragged'));
      ghost = document.createElement('div');
      ghost.className = 'column-ghost';
      ghost.textContent = language;
      document.body.append(ghost);
    };
    const move = (moveEvent: PointerEvent): void => {
      if (!ghost && Math.abs(moveEvent.clientX - startX) < 4) return;
      if (!ghost) begin();
      ghost!.style.left = `${moveEvent.clientX}px`;
      ghost!.style.top = `${moveEvent.clientY}px`;
      const box = scroller.getBoundingClientRect();
      if (moveEvent.clientX < box.left + 40) scroller.scrollLeft -= 16;
      else if (moveEvent.clientX > box.right - 40) scroller.scrollLeft += 16;
      clearMarks();
      drop = null;
      for (const header of headers()) {
        const rect = header.getBoundingClientRect();
        if (moveEvent.clientX < rect.left || moveEvent.clientX > rect.right) continue;
        const after = moveEvent.clientX > rect.left + rect.width / 2;
        drop = { target: header.dataset.language!, after };
        if (drop.target !== language) header.classList.add(after ? 'drop-after' : 'drop-before');
        break;
      }
    };
    const finish = (commit: boolean): void => {
      th.removeEventListener('pointermove', move);
      th.removeEventListener('pointerup', onUp);
      th.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (th.hasPointerCapture(event.pointerId)) th.releasePointerCapture(event.pointerId);
      document.body.classList.remove('column-dragging');
      ghost?.remove();
      clearMarks();
      th.classList.remove('dragging');
      table.querySelectorAll('td.column-dragged').forEach(cell => cell.classList.remove('column-dragged'));
      if (commit && ghost && drop) moveLanguage(language, drop.target, drop.after);
    };
    const onUp = (): void => finish(true);
    const onCancel = (): void => finish(false);
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    };
    th.setPointerCapture(event.pointerId);
    th.addEventListener('pointermove', move);
    th.addEventListener('pointerup', onUp);
    th.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  });
  return th;
}

function renderPreview(): void {
  const host = element('preview');
  host.replaceChildren();
  element('workbook-caption').textContent = state.rows.length ? `${state.importedName}: ${state.rows.length} righe. Modifica i campi e scarica l’Excel aggiornato.` : 'Genera i locals dai frame selezionati o importa un file .xlsx.';
  element<HTMLButtonElement>('download-edited').disabled = !state.rows.length;
  element<HTMLButtonElement>('make-template').disabled = !state.rows.length;
  const all = element<HTMLInputElement>('translate-all');
  all.disabled = !state.rows.length;
  all.checked = state.rows.length > 0 && state.rows.every(row => row.translate);
  all.indeterminate = state.rows.some(row => row.translate) && !all.checked;
  if (!state.rows.length) {
    state.gridSelection = null;
    element('sheet-status').textContent = '';
    return;
  }
  const languages = visibleLanguages();
  const table = document.createElement('table');
  table.className = 'translation-grid';
  table.style.setProperty('--language-count', String(languages.length));
  table.setAttribute('role', 'grid');
  table.setAttribute('aria-label', 'Anteprima traduzioni');
  table.tabIndex = 0;
  const colgroup = document.createElement('colgroup');
  for (const className of ['translate-col', 'key-col', ...languages.map(() => 'language-col')]) {
    const col = document.createElement('col');
    col.className = className;
    colgroup.append(col);
  }
  table.append(colgroup);
  const thead = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of ['Traduci', 'Key']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    header.append(th);
  }
  languages.forEach((language, col) => header.append(languageHeader(language, col)));
  thead.append(header);
  table.append(thead);
  const tbody = document.createElement('tbody');
  for (const frameName of [...new Set(state.rows.map(row => row.frame))]) {
    const group = document.createElement('tr');
    group.className = 'frame-group';
    const groupCell = document.createElement('th');
    groupCell.scope = 'rowgroup';
    groupCell.colSpan = languages.length + 2;
    const title = document.createElement('span');
    title.className = 'frame-name';
    title.textContent = frameName;
    title.title = frameName;
    groupCell.append(title);
    group.append(groupCell);
    tbody.append(group);
    state.rows.forEach((row, rowIndex) => {
      if (row.frame !== frameName) return;
      const tr = document.createElement('tr');
      tr.className = row.translate ? '' : 'inactive';
      const activeCell = document.createElement('td');
      activeCell.className = 'translate-cell';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = row.translate;
      checkbox.setAttribute('aria-label', `Traduci ${row.frame} ${row.key}`);
      checkbox.addEventListener('change', () => {
        state.rows[rowIndex].translate = checkbox.checked;
        renderPreview();
        renderValidation();
      });
      activeCell.append(checkbox);
      const keyCell = document.createElement('td');
      keyCell.className = 'key-cell';
      keyCell.textContent = row.key;
      keyCell.title = row.key;
      tr.append(activeCell, keyCell);
      languages.forEach((language, col) => {
        const td = document.createElement('td');
        td.className = 'translation-cell';
        td.dataset.row = String(rowIndex);
        td.dataset.col = String(col);
        td.tabIndex = -1;
        td.setAttribute('role', 'gridcell');
        td.setAttribute('aria-label', `${row.frame} ${row.key} ${language}`);
        td.setAttribute('aria-selected', 'false');
        if (isReadOnlyCell(row, language)) td.classList.add('locked');
        markFallbackCell(td, row, language);
        const display = document.createElement('div');
        display.className = 'cell-preview';
        fillCellPreview(display, row.values[language] ?? '');
        td.append(display);
        const point = { row: rowIndex, col };
        td.addEventListener('pointerdown', event => {
          if (event.button !== 0 || event.target instanceof HTMLTextAreaElement) return;
          event.preventDefault();
          const anchor = event.shiftKey && state.gridSelection ? state.gridSelection.anchor : point;
          setGridSelection(anchor, point);
          state.draggingGrid = true;
        });
        td.addEventListener('pointerenter', event => {
          if (state.draggingGrid && (event.buttons & 1)) setGridSelection(state.gridSelection?.anchor ?? point, point, false);
        });
        td.addEventListener('dblclick', () => beginCellEdit(td, languages));
        tr.append(td);
      });
      tbody.append(tr);
    });
  }
  table.append(tbody);
  table.addEventListener('focus', event => {
    if (event.target === table && !state.gridSelection && state.rows.length && languages.length) setGridSelection({ row: 0, col: 0 }, { row: 0, col: 0 });
  });
  attachGridEvents(table, languages);
  host.append(table);
  const selection = state.gridSelection;
  if (selection && selection.anchor.row < state.rows.length && selection.focus.row < state.rows.length && selection.anchor.col < languages.length && selection.focus.col < languages.length) {
    setGridSelection(selection.anchor, selection.focus, false);
  } else {
    state.gridSelection = null;
    element('sheet-status').textContent = '';
  }
}

function diagnostics(): string[] {
  const errors: string[] = [];
  if (!state.frames.length) errors.push('Seleziona almeno un frame Figma');
  if (!state.targets.size) errors.push('Seleziona almeno una lingua');
  if (state.frames.length && state.frames.every(frame => frame.managedRole === 'master') && [...state.targets].every(code => code === state.primary)) errors.push('Seleziona una lingua da creare o aggiornare oltre al MASTER');
  if (!state.rows.length) errors.push('Genera locales o importa un file Excel');
  for (const frame of state.frames) {
    if (frame.managedRole === 'locale') errors.push(`${frame.name}: seleziona il MASTER per rieditare`);
    if (frame.managedRole === 'master' && (state.sourceLanguages.get(frame.id) ?? frame.sourceLanguage) !== state.primary) errors.push(`${frame.name}: la lingua principale del MASTER è ${frame.sourceLanguage}`);
    try { normalizeLanguage(state.sourceLanguages.get(frame.id) ?? frame.sourceLanguage); }
    catch (error) { errors.push((error as Error).message); }
  }
  if (state.frames.length) errors.push(...namingErrors(state.frames.map((frame, index) => ({ ...nameContext(frame, index), label: frameLabel(frame) })), outputLanguages(), naming()));
  if (state.rows.length && state.frames.length && state.targets.size) errors.push(...validateRows(state.rows, state.frames, [...new Set([state.primary, ...state.targets])], state.primary));
  return [...new Set(errors)];
}

function renderValidation(): void {
  renderNamePreviews();
  const host = element('validation');
  host.replaceChildren();
  const errors = diagnostics();
  if (errors.length) {
    const strong = document.createElement('strong');
    strong.className = 'error';
    strong.textContent = 'Prima di generare:';
    const list = document.createElement('ul');
    list.className = 'error';
    for (const message of errors.slice(0, 10)) {
      const li = document.createElement('li');
      li.textContent = message;
      list.append(li);
    }
    host.append(strong, list);
  } else {
    const ok = document.createElement('span');
    ok.className = 'success';
    const fallbackCounts = new Map<string, number>();
    for (const row of state.rows.filter(row => row.translate)) for (const language of new Set([state.primary, ...state.targets])) {
      const resolved = resolveValue(row, language, state.primary);
      if (resolved.fallback) fallbackCounts.set(resolved.sourceLanguage, (fallbackCounts.get(resolved.sourceLanguage) ?? 0) + 1);
    }
    const detail = [...fallbackCounts].map(([code, count]) => `${code} ${count}`).join(', ');
    ok.textContent = detail ? `Pronto per generare. Fallback: ${detail}.` : 'Pronto per generare. Nessun fallback.';
    host.append(ok);
  }
  const warnings = state.frames.flatMap(frame => (frame.duplicateKeys ?? [])
    .map(({ name, keys }) => `${frameLabel(frame)}: Key "${name}" usata da più livelli, rinominata in ${keys.join(', ')}`));
  if (warnings.length) {
    const strong = document.createElement('strong');
    strong.className = 'warning warning-title';
    strong.textContent = 'Attenzione: Key duplicate';
    const list = document.createElement('ul');
    list.className = 'warning';
    for (const message of warnings) {
      const li = document.createElement('li');
      li.textContent = message;
      list.append(li);
    }
    host.append(strong, list);
  }
  element<HTMLButtonElement>('generate').disabled = errors.length > 0 || state.busy;
}

function send(message: unknown): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

element('add-language').addEventListener('click', () => {
  try {
    const input = element<HTMLInputElement>('custom-language');
    const code = normalizeLanguage(input.value);
    ensureLanguages([code, code.split('_')[0]]);
    state.targets.add(code);
    state.openGroup = LANGUAGE_GROUPS.some(group => group.code === code.split('_')[0]) ? code.split('_')[0] : 'OTHER';
    input.value = '';
    element('custom-language-wrap').hidden = true;
    element('language-error').hidden = true;
    saveLanguageSettings();
    renderLanguages();
    renderPreview();
    renderValidation();
  } catch (error) {
    const message = element('language-error');
    message.textContent = (error as Error).message;
    message.hidden = false;
  }
});
element('show-custom-language').addEventListener('click', () => {
  const wrap = element('custom-language-wrap');
  wrap.hidden = !wrap.hidden;
  if (!wrap.hidden) element<HTMLInputElement>('custom-language').focus();
});
element('reset-languages').addEventListener('click', () => {
  const master = state.frames.find(frame => frame.managedRole === 'master');
  state.primary = master?.sourceLanguage ?? DEFAULT_LANGUAGE_SETTINGS.primary;
  state.targets = new Set(master ? [master.sourceLanguage] : DEFAULT_LANGUAGE_SETTINGS.selected);
  state.languages = [...DEFAULT_LANGUAGE_CODES];
  state.openGroup = null;
  ensureLanguages(workbookLanguages());
  saveLanguageSettings();
  renderLanguages();
  renderPreview();
  renderValidation();
});
element<HTMLInputElement>('custom-language').addEventListener('input', () => { element('language-error').hidden = true; });
element<HTMLSelectElement>('primary-language').addEventListener('change', event => {
  state.primary = (event.target as HTMLSelectElement).value;
  ensureLanguages([state.primary, state.primary.split('_')[0]]);
  saveLanguageSettings();
  renderPreview();
  renderValidation();
});
element('generate-locals').addEventListener('click', () => {
  if (state.pendingLocalsFrameIds) return;
  if (!state.frames.length || !state.targets.size) { try { generateLocals(); } catch (error) { showError(error); } return; }
  state.pendingLocalsFrameIds = state.frames.map(frame => frame.id);
  element<HTMLButtonElement>('generate-locals').disabled = true;
  send({ kind: 'read-locals', frameIds: state.pendingLocalsFrameIds });
});
element('make-template').addEventListener('click', () => { try { downloadWorkbook('figma-translations-template.xlsx'); } catch (error) { showError(error); } });
element<HTMLInputElement>('translate-all').addEventListener('change', event => {
  const checked = (event.target as HTMLInputElement).checked;
  state.rows.forEach(row => { row.translate = checked; });
  renderPreview();
  renderValidation();
});
element<HTMLInputElement>('file-input').addEventListener('change', async event => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try { await importWorkbook(file); element('result').textContent = ''; }
  catch (error) { showError(error); }
});
element('download-edited').addEventListener('click', () => { try { downloadWorkbook('figma-translations-updated.xlsx'); } catch (error) { showError(error); } });
element<HTMLInputElement>('name-template').addEventListener('input', event => {
  state.nameTemplate = (event.target as HTMLInputElement).value;
  saveLanguageSettings();
  renderNamePreviews();
  renderValidation();
});
element<HTMLInputElement>('number-start').addEventListener('input', event => {
  const value = (event.target as HTMLInputElement).value;
  state.numberStart = /^\d+$/.test(value) ? Number(value) : NaN;
  if (Number.isInteger(state.numberStart)) saveLanguageSettings();
  renderNamePreviews();
  renderValidation();
});
element<HTMLInputElement>('create-sections').addEventListener('change', () => {
  element('section-mode-options').hidden = !element<HTMLInputElement>('create-sections').checked;
});
element('generate').addEventListener('click', () => {
  const errors = diagnostics();
  if (errors.length) { renderValidation(); return; }
  state.busy = true;
  element('busy').textContent = 'Generazione in corso…';
  element('result').textContent = '';
  renderValidation();
  state.pendingRequest = {
    kind: 'generate',
    frameIds: state.frames.map(frame => frame.id),
    rows: state.rows,
    targets: [...state.targets],
    primary: state.primary,
    baseNames: Object.fromEntries(state.baseNames),
    naming: naming(),
    sectionMode: element<HTMLInputElement>('create-sections').checked
      ? document.querySelector<HTMLInputElement>('input[name="section-mode"]:checked')?.value as 'locale' | 'base' ?? 'locale'
      : 'none',
    collisionMode: 'version',
    confirmedReplacementIds: []
  };
  send({
    kind: 'inspect', frameIds: state.pendingRequest.frameIds, targets: state.pendingRequest.targets,
    primary: state.pendingRequest.primary, baseNames: state.pendingRequest.baseNames,
    naming: state.pendingRequest.naming
  });
});

window.addEventListener('pointerup', () => { state.draggingGrid = false; });
window.addEventListener('pointercancel', () => { state.draggingGrid = false; });

function cancelReplacement(): void {
  state.pendingRequest = null;
  state.busy = false;
  element('busy').textContent = '';
  renderValidation();
}

element('cancel-replace').addEventListener('click', () => {
  element<HTMLDialogElement>('replace-dialog').close();
  cancelReplacement();
});
element<HTMLDialogElement>('replace-dialog').addEventListener('close', () => {
  if (state.pendingRequest) cancelReplacement();
});
element('confirm-replace').addEventListener('click', () => {
  const request = state.pendingRequest;
  if (!request) return;
  request.collisionMode = 'replace';
  state.pendingRequest = null;
  element<HTMLDialogElement>('replace-dialog').close();
  send(request);
});
element('confirm-version').addEventListener('click', () => {
  const request = state.pendingRequest;
  if (!request) return;
  request.collisionMode = 'version';
  request.confirmedReplacementIds = [];
  state.pendingRequest = null;
  element<HTMLDialogElement>('replace-dialog').close();
  send(request);
});

// ---------- Profilo brand ----------

function setSectionMode(mode: SectionMode): void {
  element<HTMLInputElement>('create-sections').checked = mode !== 'none';
  element('section-mode-options').hidden = mode === 'none';
  if (mode !== 'none') {
    const choice = document.querySelector<HTMLInputElement>(`input[name="section-mode"][value="${mode}"]`);
    if (choice) choice.checked = true;
  }
}

// Selezionare un profilo precompila le impostazioni; restano modificabili. Il MASTER selezionato decide la lingua principale.
function applyPrefill(prefill: Prefill): void {
  if (prefill.nameTemplate !== undefined) {
    state.nameTemplate = prefill.nameTemplate;
    element<HTMLInputElement>('name-template').value = prefill.nameTemplate;
  }
  if (prefill.numberStart !== undefined) {
    state.numberStart = prefill.numberStart;
    element<HTMLInputElement>('number-start').value = String(prefill.numberStart);
  }
  const master = state.frames.find(frame => frame.managedRole === 'master');
  if (prefill.primary && !master) state.primary = prefill.primary;
  if (prefill.targets) state.targets = new Set(prefill.targets);
  if (prefill.sectionMode) setSectionMode(prefill.sectionMode);
  ensureLanguages([...state.targets, state.primary]);
  saveLanguageSettings();
  renderNamePreviews();
  renderLanguages();
  renderPreview();
  renderValidation();
}

function profileError(error: unknown): void {
  const box = element('profile-error');
  box.textContent = error instanceof Error ? error.message : String(error);
  box.hidden = false;
}

function renderProfiles(current: ProfilesState): void {
  const select = element<HTMLSelectElement>('profile-select');
  select.replaceChildren(option('', 'Nessun profilo'));
  for (const [origin, label] of [['base', 'Profili di base'], ['personal', 'Profili personali']] as const) {
    const items = current.profiles.filter(item => item.origin === origin);
    if (!items.length) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const item of items) group.append(option(item.name, item.hasAdditions ? `${item.name} · con le tue aggiunte` : item.name));
    select.append(group);
  }
  select.value = current.selected ?? '';
  const origin = profiles.origin(current.selected);
  element<HTMLButtonElement>('profile-export').disabled = !current.selected;
  element<HTMLButtonElement>('profile-rename').disabled = origin !== 'personal';
  element<HTMLButtonElement>('profile-delete').disabled = origin !== 'personal';
  element('profile-clear-additions').hidden = !profiles.hasAdditions(current.selected);
  const status = current.selected
    ? `${current.selected}: ${origin === 'base' ? 'profilo di base' : 'profilo personale'}${profiles.hasAdditions(current.selected) ? ' con le tue aggiunte' : ''}.`
    : 'Nessun profilo: le impostazioni sono quelle compilate qui sotto.';
  element('profile-status').textContent = [status, ...current.notices].join(' ');
}

const profiles = new ProfilesController({
  send: message => send(message),
  onState: (current, applied) => {
    renderProfiles(current);
    if (applied?.profile) applyPrefill(prefillFrom(applied.profile));
  }
});

async function profileTask(task: () => Promise<unknown>): Promise<void> {
  element('profile-error').hidden = true;
  try { await task(); }
  catch (error) { profileError(error); }
}

function askImportChoice(result: Extract<ImportResult, { status: 'choose' }>): Promise<ImportChoice> {
  const dialog = element<HTMLDialogElement>('profile-import-dialog');
  element('profile-import-message').textContent = result.message.replace(/ \((merge|replace|rename)\)/g, '');
  const canRename = result.choices.includes('rename');
  element('profile-import-rename-wrap').hidden = !canRename;
  element('profile-import-rename-button').hidden = !canRename;
  element('profile-import-merge').hidden = !result.choices.includes('merge');
  const renameInput = element<HTMLInputElement>('profile-import-rename');
  renameInput.value = canRename ? `${result.name} (importato)` : '';
  return new Promise(resolve => {
    const done = (choice: ImportChoice) => { cleanup(); dialog.close(); resolve(choice); };
    const handlers: Array<[string, () => void]> = [
      ['profile-import-cancel', () => done(null)],
      ['profile-import-merge', () => done({ mode: 'merge' })],
      ['profile-import-replace', () => done({ mode: 'replace' })],
      ['profile-import-rename-button', () => done(renameInput.value.trim() ? { rename: renameInput.value.trim() } : null)]
    ];
    const onClose = () => { cleanup(); resolve(null); };
    const cleanup = () => {
      for (const [id, fn] of handlers) element(id).removeEventListener('click', fn);
      dialog.removeEventListener('close', onClose);
    };
    for (const [id, fn] of handlers) element(id).addEventListener('click', fn);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}

element<HTMLSelectElement>('profile-select').addEventListener('change', event => {
  const name = (event.target as HTMLSelectElement).value || null;
  void profileTask(() => profiles.select(name));
});
element('profile-create').addEventListener('click', () => {
  const input = element<HTMLInputElement>('profile-name');
  void profileTask(async () => { await profiles.create(input.value); input.value = ''; });
});
element('profile-rename').addEventListener('click', () => {
  const input = element<HTMLInputElement>('profile-name');
  const current = profiles.state.selected;
  if (!current) return;
  void profileTask(async () => { await profiles.rename(current, input.value); input.value = ''; });
});
element('profile-delete').addEventListener('click', () => {
  const current = profiles.state.selected;
  if (current) void profileTask(() => profiles.remove(current));
});
element('profile-clear-additions').addEventListener('click', () => {
  const current = profiles.state.selected;
  if (current) void profileTask(async () => { await profiles.clearAdditions(current); await profiles.select(current); });
});
element('profile-export').addEventListener('click', () => {
  const current = profiles.state.selected;
  if (!current) return;
  void profileTask(async () => {
    const { filename, content } = await profiles.exportProfile(current);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    element('profile-status').textContent = `Esportato ${filename}.`;
  });
});
element<HTMLInputElement>('profile-import').addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  void profileTask(async () => {
    const result = await profiles.importText(await file.text(), askImportChoice);
    if (result?.status === 'imported') {
      element('profile-status').textContent = result.as === 'additions'
        ? `Importato in ${result.name}: ${result.changes} novità salvate come tue aggiunte.`
        : `Importato il profilo personale ${result.name}.`;
    }
  });
});

function acceptSelection(frames: FrameInfo[]): void {
  state.frames = frames;
  state.rows = orderRowsByFrames(state.rows, state.frames.map(frameLabel));
  state.gridSelection = null;
  const master = frames.find(frame => frame.managedRole === 'master');
  if (master) state.primary = master.sourceLanguage;
  const savedSectionMode = frames.find(frame => frame.exportSectionMode && frame.exportSectionMode !== 'none')?.exportSectionMode
    ?? frames.find(frame => frame.exportSectionMode)?.exportSectionMode;
  if (savedSectionMode) {
    element<HTMLInputElement>('create-sections').checked = savedSectionMode !== 'none';
    element('section-mode-options').hidden = savedSectionMode === 'none';
    if (savedSectionMode !== 'none') {
      const choice = document.querySelector<HTMLInputElement>(`input[name="section-mode"][value="${savedSectionMode}"]`);
      if (choice) choice.checked = true;
    }
  }
  for (const frame of frames) {
    if (!state.sourceLanguages.has(frame.id)) state.sourceLanguages.set(frame.id, frame.sourceLanguage);
    if (!state.baseNames.has(frame.id)) state.baseNames.set(frame.id, frame.baseName);
  }
  ensureLanguages(workbookLanguages());
  renderFrames();
  renderPreview();
  renderValidation();
}

onmessage = (event: MessageEvent<{ pluginMessage: PluginMessage }>) => {
  const message = event.data.pluginMessage;
  if (!message) return;
  if (profiles.handle(message)) return;
  if (message.kind === 'language-settings') {
    const settings = readLanguageSettings(message.settings);
    const master = state.frames.find(frame => frame.managedRole === 'master');
    state.primary = master?.sourceLanguage ?? settings.primary;
    state.targets = new Set(settings.selected);
    state.languages = [...DEFAULT_LANGUAGE_CODES, ...settings.extra];
    state.columnOrder = settings.columnOrder;
    state.nameTemplate = settings.nameTemplate;
    state.numberStart = settings.numberStart;
    element<HTMLInputElement>('name-template').value = settings.nameTemplate;
    element<HTMLInputElement>('number-start').value = String(settings.numberStart);
    renderNamePreviews();
    state.openGroup = null;
    state.settingsLoaded = true;
    ensureLanguages([...state.targets, state.primary, ...state.frames.map(frame => state.sourceLanguages.get(frame.id) ?? frame.sourceLanguage)]);
    renderPreview();
    renderValidation();
  } else if (message.kind === 'selection') {
    acceptSelection(message.frames);
  } else if (message.kind === 'locals-source') {
    const pending = state.pendingLocalsFrameIds;
    if (!pending) return;
    state.pendingLocalsFrameIds = null;
    element<HTMLButtonElement>('generate-locals').disabled = false;
    if (pending.slice().sort().join('|') !== message.frames.map(frame => frame.id).sort().join('|')) {
      showError('La selezione Figma è cambiata: ripeti Genera locales');
      return;
    }
    try { acceptSelection(message.frames); generateLocals(); }
    catch (error) { showError(error); }
  } else if (message.kind === 'generation-plan') {
    const request = state.pendingRequest;
    if (!request) return;
    if (!message.replacements.length) {
      state.pendingRequest = null;
      send(request);
    } else {
      request.confirmedReplacementIds = message.replacements.map(item => item.id);
      const list = element('replace-list');
      list.replaceChildren();
      for (const item of message.replacements) {
        const li = document.createElement('li');
        li.textContent = `${item.name} · ${item.language}`;
        list.append(li);
      }
      element<HTMLDialogElement>('replace-dialog').showModal();
      element('busy').textContent = 'Scegli se sostituire gli export esistenti o creare una nuova versione.';
    }
  } else if (message.kind === 'done') {
    state.busy = false;
    state.pendingRequest = null;
    element('busy').textContent = '';
    element('result').className = 'success';
    element('result').textContent = `${message.names.length} frame creati in EXPORT.${message.warnings.length ? `\n\nAvvisi:\n${message.warnings.join('\n')}` : ''}`;
    renderValidation();
  } else if (message.kind === 'error') {
    state.pendingLocalsFrameIds = null;
    element<HTMLButtonElement>('generate-locals').disabled = false;
    state.busy = false;
    state.pendingRequest = null;
    element('busy').textContent = '';
    showError(message.message);
    renderValidation();
  }
};

renderNameTokens();
renderFrames();
renderLanguages();
renderValidation();
send({ kind: 'ready' });
startAgentBridge(connected => {
  const badge = element('agent-status');
  badge.textContent = connected ? 'Agente collegato' : 'Agente non collegato';
  badge.classList.toggle('connected', connected);
}, () => ({
  naming: naming(),
  baseNames: Object.fromEntries(state.baseNames),
  sectionMode: element<HTMLInputElement>('create-sections').checked
    ? document.querySelector<HTMLInputElement>('input[name="section-mode"]:checked')?.value as 'locale' | 'base' ?? 'locale'
    : 'none',
  targets: [...state.targets],
  primary: state.primary
}));
