// Archivio dei Profili brand: modulo puro condiviso tra il codice del plugin (che custodisce l'archivio, ADR 0002)
// e il server MCP. Nessuna dipendenza da Figma, dal DOM o da Node.
import { DEFAULT_NAME_TEMPLATE, normalizeLanguage } from './core';

export const PROFILE_VERSION = 2;
export const EXPORT_FORMAT = 'figma-auto-fill-brand-profile';

export type SectionMode = 'none' | 'locale' | 'base';
export type GlossaryEntry = { term: string; keep: boolean; translations: Record<string, string> };
export type ConfirmedMatch = { source: string; rowId?: string; rowSource: string };
export type ExcelModelHeader = { column: number; header: string; code?: string };
// Modello Excel: la struttura di un Excel cliente senza testi delle colonne lingua né ID.
export type ExcelModel = {
  sheet: string;
  headerRow: number;
  headers: ExcelModelHeader[];
  idColumn?: number;
  sourceColumn?: number;
  labels: string[];
};
export type BrandProfile = {
  version: typeof PROFILE_VERSION;
  name: string;
  // Solo nei Profili di base: numero di revisione curato dall'amministratore e nomi usati in passato.
  revision?: number;
  previousNames: string[];
  naming?: { template: string; start: number };
  primaryLanguage?: string;
  languages: string[];
  sections?: SectionMode;
  glossary: GlossaryEntry[];
  ignoredLayers: string[];
  confirmedMatches: ConfirmedMatch[];
  excelModels: ExcelModel[];
};

// Aggiunte personali: ciò che un designer ha imparato su un Profilo di base, salvato a parte.
// `baseSnapshot` è il Profilo di base visto l'ultima volta: serve se il base sparisce in una release futura.
export type Additions = {
  base: string;
  baseSnapshot: BrandProfile;
  naming?: { template: string; start: number };
  primaryLanguage?: string;
  sections?: SectionMode;
  languages: string[];
  glossary: GlossaryEntry[];
  ignoredLayers: string[];
  removedIgnoredLayers: string[];
  confirmedMatches: ConfirmedMatch[];
  removedConfirmedMatches: string[];
  excelModels?: ExcelModel[];
};

export type ArchiveState = {
  personal: BrandProfile[];
  additions: Additions[];
  selected: string | null;
};
export const EMPTY_ARCHIVE: ArchiveState = { personal: [], additions: [], selected: null };

export type ProfileOrigin = 'base' | 'personal';
export type ProfileSummary = {
  name: string; origin: ProfileOrigin; hasAdditions: boolean; primaryLanguage?: string; languages: string[]; excelModels: number;
};

// ---------- validazione ----------

class Issues {
  readonly list: string[] = [];
  add(path: string, message: string): void { this.list.push(`${path}: ${message}`); }
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function text(value: unknown, path: string, issues: Issues, required = true): string | undefined {
  if (value === undefined || value === null) { if (required) issues.add(path, 'obbligatorio'); return undefined; }
  if (typeof value !== 'string') { issues.add(path, 'deve essere un testo'); return undefined; }
  const trimmed = value.trim();
  if (!trimmed && required) { issues.add(path, 'non può essere vuoto'); return undefined; }
  return trimmed || undefined;
}

function language(value: unknown, path: string, issues: Issues): string | undefined {
  if (typeof value !== 'string') { issues.add(path, 'deve essere un codice lingua'); return undefined; }
  try { return normalizeLanguage(value); }
  catch (error) { issues.add(path, (error as Error).message); return undefined; }
}

function list<T>(value: unknown, path: string, issues: Issues, item: (entry: unknown, path: string) => T | undefined): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) { issues.add(path, 'deve essere un elenco'); return []; }
  return value.flatMap((entry, index) => { const parsed = item(entry, `${path}.${index}`); return parsed === undefined ? [] : [parsed]; });
}

function integer(value: unknown, path: string, issues: Issues, min = 0): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) { issues.add(path, `deve essere un intero ≥ ${min}`); return undefined; }
  return value;
}

const unique = <T>(items: T[], key: (item: T) => string = item => String(item)): T[] => {
  const seen = new Set<string>();
  return items.filter(item => { const k = key(item); if (seen.has(k)) return false; seen.add(k); return true; });
};

function parseNaming(value: unknown, path: string, issues: Issues): BrandProfile['naming'] {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) { issues.add(path, 'deve essere un oggetto { template, start }'); return undefined; }
  const template = text(value.template, `${path}.template`, issues);
  const start = value.start === undefined ? 1 : integer(value.start, `${path}.start`, issues);
  return template !== undefined && start !== undefined ? { template, start } : undefined;
}

function parseSections(value: unknown, path: string, issues: Issues): SectionMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'none' || value === 'locale' || value === 'base') return value;
  issues.add(path, 'deve essere none, locale o base');
  return undefined;
}

function parseGlossary(value: unknown, path: string, issues: Issues): GlossaryEntry | undefined {
  if (!isObject(value)) { issues.add(path, 'deve essere un oggetto { term, keep, translations }'); return undefined; }
  const term = text(value.term, `${path}.term`, issues);
  const translations: Record<string, string> = {};
  if (isObject(value.translations)) {
    for (const [code, translation] of Object.entries(value.translations)) {
      const normalized = language(code, `${path}.translations.${code}`, issues);
      if (normalized && typeof translation === 'string') translations[normalized] = translation;
    }
  } else if (value.translations !== undefined) issues.add(`${path}.translations`, 'deve essere un oggetto lingua → testo');
  return term ? { term, keep: value.keep === true, translations } : undefined;
}

function parseIgnored(value: unknown, path: string, issues: Issues): string | undefined {
  const entry = text(value, path, issues);
  if (entry?.startsWith('re:')) {
    try { new RegExp(entry.slice(3), 'i'); }
    catch { issues.add(path, `Espressione regolare non valida: ${entry}`); return undefined; }
  }
  return entry;
}

function parseConfirmed(value: unknown, path: string, issues: Issues): ConfirmedMatch | undefined {
  if (!isObject(value)) { issues.add(path, 'deve essere un oggetto { source, rowSource }'); return undefined; }
  const source = text(value.source, `${path}.source`, issues);
  const rowSource = text(value.rowSource, `${path}.rowSource`, issues);
  const rowId = typeof value.rowId === 'string' && value.rowId.trim() ? value.rowId.trim() : undefined;
  return source && rowSource ? { source, rowSource, ...(rowId ? { rowId } : {}) } : undefined;
}

function parseModel(value: unknown, path: string, issues: Issues): ExcelModel | undefined {
  if (!isObject(value)) { issues.add(path, 'deve essere un Modello Excel'); return undefined; }
  const sheet = text(value.sheet, `${path}.sheet`, issues);
  const headerRow = integer(value.headerRow ?? 1, `${path}.headerRow`, issues, 1);
  const headers = list(value.headers, `${path}.headers`, issues, (entry, at) => {
    if (!isObject(entry)) { issues.add(at, 'deve essere { column, header, code? }'); return undefined; }
    const column = integer(entry.column, `${at}.column`, issues, 1);
    const header = text(entry.header, `${at}.header`, issues);
    const code = entry.code === undefined ? undefined : language(entry.code, `${at}.code`, issues);
    return column !== undefined && header ? { column, header, ...(code ? { code } : {}) } : undefined;
  });
  const idColumn = value.idColumn === undefined ? undefined : integer(value.idColumn, `${path}.idColumn`, issues, 1);
  const sourceColumn = value.sourceColumn === undefined ? undefined : integer(value.sourceColumn, `${path}.sourceColumn`, issues, 1);
  const labels = unique(list(value.labels, `${path}.labels`, issues, (entry, at) => text(entry, at, issues)));
  if (!sheet || headerRow === undefined) return undefined;
  return { sheet, headerRow, headers, labels, ...(idColumn ? { idColumn } : {}), ...(sourceColumn ? { sourceColumn } : {}) };
}

// Converte un profilo versione 1 (schema precedente, salvato dal server su disco) nella versione corrente.
function migrate(input: Record<string, unknown>): Record<string, unknown> {
  if (input.version === 1) return { ...input, version: PROFILE_VERSION, excelModels: [], previousNames: [] };
  return input;
}

export function validateProfile(input: unknown): BrandProfile {
  const issues = new Issues();
  if (!isObject(input)) throw new Error('Profilo brand non valido — profilo: deve essere un oggetto');
  const raw = migrate(input);
  if (raw.version !== undefined && raw.version !== PROFILE_VERSION) issues.add('version', `versione non supportata: ${String(raw.version)} (supportate: 1, ${PROFILE_VERSION})`);
  const name = text(raw.name, 'name', issues);
  const profile: BrandProfile = {
    version: PROFILE_VERSION,
    name: name ?? '',
    previousNames: unique(list(raw.previousNames, 'previousNames', issues, (entry, at) => text(entry, at, issues))),
    languages: unique(list(raw.languages, 'languages', issues, (entry, at) => language(entry, at, issues))),
    glossary: list(raw.glossary, 'glossary', issues, (entry, at) => parseGlossary(entry, at, issues)),
    ignoredLayers: unique(list(raw.ignoredLayers, 'ignoredLayers', issues, (entry, at) => parseIgnored(entry, at, issues)), lower),
    confirmedMatches: list(raw.confirmedMatches, 'confirmedMatches', issues, (entry, at) => parseConfirmed(entry, at, issues)),
    excelModels: list(raw.excelModels, 'excelModels', issues, (entry, at) => parseModel(entry, at, issues))
  };
  const naming = parseNaming(raw.naming, 'naming', issues);
  if (naming) profile.naming = naming;
  if (raw.primaryLanguage !== undefined && raw.primaryLanguage !== null && raw.primaryLanguage !== '') {
    const primary = language(raw.primaryLanguage, 'primaryLanguage', issues);
    if (primary) profile.primaryLanguage = primary;
  }
  const sections = parseSections(raw.sections, 'sections', issues);
  if (sections) profile.sections = sections;
  if (raw.revision !== undefined) {
    const revision = integer(raw.revision, 'revision', issues, 1);
    if (revision) profile.revision = revision;
  }
  if (issues.list.length) throw new Error(`Profilo brand non valido — ${issues.list.join('; ')}`);
  return profile;
}

export function emptyProfile(name: string): BrandProfile {
  return validateProfile({ name });
}

export function profileNaming(profile: BrandProfile | null | undefined): { template: string; start: number } {
  return profile?.naming ?? { template: DEFAULT_NAME_TEMPLATE, start: 1 };
}

// ---------- profilo effettivo e Aggiunte personali ----------

const lower = (value: string): string => value.trim().toLowerCase();
const sameName = (a: string, b: string): boolean => lower(a) === lower(b);
const json = (value: unknown): string => JSON.stringify(value);

function emptyAdditions(base: BrandProfile): Additions {
  return {
    base: base.name, baseSnapshot: base, languages: [], glossary: [], ignoredLayers: [], removedIgnoredLayers: [],
    confirmedMatches: [], removedConfirmedMatches: []
  };
}

// Somma base + aggiunte: le aggiunte prevalgono in caso di conflitto.
export function applyAdditions(base: BrandProfile, additions: Additions | undefined): BrandProfile {
  if (!additions) return base;
  const removedIgnored = new Set(additions.removedIgnoredLayers.map(lower));
  const removedMatches = new Set(additions.removedConfirmedMatches);
  const addedMatches = new Set(additions.confirmedMatches.map(item => item.source));
  const addedTerms = new Set(additions.glossary.map(item => lower(item.term)));
  const profile: BrandProfile = {
    ...base,
    languages: unique([...base.languages, ...additions.languages]),
    glossary: [...base.glossary.filter(item => !addedTerms.has(lower(item.term))), ...additions.glossary],
    ignoredLayers: unique([...base.ignoredLayers.filter(item => !removedIgnored.has(lower(item))), ...additions.ignoredLayers], lower),
    confirmedMatches: [
      ...base.confirmedMatches.filter(item => !removedMatches.has(item.source) && !addedMatches.has(item.source)),
      ...additions.confirmedMatches
    ],
    excelModels: additions.excelModels ?? base.excelModels
  };
  if (additions.naming) profile.naming = additions.naming;
  if (additions.primaryLanguage) profile.primaryLanguage = additions.primaryLanguage;
  if (additions.sections) profile.sections = additions.sections;
  return profile;
}

// Le differenze di un profilo rispetto al suo Profilo di base, espresse come Aggiunte personali.
export function additionsFrom(profile: BrandProfile, base: BrandProfile): Additions {
  const additions = emptyAdditions(base);
  if (profile.naming && json(profile.naming) !== json(base.naming)) additions.naming = profile.naming;
  if (profile.primaryLanguage && profile.primaryLanguage !== base.primaryLanguage) additions.primaryLanguage = profile.primaryLanguage;
  if (profile.sections && profile.sections !== base.sections) additions.sections = profile.sections;
  additions.languages = profile.languages.filter(code => !base.languages.includes(code));
  const baseTerms = new Map(base.glossary.map(item => [lower(item.term), json(item)]));
  additions.glossary = profile.glossary.filter(item => baseTerms.get(lower(item.term)) !== json(item));
  const baseIgnored = new Set(base.ignoredLayers.map(lower));
  const profileIgnored = new Set(profile.ignoredLayers.map(lower));
  additions.ignoredLayers = profile.ignoredLayers.filter(item => !baseIgnored.has(lower(item)));
  additions.removedIgnoredLayers = base.ignoredLayers.filter(item => !profileIgnored.has(lower(item)));
  const baseMatches = new Map(base.confirmedMatches.map(item => [item.source, json(item)]));
  const profileSources = new Set(profile.confirmedMatches.map(item => item.source));
  additions.confirmedMatches = profile.confirmedMatches.filter(item => baseMatches.get(item.source) !== json(item));
  additions.removedConfirmedMatches = base.confirmedMatches.map(item => item.source).filter(source => !profileSources.has(source));
  if (json(profile.excelModels) !== json(base.excelModels)) additions.excelModels = profile.excelModels;
  return additions;
}

export function isEmptyAdditions(additions: Additions): boolean {
  return !additions.naming && !additions.primaryLanguage && !additions.sections && !additions.excelModels
    && !additions.languages.length && !additions.glossary.length && !additions.ignoredLayers.length
    && !additions.removedIgnoredLayers.length && !additions.confirmedMatches.length && !additions.removedConfirmedMatches.length;
}

// Unisce aggiunte nuove (per esempio importate) a quelle esistenti: le nuove prevalgono.
export function mergeAdditions(existing: Additions, incoming: Additions, base: BrandProfile): Additions {
  return additionsFrom(applyAdditions(applyAdditions(base, existing), incoming), base);
}

export class Archive {
  private readonly bases: BrandProfile[];
  state: ArchiveState;

  constructor(bases: BrandProfile[], state: ArchiveState = EMPTY_ARCHIVE) {
    this.bases = bases;
    this.state = { personal: [...state.personal], additions: [...state.additions], selected: state.selected };
  }

  base(name: string): BrandProfile | undefined { return this.bases.find(item => sameName(item.name, name)); }
  personal(name: string): BrandProfile | undefined { return this.state.personal.find(item => sameName(item.name, name)); }
  additions(name: string): Additions | undefined { return this.state.additions.find(item => sameName(item.base, name)); }
  origin(name: string): ProfileOrigin | null { return this.base(name) ? 'base' : this.personal(name) ? 'personal' : null; }

  list(): ProfileSummary[] {
    const summary = (profile: BrandProfile, origin: ProfileOrigin): ProfileSummary => ({
      name: profile.name, origin, hasAdditions: origin === 'base' && Boolean(this.additions(profile.name)),
      ...(profile.primaryLanguage ? { primaryLanguage: profile.primaryLanguage } : {}),
      languages: profile.languages, excelModels: profile.excelModels.length
    });
    return [
      ...this.bases.map(base => summary(applyAdditions(base, this.additions(base.name)), 'base')),
      ...this.state.personal.map(profile => summary(profile, 'personal'))
    ];
  }

  // Il profilo come lo vede il designer: Profilo di base + Aggiunte personali, oppure il Profilo personale.
  get(name: string): BrandProfile | null {
    const base = this.base(name);
    if (base) return applyAdditions(base, this.additions(base.name));
    return this.personal(name) ?? null;
  }

  all(): BrandProfile[] { return this.list().map(item => this.get(item.name)!); }

  // Salva un profilo effettivo: su un Profilo di base diventa Aggiunte personali, altrimenti Profilo personale.
  save(input: unknown): BrandProfile {
    const profile = validateProfile(input);
    const base = this.base(profile.name);
    if (base) {
      const additions = additionsFrom({ ...profile, name: base.name }, base);
      this.state.additions = this.state.additions.filter(item => !sameName(item.base, base.name));
      if (!isEmptyAdditions(additions)) this.state.additions.push(additions);
      return this.get(base.name)!;
    }
    const clean: BrandProfile = { ...profile, previousNames: [] };
    delete clean.revision;
    this.state.personal = [...this.state.personal.filter(item => !sameName(item.name, profile.name)), clean];
    return clean;
  }

  update(name: string, change: (profile: BrandProfile) => BrandProfile): BrandProfile {
    const current = this.get(name);
    if (!current) throw new Error(`Profilo brand non trovato: ${name}`);
    return this.save(change(current));
  }

  create(name: string): BrandProfile {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Indica il nome del profilo');
    if (this.origin(trimmed)) throw new Error(`Esiste già un profilo "${this.get(trimmed)!.name}"`);
    return this.save(emptyProfile(trimmed));
  }

  remove(name: string): void {
    if (this.base(name)) throw new Error(`"${name}" è un Profilo di base: non si può cancellare (puoi cancellare le tue Aggiunte personali)`);
    if (!this.personal(name)) throw new Error(`Profilo brand non trovato: ${name}`);
    this.state.personal = this.state.personal.filter(item => !sameName(item.name, name));
    if (this.state.selected && sameName(this.state.selected, name)) this.state.selected = null;
  }

  rename(name: string, next: string): BrandProfile {
    const profile = this.personal(name);
    if (!profile) throw new Error(this.base(name) ? `"${name}" è un Profilo di base: non si può rinominare` : `Profilo brand non trovato: ${name}`);
    const target = next.trim();
    if (!target) throw new Error('Indica il nuovo nome');
    if (!sameName(name, target) && this.origin(target)) throw new Error(`Esiste già un profilo "${target}"`);
    const renamed = { ...profile, name: target };
    this.state.personal = this.state.personal.map(item => item === profile ? renamed : item);
    if (this.state.selected && sameName(this.state.selected, name)) this.state.selected = target;
    return renamed;
  }

  clearAdditions(name: string): void {
    this.state.additions = this.state.additions.filter(item => !sameName(item.base, name));
  }

  select(name: string | null): BrandProfile | null {
    if (name === null) { this.state.selected = null; return null; }
    const profile = this.get(name);
    if (!profile) throw new Error(`Profilo brand non trovato: ${name}`);
    this.state.selected = profile.name;
    return profile;
  }

  selected(): BrandProfile | null { return this.state.selected ? this.get(this.state.selected) : null; }

  // Da eseguire a ogni avvio: aggiorna gli snapshot dei Profili di base, ricollega le aggiunte di un base rinominato
  // (previousNames) e converte in Profilo personale le aggiunte il cui base non esiste più.
  reconcile(): string[] {
    const notices: string[] = [];
    const kept: Additions[] = [];
    for (const additions of this.state.additions) {
      const base = this.base(additions.base) ?? this.bases.find(item => item.previousNames.some(old => sameName(old, additions.base)));
      if (base) {
        if (!sameName(base.name, additions.base)) notices.push(`Il profilo di base "${additions.base}" ora si chiama "${base.name}": le tue aggiunte lo seguono.`);
        kept.push({ ...additions, base: base.name, baseSnapshot: base });
        continue;
      }
      let name = additions.base;
      for (let n = 2; this.origin(name) || this.state.personal.some(item => sameName(item.name, name)); n++) name = `${additions.base} (${n})`;
      const profile = applyAdditions(additions.baseSnapshot, additions);
      this.state.personal.push(validateProfile({ ...profile, name, revision: undefined, previousNames: [] }));
      notices.push(`Il profilo di base "${additions.base}" non è più disponibile: le tue impostazioni sono state conservate come profilo personale "${name}".`);
    }
    this.state.additions = kept;
    if (this.state.selected && !this.origin(this.state.selected)) {
      const moved = this.bases.find(item => item.previousNames.some(old => sameName(old, this.state.selected!)));
      this.state.selected = moved?.name ?? (this.personal(this.state.selected) ? this.state.selected : null);
    }
    return notices;
  }

  // ---------- export / import ----------

  exportFile(name: string): ExportFile {
    const profile = this.get(name);
    if (!profile) throw new Error(`Profilo brand non trovato: ${name}`);
    const base = this.base(name);
    const exported: BrandProfile = { ...profile };
    if (!base) delete exported.revision;
    return {
      format: EXPORT_FORMAT, version: PROFILE_VERSION, profile: exported,
      ...(base ? { origin: { base: base.name, ...(base.revision ? { revision: base.revision } : {}) } } : {})
    };
  }

  import(raw: unknown, options: ImportOptions = {}): ImportResult {
    const incoming = readExportFile(raw);
    const profile = options.rename ? { ...incoming, name: options.rename.trim() } : incoming;
    const base = this.base(profile.name);
    if (base) {
      const additions = additionsFrom({ ...profile, name: base.name }, base);
      if (isEmptyAdditions(additions)) return { status: 'imported', name: base.name, as: 'additions', changes: 0, profile: this.get(base.name)! };
      const existing = this.additions(base.name);
      if (existing && !options.mode) {
        return {
          status: 'choose', choices: ['merge', 'replace'], name: base.name,
          message: `Hai già Aggiunte personali su "${base.name}": unirle a quelle importate (merge) o sostituirle (replace)?`
        };
      }
      const next = existing && options.mode === 'merge' ? mergeAdditions(existing, additions, base) : additions;
      this.state.additions = [...this.state.additions.filter(item => !sameName(item.base, base.name)), next];
      return { status: 'imported', name: base.name, as: 'additions', changes: countChanges(next), profile: this.get(base.name)! };
    }
    const existing = this.personal(profile.name);
    if (existing && options.mode !== 'replace') {
      return {
        status: 'choose', choices: ['replace', 'rename'], name: existing.name,
        message: `Esiste già un profilo personale "${existing.name}": sostituirlo (replace) o importarlo con un altro nome (rename)?`
      };
    }
    const saved = this.save({ ...profile, revision: undefined, previousNames: [] });
    return { status: 'imported', name: saved.name, as: 'personal', changes: 0, profile: saved };
  }
}

export type ExportFile = {
  format: typeof EXPORT_FORMAT; version: number; profile: BrandProfile; origin?: { base: string; revision?: number };
};
export type ImportOptions = { mode?: 'merge' | 'replace'; rename?: string };
export type ImportResult =
  | { status: 'imported'; name: string; as: 'additions' | 'personal'; changes: number; profile: BrandProfile }
  | { status: 'choose'; choices: Array<'merge' | 'replace' | 'rename'>; name: string; message: string };

function countChanges(additions: Additions): number {
  return [additions.naming, additions.primaryLanguage, additions.sections, additions.excelModels].filter(Boolean).length
    + additions.languages.length + additions.glossary.length + additions.ignoredLayers.length + additions.removedIgnoredLayers.length
    + additions.confirmedMatches.length + additions.removedConfirmedMatches.length;
}

// Accetta un file esportato (versione 1 o 2) oppure un profilo nudo, come i file della vecchia cartella dei profili.
export function readExportFile(raw: unknown): BrandProfile {
  if (!isObject(raw)) throw new Error('Il file non è un profilo brand di Figma Auto Fill');
  if ('format' in raw) {
    if (raw.format !== EXPORT_FORMAT) throw new Error('Il file non è un profilo brand esportato da Figma Auto Fill');
    if (raw.version !== 1 && raw.version !== PROFILE_VERSION) {
      throw new Error(`Versione del profilo non supportata: ${String(raw.version)} (supportate: 1, ${PROFILE_VERSION})`);
    }
    return validateProfile(raw.profile);
  }
  if ('name' in raw && ('version' in raw || 'languages' in raw)) return validateProfile(raw);
  throw new Error('Il file non è un profilo brand di Figma Auto Fill');
}

export function readArchiveState(value: unknown): ArchiveState {
  if (!isObject(value)) return { ...EMPTY_ARCHIVE };
  const personal = Array.isArray(value.personal) ? value.personal.flatMap(item => { try { return [validateProfile(item)]; } catch { return []; } }) : [];
  const additions = Array.isArray(value.additions) ? value.additions.flatMap(item => {
    if (!isObject(item) || typeof item.base !== 'string') return [];
    try {
      const snapshot = validateProfile(item.baseSnapshot);
      const profile = validateProfile({ ...applyAdditionsRaw(snapshot, item), name: snapshot.name });
      return [additionsFrom(profile, snapshot)].map(result => ({ ...result, base: item.base as string }));
    } catch { return []; }
  }) : [];
  return { personal, additions, selected: typeof value.selected === 'string' ? value.selected : null };
}

// Rilegge aggiunte salvate passando dalla validazione del profilo risultante.
function applyAdditionsRaw(snapshot: BrandProfile, raw: Record<string, unknown>): BrandProfile {
  const arr = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
  return applyAdditions(snapshot, {
    base: snapshot.name, baseSnapshot: snapshot,
    naming: raw.naming as Additions['naming'], primaryLanguage: raw.primaryLanguage as string | undefined,
    sections: raw.sections as SectionMode | undefined, languages: arr(raw.languages), glossary: arr(raw.glossary),
    ignoredLayers: arr(raw.ignoredLayers), removedIgnoredLayers: arr(raw.removedIgnoredLayers),
    confirmedMatches: arr(raw.confirmedMatches), removedConfirmedMatches: arr(raw.removedConfirmedMatches),
    excelModels: raw.excelModels === undefined ? undefined : arr(raw.excelModels)
  });
}

// ---------- Modello Excel e riconoscimento ----------

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const MAX_LABEL_LENGTH = 40;
const MAX_LABEL_WORDS = 6;
const MAX_LABELS = 200;

export type ModelSource = {
  sheet: string; headerRow: number; rows: string[][];
  languageColumns: Array<{ column: number; code: string }>; idColumn?: number; sourceColumn?: number;
};

// Intestazioni delle colonne-chiave, quelle che nominano il campo di ogni riga. Una colonna con un'altra intestazione
// (per esempio una lingua non riconosciuta come `AT` o `Dutch NLNL`, o `Tags`) può contenere testo del cliente e non si usa.
const LABEL_HEADERS = new Set([
  '', 'context', 'contesto', 'field', 'campo', 'key', 'chiave', 'label', 'etichetta', 'element', 'elemento', 'name', 'nome',
  'section', 'sezione', 'block', 'blocco', 'module', 'modulo', 'component', 'componente', 'type', 'tipo', 'placement',
  'description', 'descrizione', 'string', 'stringa', 'copy element', 'asset'
]);

// Estrae il Modello Excel: intestazioni ed Etichette ricorrenti (valori brevi delle colonne-chiave).
export function extractExcelModel(source: ModelSource): ExcelModel {
  const languageByColumn = new Map(source.languageColumns.map(item => [item.column, item.code]));
  const headerCells = source.rows[source.headerRow - 1] ?? [];
  const headers: ExcelModelHeader[] = headerCells.flatMap((header, index) => {
    const column = index + 1;
    const code = languageByColumn.get(column);
    return header.trim() ? [{ column, header: header.trim(), ...(code ? { code } : {}) }] : [];
  });
  const labelColumns = headerCells.map((_, index) => index + 1)
    .filter(column => !languageByColumn.has(column) && column !== source.idColumn && column !== source.sourceColumn
      && LABEL_HEADERS.has(fold(headerCells[column - 1] ?? '')));
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const row of source.rows.slice(source.headerRow)) {
    for (const column of labelColumns) {
      const value = (row[column - 1] ?? '').trim().replace(/\s+/g, ' ');
      if (!value || value.length > MAX_LABEL_LENGTH || value.split(' ').length > MAX_LABEL_WORDS || /^[\d\s.,:/-]+$/.test(value)) continue;
      const key = fold(value);
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(value);
      if (labels.length >= MAX_LABELS) break;
    }
    if (labels.length >= MAX_LABELS) break;
  }
  return {
    sheet: source.sheet, headerRow: source.headerRow, headers, labels,
    ...(source.idColumn ? { idColumn: source.idColumn } : {}), ...(source.sourceColumn ? { sourceColumn: source.sourceColumn } : {})
  };
}

const dice = (a: Set<string>, b: Set<string>): number => {
  if (!a.size && !b.size) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common++;
  return (2 * common) / (a.size + b.size);
};

const labelWords = (labels: string[]): Set<string> =>
  new Set(labels.flatMap(label => fold(label).split(/[^a-z]+/)).filter(word => word.length > 1));

export type ModelSimilarity = { score: number; common: { sheet: boolean; headers: string[]; labels: string[] } };

// Somiglianza tra due Modelli Excel (0–1). Le Etichette ricorrenti pesano più delle intestazioni, spesso generiche.
export function modelSimilarity(a: ExcelModel, b: ExcelModel): ModelSimilarity {
  const headersA = new Set(a.headers.map(item => fold(item.header)));
  const headersB = new Set(b.headers.map(item => fold(item.header)));
  const labelsA = new Set(a.labels.map(fold));
  const labelsB = new Set(b.labels.map(fold));
  const sheet = fold(a.sheet) === fold(b.sheet);
  const parts: Array<[number, number]> = [[sheet ? 1 : 0, 0.15], [dice(headersA, headersB), 0.35]];
  // Le etichette cambiano un po' a ogni campagna ("Subject Line Option 1 Launch Members"): conta anche il lessico comune.
  if (labelsA.size && labelsB.size) parts.push([Math.max(dice(labelsA, labelsB), dice(labelWords(a.labels), labelWords(b.labels))), 0.5]);
  const weight = parts.reduce((total, [, w]) => total + w, 0);
  const score = Math.round((parts.reduce((total, [value, w]) => total + value * w, 0) / weight) * 100) / 100;
  return {
    score,
    common: {
      sheet,
      headers: a.headers.filter(item => headersB.has(fold(item.header))).map(item => item.header),
      labels: a.labels.filter(item => labelsB.has(fold(item))).slice(0, 10)
    }
  };
}

export const RECOGNITION_THRESHOLD = 0.5;
export const RECOGNITION_MARGIN = 0.15;

export type Candidate = { name: string; origin?: ProfileOrigin; score: number; common: ModelSimilarity['common'] };
export type Recognition = { outcome: 'clear' | 'ambiguous' | 'none'; candidates: Candidate[] };

export function recognize(model: ExcelModel, profiles: Array<BrandProfile & { origin?: ProfileOrigin }>): Recognition {
  const candidates = profiles.flatMap(profile => {
    const best = profile.excelModels.map(known => modelSimilarity(model, known)).sort((x, y) => y.score - x.score)[0];
    return best && best.score >= RECOGNITION_THRESHOLD
      ? [{ name: profile.name, ...(profile.origin ? { origin: profile.origin } : {}), score: best.score, common: best.common }]
      : [];
  }).sort((x, y) => y.score - x.score);
  if (!candidates.length) return { outcome: 'none', candidates };
  const clear = candidates.length === 1 || candidates[0].score - candidates[1].score >= RECOGNITION_MARGIN;
  return { outcome: clear ? 'clear' : 'ambiguous', candidates: clear ? candidates.slice(0, 1) : candidates.filter(item => candidates[0].score - item.score < RECOGNITION_MARGIN) };
}

// Indice del Modello Excel del profilo più simile a `model` (per sostituirlo in un aggiornamento), o -1.
export function closestModelIndex(profile: BrandProfile, model: ExcelModel): number {
  let best = -1;
  let bestScore = RECOGNITION_THRESHOLD;
  profile.excelModels.forEach((known, index) => {
    const { score } = modelSimilarity(model, known);
    if (score >= bestScore) { best = index; bestScore = score; }
  });
  return best;
}

// ---------- azioni sull'archivio (UI del plugin e agente via bridge) ----------

export type ProfileAction =
  | { action: 'list' }
  | { action: 'all' }
  | { action: 'get'; name: string }
  | { action: 'select'; name: string | null }
  | { action: 'save'; profile: unknown }
  | { action: 'create'; name: string }
  | { action: 'remove'; name: string }
  | { action: 'rename'; name: string; next: string }
  | { action: 'clear-additions'; name: string }
  | { action: 'export'; name: string }
  | { action: 'import'; file: unknown; mode?: 'merge' | 'replace'; rename?: string };

export type ProfilesState = { profiles: ProfileSummary[]; selected: string | null; notices: string[] };

// Esegue un'azione sull'archivio; `changed` indica se lo stato va salvato e ritrasmesso alla UI.
export function runProfileAction(archive: Archive, input: ProfileAction): { data: unknown; changed: boolean } {
  switch (input.action) {
    case 'list': return { data: { profiles: archive.list(), selected: archive.state.selected }, changed: false };
    case 'all': return {
      data: { profiles: archive.list().map(item => ({ ...archive.get(item.name)!, origin: item.origin })), selected: archive.state.selected },
      changed: false
    };
    case 'get': {
      const profile = archive.get(input.name);
      if (!profile) {
        const known = archive.list().map(item => item.name);
        throw new Error(`Profilo brand "${input.name}" non trovato.${known.length ? ` Disponibili: ${known.join(', ')}.` : ''}`);
      }
      return { data: { profile, origin: archive.origin(profile.name), additions: archive.additions(profile.name) ?? null }, changed: false };
    }
    case 'select': return { data: { profile: archive.select(input.name), selected: archive.state.selected }, changed: true };
    case 'save': return { data: { profile: archive.save(input.profile) }, changed: true };
    case 'create': return { data: { profile: archive.create(input.name) }, changed: true };
    case 'remove': archive.remove(input.name); return { data: { removed: input.name }, changed: true };
    case 'rename': return { data: { profile: archive.rename(input.name, input.next) }, changed: true };
    case 'clear-additions': archive.clearAdditions(input.name); return { data: { profile: archive.get(input.name) }, changed: true };
    case 'export': return { data: archive.exportFile(input.name), changed: false };
    case 'import': {
      const result = archive.import(input.file, { mode: input.mode, rename: input.rename });
      return { data: result, changed: result.status === 'imported' };
    }
    default: throw new Error(`Azione sui profili sconosciuta: ${String((input as { action?: unknown }).action)}`);
  }
}

export function exportFilename(name: string): string {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profilo';
  return `${slug}.brand.json`;
}

export type HeaderMapping = { column: number; header: string; code: string | null };

// Le corrispondenze intestazione → lingua che il Brand conosce già per questo formato (Modello Excel più simile).
// Un'intestazione presente nel modello senza lingua (per esempio `Context`) vale "non è una lingua".
// Le intestazioni che il modello non conosce restano all'analisi automatica.
export function mappingFromProfile(profile: BrandProfile, model: ExcelModel, headerCells: string[]): HeaderMapping[] {
  const index = closestModelIndex(profile, model);
  if (index < 0) return [];
  const known = profile.excelModels[index].headers;
  return headerCells.flatMap((header, offset) => {
    const column = offset + 1;
    const key = fold(header);
    if (!key) return [];
    const matches = known.filter(item => fold(item.header) === key);
    if (!matches.length) return [];
    const best = matches.find(item => item.column === column) ?? matches[0];
    return [{ column, header: header.trim(), code: best.code ?? null }];
  });
}
