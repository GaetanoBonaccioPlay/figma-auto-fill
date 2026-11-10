import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import {
  frameLabel, normalizeLanguage, renderOutputName, shortLanguages, validateRows,
  type FrameInfo, type LanguageSuffix, type NamingOptions, type TranslationRow
} from '../src/core';
import type { UiState } from '../src/agent-protocol';
import {
  closestModelIndex, extractExcelModel, mappingFromProfile, modelSimilarity, profileNaming, recognize, validateProfile,
  type BrandProfile, type ConfirmedMatch, type ExcelModel, type ProfileOrigin, type Recognition, type SectionMode
} from '../src/profiles';
import { PluginProfiles } from './brands';
import type { PluginLink } from './bridge';
import {
  analyzeWorkbook, columnLetter, columnNumber, readSheets, type AnalysisReport, type SheetData
} from './excel-analyze';
import { DEFAULT_SEARCH_ROOTS, resolveExcelPath, type WorkingCopies } from './excel-locate';
import {
  cellToMarkup, defaultOutputPath, isGeneratedCopy, planUpdates, writeUpdatedWorkbook
} from './excel-update';
import {
  DEFAULT_SIMILARITY_THRESHOLD, isIgnoredLayer, layerId, matchLayers, normalizeText,
  type ExcelRow, type LayerRef, type MatchResult
} from './match';

type ExcelConfig = {
  // path: il file letto (la copia di lavoro, se c'è); original: il file del designer, accanto a cui va la copia aggiornata.
  // inline: traduzioni passate dalla chat o da un allegato letto dall'agente, senza file sul Mac: niente Excel aggiornato.
  path: string; original: string; inline: boolean; sheet: string; headerRow: number; idColumn?: number; sourceColumn: number; primary: string;
  languageColumns: Record<string, number>; rows: ExcelRow[]; lastRow: number;
};
type Session = {
  brand: BrandProfile | null;
  brandOrigin: ProfileOrigin | null;
  // Senza Brand, Livelli esclusi e Abbinamenti confermati valgono per la sessione (e finiscono nel profilo se lo si salva).
  scratch: { ignoredLayers: string[]; confirmedMatches: ConfirmedMatch[] };
  analysis: AnalysisReport | null;
  original: string | null;
  // Tabella delle traduzioni arrivate dalla chat (load_translations): sostituisce la lettura del file.
  inlineSheet: SheetData | null;
  sheetRows: string[][];
  model: ExcelModel | null;
  recognition: Recognition | null;
  usedSettings: { naming: { template: string; start: number }; sections: SectionMode; languages: string[] } | null;
  excel: ExcelConfig | null;
  selection: FrameInfo[] | null;
  layers: Array<LayerRef & { markup: string }>;
  match: MatchResult | null;
  accepted: Map<string, { layer: LayerRef; row: number }>;
  generated: { frameIds: string[]; languages: string[]; rows: TranslationRow[] } | null;
  ai: Map<string, { row: number; language: string; text: string }>;
  writtenOutputs: Set<string>;
};

const newSession = (): Session => ({
  brand: null, brandOrigin: null, scratch: { ignoredLayers: [], confirmedMatches: [] },
  analysis: null, original: null, inlineSheet: null, sheetRows: [], model: null, recognition: null, usedSettings: null, excel: null, selection: null, layers: [], match: null,
  accepted: new Map(), generated: null, ai: new Map(), writtenOutputs: new Set()
});

export function todayStamp(now = new Date()): string {
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

export const WORKFLOW = `Segui questi passi, uno alla volta, chiedendo conferma al designer dove indicato.
REGOLA GENERALE: davanti a un'incongruenza (lingue del plugin diverse da quelle dell'Excel, testi o traduzioni mancanti, nomi o impostazioni che non tornano, risposte "conflict" o "confirm-languages") NON decidere da solo e non andare avanti: fai una domanda breve al designer, con una proposta consigliata, e agisci solo dopo la risposta.
Il Brand è un aiuto, non un vincolo: si può lavorare senza Brand e quando c'è il suo Profilo brand suggerisce, ma vale sempre l'Excel che hai davanti.
1. TRADUZIONI (EXCEL CLIENTE o chat) — chiedi da dove vengono le traduzioni; l'Excel sul Mac è facoltativo.
   - Testi scritti in chat o file allegato (Excel, CSV, PDF, Word, immagine...): leggili tu e passali a load_translations come tabella (prima riga: codici lingua come IT, EN, EN_GB e, se c'è, una colonna ID; poi una riga per testo). Non cercare il file sul Mac e non chiedere percorsi. Con questi dati non c'è Excel aggiornato: il passo 6 si salta.
   - Excel sul Mac del designer (indica un percorso): chiama analyze_client_excel con path. Se nomina solo il file, passalo in file_name e il server lo cerca in Download, Scrivania e Documenti; se non lo trova o ne trova più di uno, chiedi il percorso completo.
   In entrambi i casi, se il designer nomina un Brand passalo in brand. Mostra foglio, colonne lingua trovate (intestazione → codice) e chiedi conferma o correzioni della mappatura. NON chiedere ancora quali lingue generare: dipende dalle righe usate dai frame (passo 4).
2. BRAND — leggi il blocco "brand" della risposta e segui "brand.next": con un candidato chiaro proponilo e chiedi conferma; con più candidati elencali e fai scegliere; se il profilo selezionato nel plugin è diverso dal Brand riconosciuto fai notare la differenza e chiedi quale usare; se non c'è nessun candidato dillo in una riga e prosegui senza Brand. Seleziona il Brand scelto con get_brand_profile. Le differenze tra Excel e profilo (profileDifferences) sono solo informative: riportale in una riga, non chiedere nulla. Se c'è profileMapping (in analyze_client_excel o get_brand_profile), il Brand conosce già questo formato e ha corretto la mappatura delle colonne (es. IE → EN_IE): mostra le correzioni nella mappatura da confermare.
3. SELEZIONE — chiedi di selezionare i frame in Figma con il plugin aperto (bridge_status, get_selection).
4. ABBINAMENTO — chiama match_selection con le colonne confermate. La Colonna sorgente si sceglie dai dati (sourceChoice): se differisce dalla lingua principale del profilo riportalo in una riga. Presenta UN SOLO riepilogo: abbinamenti simili (con punteggio), Livelli orfani e Celle multi-livello (queste ultime vanno sistemate dal designer, non abbinarle). Se tra gli orfani ci sono livelli di contorno (To:, Reply to:, date, logo) proponi di escluderli con exclude_layers (restano nel Profilo brand, o nella sessione se non c'è Brand) e richiama match_selection. Registra le decisioni con confirm_matches.
   LINGUE — solo ora, dopo l'abbinamento, proponi le lingue da generare: quelle in "languages.needed" (le colonne con almeno una traduzione nelle righe usate dai frame). Le lingue in "languages.notNeeded" hanno traduzioni solo in righe che non sono nei frame selezionati (es. un disclaimer): non proporle e dillo in una riga. Se una lingua necessaria ha celle vuote (missingRows), segnalalo. Chiedi conferma.
5. GENERAZIONE — chiama generate_exports con le lingue confermate. Se risponde "confirm-settings", PRIMA di esportare fai le domande in "questions" con lo strumento AskUserQuestion (una domanda per voce, opzioni con gli esempi di nome o di section, la consigliata per prima): suffisso Lang o Lang-Country e section (divise per country, divise per lang, no). Non scegliere tu: di base il paese non va nel nome se la lingua non ha altre varianti (EN_GB → EN), salvo che il designer scelga Lang-Country. Poi richiama con language_suffix e section_mode. Se risponde "conflict", chiedi se sostituire (replace) o creare una nuova versione (version) e richiama con on_conflict.
6. EXCEL AGGIORNATO — solo se le traduzioni vengono da un Excel sul Mac (analyze_client_excel); con load_translations salta questo passo. Chiama write_updated_excel. Di base la copia contiene SOLO le righe usate dai frame e non aggiunge i Livelli orfani (aggiungili con add_orphans solo se il designer lo chiede). Non sovrascrivere celle piene: mostra i conflitti e passa overwrite solo per quelle che il designer conferma.
7. TRADUZIONE AI (facoltativa) — alla fine chiedi SOLO se il designer vuole tradurre le celle vuote (list_empty_cells ne dà il numero). Se sì, traduci rispettando il Glossario brand (se c'è un Brand), fai rivedere le traduzioni, salvale con save_ai_translations e rilancia generate_exports (e write_updated_excel se c'è un Excel sul Mac).
8. REFERENCE — chiama pending_profile_updates. Senza Brand chiedi se salvare questo Excel come reference per la prossima volta (proponi suggestedName, il designer può cambiarlo). Con un Brand, se ci sono novità (Modello Excel, lingue, impostazioni usate diverse dal profilo), elencale in una riga e chiedi se ricordarle. Solo dopo un sì chiama apply_profile_updates; con un no il profilo non cambia.`;

// Senza Brand e senza un indizio dai dati, la lingua della Colonna sorgente provvisoria.
const FALLBACK_PRIMARY = 'EN';

export function suggestedProfileName(path: string): string {
  const name = basename(path, extname(path)).replace(/_updated$/i, '')
    .replace(/[_-]+/g, ' ').replace(/\b(\d{4,8}|v\d+|final|def|definitivo|copy|translations?|traduzioni)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return name || 'Nuovo profilo';
}

export function createMcpServer(deps: {
  bridge: PluginLink; now?: () => Date; excelSearchRoots?: string[];
  // Senza, l'Excel si legge dove si trova (test e usi programmatici).
  workingCopies?: WorkingCopies;
}): McpServer {
  const server = new McpServer({ name: 'figma-auto-fill', version: '1.0.0' });
  const session = newSession();
  const now = deps.now ?? (() => new Date());
  const profiles = new PluginProfiles(deps.bridge);

  const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const fail = (error: unknown) => ({
    isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }]
  });
  function register<S extends z.ZodRawShape>(
    name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).registerTool(name, { description, inputSchema: shape }, async (args: any) => {
      try { return ok(await handler(args)); }
      catch (error) { return fail(error); }
    });
  }

  const useBrand = (profile: BrandProfile | null, origin: ProfileOrigin | null): void => {
    session.brand = profile;
    session.brandOrigin = profile ? origin : null;
  };
  const knowledge = () => session.brand
    ? { ignoredLayers: session.brand.ignoredLayers, confirmedMatches: session.brand.confirmedMatches, glossary: session.brand.glossary }
    : { ...session.scratch, glossary: [] };
  // Un fatto imparato (Livelli esclusi, Abbinamenti confermati) si salva subito nel profilo, o nella sessione senza Brand.
  const learn = async (change: { ignoredLayers?: string[]; confirmedMatches?: ConfirmedMatch[] }): Promise<'profilo brand' | 'sessione'> => {
    if (session.brand) {
      session.brand = await profiles.save(validateProfile({ ...session.brand, ...change }));
      return 'profilo brand';
    }
    session.scratch = { ...session.scratch, ...change };
    return 'sessione';
  };
  const primaryOf = (): string => requireExcel().primary;
  // Colonne lingua dell'Excel: l'analisi automatica, corretta da ciò che il Brand sa già di questo formato.
  const profileColumns = () => {
    const report = session.analysis!;
    const columns = new Map(report.analysis.languageColumns.map(item => [item.column, item.code]));
    const changes: Array<{ column: string; header: string; code: string | null; detected: string | null }> = [];
    const headerCells = session.sheetRows[report.analysis.headerRow - 1] ?? [];
    if (session.brand && session.model) {
      for (const item of mappingFromProfile(session.brand, session.model, headerCells)) {
        const detected = columns.get(item.column) ?? null;
        if (detected === item.code) continue;
        if (item.code) columns.set(item.column, item.code); else columns.delete(item.column);
        changes.push({ column: columnLetter(item.column), header: item.header, code: item.code, detected });
      }
    }
    return { columns: [...columns].sort((a, b) => a[0] - b[0]).map(([column, code]) => ({ column, code })), changes };
  };
  const requireExcel = (): ExcelConfig => {
    if (!session.excel) throw new Error('Nessuna traduzione in uso: esegui analyze_client_excel (o load_translations) e match_selection');
    return session.excel;
  };
  const rowByNumber = (excel: ExcelConfig, row: number): ExcelRow => {
    const found = excel.rows.find(item => item.row === row);
    if (!found) throw new Error(`Riga ${row} non presente nell'Excel cliente`);
    return found;
  };
  const snapshot = async (frameIds?: string[]): Promise<FrameInfo[]> =>
    (await deps.bridge.request<{ frames: FrameInfo[] }>('snapshot', frameIds ? { frameIds } : undefined)).frames;
  // Lingue che servono davvero: quelle con almeno una traduzione (o Traduzione AI) nelle righe usate dai frame.
  // Una colonna piena solo su righe fuori selezione (es. un disclaimer) non produrrebbe export utili.
  const languageNeeds = () => {
    const excel = requireExcel();
    const primary = excel.primary;
    const usedRows = [...new Set([...session.accepted.values()].map(item => item.row))].sort((a, b) => a - b).map(row => rowByNumber(excel, row));
    const coverage: Record<string, { filled: number; of: number; missingRows: number[] }> = {};
    for (const code of Object.keys(excel.languageColumns)) {
      if (code === primary) continue;
      const filled = usedRows.filter(row => row.values[code]?.trim() || session.ai.has(`${row.row}\u0000${code}`));
      coverage[code] = { filled: filled.length, of: usedRows.length, missingRows: usedRows.filter(row => !filled.includes(row)).map(row => row.row) };
    }
    const codes = Object.keys(coverage);
    return {
      needed: [primary, ...codes.filter(code => coverage[code].filled > 0)],
      notNeeded: codes.filter(code => coverage[code].filled === 0),
      coverage
    };
  };
  const unmatchedLayers = () => session.layers.filter(layer => normalizeText(layer.text) && !session.accepted.has(layerId(layer)));
  const ref = (layer: LayerRef) => ({ frame: layer.frame, key: layer.key, text: layer.text });

  // ---------- bridge ----------
  register('bridge_status', 'Stato del collegamento con il plugin Figma Auto Fill (deve essere aperto in Figma Desktop).', {}, async () => {
    // Se la porta è di un'altra sessione Claude, se la fa cedere: lo stato riflette questa sessione.
    await deps.bridge.claim?.();
    return {
      connected: deps.bridge.connected,
      error: deps.bridge.connected ? null : deps.bridge.startError,
      hint: deps.bridge.connected ? undefined : 'Apri il plugin in Figma Desktop: Plugins → Development → Figma Auto Fill'
    };
  });

  register('get_selection', 'Frame attualmente selezionati in Figma con i livelli di testo visibili (chiave e testo).', {}, async () => {
    const frames = await snapshot();
    session.selection = frames;
    return {
      frames: frames.map(frame => ({
        id: frame.id, label: frameLabel(frame), size: `${frame.width}×${frame.height}`, managedRole: frame.managedRole ?? null,
        hiddenTextLayers: frame.hiddenTextLayers ?? 0, duplicateKeys: frame.duplicateKeys ?? [],
        textLayers: frame.textLayers.map(layer => ({ key: layer.key, text: layer.text }))
      }))
    };
  });

  // ---------- profili brand ----------
  register('list_brand_profiles', 'Elenca i Profili brand dell\'archivio del plugin (Profili di base e personali) e quello selezionato nel plugin.', {},
    async () => {
      const { profiles: list, selected } = await profiles.list();
      return { brands: list, selectedInPlugin: selected, sessionBrand: session.brand?.name ?? null };
    });

  register('get_brand_profile', 'Carica un Profilo brand (con le Aggiunte personali) e lo seleziona come Brand della sessione e nel plugin.', { name: z.string() },
    async ({ name }) => {
      const { profile, origin, additions } = await profiles.get(name);
      await profiles.select(profile.name);
      useBrand(profile, origin);
      return { ...profile, origin, hasAdditions: Boolean(additions), excelMapping: mappingNote() ?? undefined };
    });

  register('clear_brand', 'Lavora senza Brand: deseleziona il profilo nella sessione e nel plugin.', {},
    async () => {
      useBrand(null, null);
      const warning = await profiles.select(null).then(() => undefined, (error: Error) => `Plugin non aggiornato: ${error.message}`);
      return { brand: null, ...(warning ? { warning } : {}) };
    });

  register('save_brand_profile',
    'Crea un Profilo personale (basta il nome) o aggiorna un profilo esistente (i campi omessi restano invariati) e lo seleziona. Su un Profilo di base le modifiche diventano Aggiunte personali. Usalo solo dopo il sì del designer.',
    {
      name: z.string(),
      primaryLanguage: z.string().optional().describe('Lingua principale, es. IT'),
      languages: z.array(z.string()).optional().describe('Lingue e varianti abituali, es. ["IT","EN","DE","FR_CH"]'),
      naming: z.object({ template: z.string(), start: z.number().int().min(0).optional() }).optional(),
      sections: z.enum(['none', 'locale', 'base']).optional(),
      glossary: z.array(z.object({
        term: z.string(), keep: z.boolean().optional(), translations: z.record(z.string(), z.string()).optional()
      })).optional()
    },
    async input => {
      const existing = await profiles.get(input.name).then(result => result.profile).catch(() => null);
      const base = existing ?? await profiles.create(input.name);
      const fields = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && key !== 'name'));
      const merged = validateProfile({
        ...base, ...fields,
        ...(input.naming ? { naming: { template: input.naming.template, start: input.naming.start ?? base.naming?.start ?? 1 } } : {})
      });
      const saved = await profiles.save(merged);
      await profiles.select(saved.name);
      const { origin } = await profiles.get(saved.name);
      useBrand(saved, origin);
      return { ...saved, origin, created: !existing };
    });

  register('export_brand_profile', 'Esporta un Profilo brand completo (base più Aggiunte personali) in un file da condividere, passando dal plugin.',
    { name: z.string(), path: z.string().describe('Percorso del file .json di destinazione') },
    async ({ name, path }) => {
      const file = await profiles.exportFile(name);
      await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
      return { exported: path, origin: file.origin ?? null };
    });

  register('import_brand_profile',
    'Importa un file profilo nell\'archivio del plugin. Se il nome è di un Profilo di base le novità diventano Aggiunte personali; se risponde "choose" chiedi al designer (merge/replace oppure replace/rename) e richiama con mode o rename.',
    {
      path: z.string(),
      mode: z.enum(['merge', 'replace']).optional(),
      overwrite: z.boolean().optional().describe('Compatibilità: equivale a mode="replace"'),
      rename: z.string().optional()
    },
    async ({ path, mode, overwrite, rename }) => {
      let file: unknown;
      try { file = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { throw new Error(`File profilo non leggibile (${path}): ${(error as Error).message}`); }
      const result = await profiles.importFile(file, { mode: mode ?? (overwrite ? 'replace' : undefined), rename });
      if (result.status === 'imported') {
        await profiles.select(result.name);
        useBrand(result.profile, result.as === 'additions' ? 'base' : 'personal');
      }
      return result;
    });

  // Correzioni della mappatura che vengono dal Brand: da mostrare al designer insieme alla mappatura da confermare.
  const mappingNote = () => {
    if (!session.analysis || !session.brand) return null;
    const { columns, changes } = profileColumns();
    return changes.length ? {
      from: session.brand.name, changes,
      languages: columns.map(item => ({ column: columnLetter(item.column), code: item.code })),
      hint: `Mappatura corretta con il Modello Excel di ${session.brand.name}: mostrala al designer. match_selection la usa se non passi languages.`
    } : null;
  };

  // Analisi comune a un Excel cliente e alle traduzioni dalla chat: lingue, Brand, Colonna sorgente provvisoria.
  const analyzeSource = async (input: { path: string; original: string; sheets: SheetData[]; sheet?: string; brand?: string; inline: boolean }) => {
    const { path, original, sheets, sheet, brand, inline } = input;
    const warnings: string[] = [];
    let archive: { profiles: Array<BrandProfile & { origin: ProfileOrigin }>; selected: string | null } | null = null;
    try { archive = await profiles.all(); }
    catch (error) { warnings.push(`Profili brand non disponibili (${(error as Error).message}): si lavora senza Brand`); }
    if (brand) {
      const found = archive?.profiles.find(item => item.name.toLowerCase() === brand.trim().toLowerCase());
      if (!found) throw new Error(`Profilo brand "${brand}" non trovato.${archive?.profiles.length ? ` Disponibili: ${archive.profiles.map(item => item.name).join(', ')}.` : ''}`);
      await profiles.select(found.name);
      useBrand(found, found.origin);
    }
    const hint = session.brand?.primaryLanguage;
    const report = analyzeWorkbook(path, sheets, { sheet, primary: hint ?? FALLBACK_PRIMARY, profileLanguages: session.brand?.languages });
    if (!report.sourceColumn && report.analysis.languageColumns.length) {
      const first = report.analysis.languageColumns[0];
      report.sourceColumn = { column: first.column, letter: first.letter, code: first.code };
    }
    report.warnings = [...report.warnings.filter(item => !item.startsWith('Nessuna colonna per la lingua principale')), ...warnings];
    const rows = sheets.find(item => item.name === report.analysis.sheet)?.rows ?? [];
    session.analysis = report;
    session.original = inline ? null : original;
    session.inlineSheet = inline ? sheets[0] : null;
    session.sheetRows = rows;
    // Una tabella dalla chat non è il formato del cliente: niente Modello Excel né riconoscimento del Brand.
    session.model = !inline && report.analysis.headerRow ? extractExcelModel({
      sheet: report.analysis.sheet, headerRow: report.analysis.headerRow, rows,
      languageColumns: report.analysis.languageColumns, idColumn: report.analysis.idColumn, sourceColumn: report.sourceColumn?.column
    }) : null;
    session.excel = null; session.match = null; session.accepted.clear(); session.generated = null; session.ai.clear(); session.usedSettings = null;
    session.recognition = session.model && archive ? recognize(session.model, archive.profiles) : { outcome: 'none', candidates: [] };

    const selected = archive?.selected ? archive.profiles.find(item => item.name === archive!.selected) ?? null : null;
    const top = session.recognition.candidates[0];
    let decision: 'chosen' | 'use-selected' | 'confirm-candidate' | 'choose-candidate' | 'discrepancy' | 'no-brand';
    let next: string;
    if (brand) {
      decision = top && top.name !== session.brand!.name ? 'discrepancy' : 'chosen';
      next = decision === 'discrepancy'
        ? `Il designer ha indicato ${session.brand!.name}, ma questo Excel somiglia a ${top.name}: fai notare la differenza e chiedi quale usare.`
        : `Brand ${session.brand!.name} in uso.`;
    } else if (selected && top && top.name !== selected.name) {
      decision = 'discrepancy';
      useBrand(null, null);
      next = `Nel plugin è selezionato ${selected.name}, ma questo Excel somiglia a ${session.recognition.candidates.map(item => item.name).join(' / ')}: fai notare la differenza e chiedi quale usare (get_brand_profile), oppure se lavorare senza Brand.`;
    } else if (selected) {
      decision = 'use-selected';
      useBrand(selected, selected.origin);
      next = top
        ? `Uso ${selected.name}, selezionato nel plugin e riconosciuto dall'Excel.`
        : `Uso ${selected.name}, selezionato nel plugin.${selected.excelModels.length ? ' L\'Excel però non somiglia al suo Modello Excel: dillo in una riga.' : ''}`;
    } else if (session.recognition.outcome === 'clear') {
      decision = 'confirm-candidate';
      next = `Questo Excel sembra di ${top.name}: chiedi conferma al designer e, se sì, chiama get_brand_profile.`;
    } else if (session.recognition.outcome === 'ambiguous') {
      decision = 'choose-candidate';
      next = `Questo Excel somiglia a più Brand (${session.recognition.candidates.map(item => item.name).join(', ')}): elencali e fai scegliere, o prosegui senza Brand.`;
    } else if (inline) {
      decision = 'no-brand';
      next = 'Nessun Brand selezionato: chiedi in una riga se il designer vuole usarne uno (list_brand_profiles), altrimenti prosegui senza.';
    } else {
      decision = 'no-brand';
      next = 'Excel nuovo, non somiglia a nessun profilo: dillo in una riga e prosegui senza Brand. Alla fine proponi di salvarlo come reference (pending_profile_updates).';
    }
    return {
      ...report,
      sourceColumnNote: 'Colonna sorgente provvisoria: match_selection la sceglie dai testi che coincidono con Figma.',
      brand: {
        sessionBrand: session.brand?.name ?? null, selectedInPlugin: selected?.name ?? null,
        recognition: session.recognition, decision, next
      },
      profileDifferences: session.brand ? profileDifferences(session.brand, session.model, report.analysis.languageColumns.map(item => item.code)) : null,
      profileMapping: inline ? null : mappingNote()
    };
  };

  // ---------- Excel cliente ----------
  register('analyze_client_excel',
    'Analizza un Excel cliente (struttura libera), indicato con path o, se è un allegato della chat, con file_name: fogli, colonne lingua con codice normalizzato, colonne ignorate e Colonna sorgente provvisoria. Riconosce il Brand dal Modello Excel (blocco "brand", da far confermare) e riporta le differenze con il profilo come informazione. Non richiede un Brand.',
    {
      path: z.string().optional().describe('Percorso dell\'Excel sul Mac del designer (anche ~/...)'),
      file_name: z.string().optional().describe('Solo il nome del file (es. Traduzioni.xlsx) quando l\'Excel è allegato alla chat: il server lo cerca in Download, Scrivania e Documenti'),
      sheet: z.string().optional(), brand: z.string().optional().describe('Brand indicato dal designer, se lo nomina')
    },
    async ({ path: requested, file_name, sheet, brand }) => {
      const original = await resolveExcelPath({ path: requested, fileName: file_name }, deps.excelSearchRoots ?? DEFAULT_SEARCH_ROOTS);
      const path = deps.workingCopies ? await deps.workingCopies.take(original) : original;
      const report = await analyzeSource({ path, original, sheets: await readSheets(path), sheet, brand, inline: false });
      return {
        ...report,
        path: original,
        workingCopy: path !== original
          ? { path, note: 'Copia temporanea in excel-clienti/: si elimina a fine sessione. L\'originale non viene toccato.' }
          : undefined
      };
    });

  register('load_translations',
    'Carica le traduzioni che il designer ha scritto in chat o allegato (Excel, CSV, PDF, Word, immagine...) senza passare da un file sul suo Mac: leggi tu il contenuto e passalo come tabella. Prima riga = intestazioni: codici o nomi di lingua (IT, EN, EN_GB, Deutsch...), più eventuali colonne ID o note; ogni riga successiva = un testo nelle varie lingue. Poi si prosegue come con un Excel cliente (match_selection, generate_exports), ma senza Excel aggiornato.',
    {
      table: z.array(z.array(z.union([z.string(), z.number()]).nullable())).min(2)
        .describe('Righe della tabella; la prima contiene le intestazioni di colonna'),
      source_name: z.string().optional().describe('Da dove vengono i testi, es. il nome del file allegato o "chat"'),
      brand: z.string().optional().describe('Brand indicato dal designer, se lo nomina')
    },
    async ({ table, source_name, brand }) => {
      const width = Math.max(...table.map(row => row.length));
      const rows = table.map(row => Array.from({ length: width }, (_, index) => String(row[index] ?? '').trim()));
      const name = source_name?.trim() || 'chat';
      const report = await analyzeSource({ path: name, original: name, sheets: [{ name: 'Traduzioni', rows }], brand, inline: true });
      if (!report.analysis.languageColumns.length) {
        throw new Error(`Nessuna colonna lingua riconosciuta nelle intestazioni (${rows[0].filter(Boolean).join(', ')}): usa codici come IT, EN, EN_GB`);
      }
      return { ...report, source: name, note: 'Traduzioni dalla chat: niente file sul Mac, quindi niente Excel aggiornato (salta write_updated_excel).' };
    });

  register('match_selection',
    'Abbina i livelli di testo dei frame selezionati alle righe dell\'Excel cliente. Restituisce esatti, simili (da confermare), Livelli orfani e Celle multi-livello. Dopo la conferma delle lingue, passa le colonne confermate (altrimenti si usano quelle proposte).',
    {
      source_column: z.string().optional().describe('Colonna sorgente, es. "C" (default: scelta dai testi che coincidono con Figma)'),
      source_language: z.string().optional().describe('Lingua della Colonna sorgente, se non è una colonna lingua riconosciuta'),
      languages: z.array(z.object({ column: z.string(), code: z.string() })).optional().describe('Mappatura confermata colonna → codice lingua'),
      threshold: z.number().min(0.5).max(0.99).optional().describe(`Soglia di similarità (default ${DEFAULT_SIMILARITY_THRESHOLD})`)
    },
    async ({ source_column, source_language, languages, threshold }) => {
      const report = session.analysis;
      if (!report) throw new Error('Esegui prima analyze_client_excel o load_translations');
      const languageColumns: Record<string, number> = {};
      if (languages) {
        for (const item of languages) languageColumns[normalizeLanguage(item.code)] = columnNumber(item.column);
      } else {
        for (const item of profileColumns().columns) if (!(item.code in languageColumns)) languageColumns[item.code] = item.column;
      }
      const inline = session.inlineSheet;
      const sheet: SheetData | undefined = inline ?? (await readSheets(report.path)).find(item => item.name === report.analysis.sheet);
      if (!sheet) throw new Error(`Foglio "${report.analysis.sheet}" non più presente nel file`);
      const { headerRow, idColumn } = report.analysis;

      const frames = await snapshot();
      if (!frames.length) throw new Error('Nessun frame selezionato: seleziona i frame in Figma e riprova');
      session.selection = frames;
      const everyLayer = frames.flatMap(frame => frame.textLayers.map(layer => ({
        frameId: frame.id, frame: frameLabel(frame), key: layer.key, text: layer.text, markup: layer.markup
      })));
      const known = knowledge();
      const excluded = everyLayer.filter(layer => isIgnoredLayer(layer, known.ignoredLayers));
      session.layers = everyLayer.filter(layer => !excluded.includes(layer));

      // Colonna sorgente: quella i cui testi coincidono con i livelli Figma. La lingua principale del profilo pesa solo a parità.
      const layerTexts = new Set(session.layers.map(layer => normalizeText(layer.text)).filter(Boolean));
      const dataRows = sheet.rows.slice(headerRow);
      const matching = (column: number) => new Set(dataRows.map(cells => normalizeText(cells[column - 1] ?? '')).filter(text => text && layerTexts.has(text))).size;
      const profilePrimary = session.brand?.primaryLanguage;
      let sourceColumn: number;
      let reason: 'indicata' | 'dati' | 'profilo' | 'provvisoria';
      if (source_column) {
        sourceColumn = columnNumber(source_column);
        reason = 'indicata';
      } else {
        const ranked = Object.entries(languageColumns).map(([code, column]) => ({ code, column, count: matching(column) }))
          .sort((a, b) => b.count - a.count || Number(b.code === profilePrimary) - Number(a.code === profilePrimary));
        if (ranked[0]?.count) { sourceColumn = ranked[0].column; reason = 'dati'; }
        else if (report.sourceColumn) { sourceColumn = report.sourceColumn.column; reason = profilePrimary ? 'profilo' : 'provvisoria'; }
        else throw new Error('Colonna sorgente non determinata: indica source_column');
      }
      const columnCode = Object.entries(languageColumns).find(([, column]) => column === sourceColumn)?.[0];
      const primary = source_language ? normalizeLanguage(source_language) : columnCode ?? profilePrimary;
      if (!primary) throw new Error(`Non so in che lingua è la colonna ${columnLetter(sourceColumn)}: indica source_language`);
      for (const [code, column] of Object.entries(languageColumns)) if (column === sourceColumn && code !== primary) delete languageColumns[code];
      languageColumns[primary] = sourceColumn;

      const rows: ExcelRow[] = [];
      sheet.rows.forEach((cells, index) => {
        if (index + 1 <= headerRow) return;
        const values = Object.fromEntries(Object.entries(languageColumns).map(([code, column]) => [code, cells[column - 1] ?? '']));
        if (Object.values(values).every(value => !value.trim())) return;
        rows.push({ row: index + 1, id: idColumn ? (cells[idColumn - 1] ?? '').trim() || undefined : undefined, source: values[primary] ?? '', values });
      });
      session.excel = { path: report.path, original: session.original ?? report.path, inline: Boolean(inline), sheet: sheet.name, headerRow, idColumn, sourceColumn, primary, languageColumns, rows, lastRow: sheet.rows.length };
      session.model = inline ? null : extractExcelModel({
        sheet: sheet.name, headerRow, rows: sheet.rows, idColumn, sourceColumn,
        languageColumns: Object.entries(languageColumns).map(([code, column]) => ({ code, column }))
      });

      const result = matchLayers({ layers: session.layers, rows, confirmed: known.confirmedMatches, threshold });
      session.match = result;
      session.accepted = new Map(result.exact.map(item => [layerId(item.layer), item]));
      session.generated = null; session.ai.clear();

      const warnings: string[] = [];
      for (const frame of frames) {
        if (frame.managedRole === 'locale') warnings.push(`${frameLabel(frame)}: è un export, seleziona il MASTER o il frame sorgente`);
        for (const duplicate of frame.duplicateKeys ?? []) warnings.push(`${frameLabel(frame)}: livelli "${duplicate.name}" duplicati, rinominati ${duplicate.keys.join(', ')}`);
      }
      if (result.multiLevel.length) warnings.push(`${result.multiLevel.length} Celle multi-livello: non abbinate, vanno sistemate dal designer`);
      if (result.staleConfirmed.length) warnings.push(`${result.staleConfirmed.length} Abbinamenti confermati non più validi (riga assente nell'Excel): ignorati`);
      const differsFromProfile = Boolean(profilePrimary && primary !== profilePrimary);
      if (differsFromProfile) warnings.push(`Colonna sorgente ${columnLetter(sourceColumn)} (${primary}) diversa dalla lingua principale del profilo (${profilePrimary}): vale l'Excel`);
      const mapping = languages ? null : mappingNote();
      return {
        ...(mapping ? { profileMapping: mapping } : {}),
        sourceChoice: {
          column: columnLetter(sourceColumn), language: primary, reason, matchingTexts: matching(sourceColumn),
          profilePrimaryLanguage: profilePrimary ?? null, differsFromProfile
        },
        summary: {
          layers: session.layers.length, exact: result.exact.length, similar: result.similar.length,
          orphans: result.orphans.length, multiLevel: result.multiLevel.length, emptyLayersSkipped: result.skippedEmpty,
          excluded: excluded.length
        },
        columns: { source: columnLetter(sourceColumn), languages: Object.fromEntries(Object.entries(languageColumns).map(([code, column]) => [code, columnLetter(column)])) },
        exact: result.exact.map(item => ({ ...ref(item.layer), row: item.row, via: item.via })),
        similar: result.similar.map(item => ({ ...ref(item.layer), row: item.row, score: item.score, excelText: item.rowText })),
        orphans: result.orphans.map(item => ({ ...ref(item.layer), reason: item.reason, row: item.row })),
        excluded: excluded.map(ref),
        orphansHint: result.orphans.length
          ? 'Se alcuni orfani sono livelli di contorno (To:, Reply to:, data, logo) proponi al designer di escluderli con exclude_layers, poi richiama match_selection.'
          : undefined,
        multiLevel: result.multiLevel.map(cell => ({ row: cell.row, text: cell.text, layers: cell.layers.map(ref) })),
        languages: languageNeeds(),
        languagesHint: 'Proponi al designer solo le lingue in languages.needed; quelle in notNeeded hanno traduzioni solo in righe fuori dai frame selezionati.',
        warnings
      };
    });

  register('confirm_matches',
    'Registra le decisioni del designer sul riepilogo: accetta abbinamenti simili ("all" o elenco), assegna manualmente un livello a una riga. Gli abbinamenti confermati vengono ricordati nel Profilo brand (remember), o nella sessione se non c\'è Brand.',
    {
      accept_similar: z.union([z.literal('all'), z.array(z.object({ frame: z.string(), key: z.string() }))]).optional(),
      assign: z.array(z.object({ frame: z.string(), key: z.string(), row: z.number().int() })).optional(),
      remember: z.boolean().optional()
    },
    async ({ accept_similar, assign, remember }) => {
      const excel = requireExcel();
      const match = session.match;
      if (!match) throw new Error('Esegui prima match_selection');
      const confirmedNow: Array<{ layer: LayerRef; row: number }> = [];
      for (const item of match.similar) {
        const chosen = accept_similar === 'all' || (Array.isArray(accept_similar) && accept_similar.some(entry => entry.frame === item.layer.frame && entry.key === item.layer.key));
        if (chosen) confirmedNow.push({ layer: item.layer, row: item.row });
      }
      for (const entry of assign ?? []) {
        const layer = session.layers.find(item => item.frame === entry.frame && item.key === entry.key);
        if (!layer) throw new Error(`Livello non trovato: ${entry.frame} / ${entry.key}`);
        rowByNumber(excel, entry.row);
        confirmedNow.push({ layer, row: entry.row });
      }
      for (const item of confirmedNow) session.accepted.set(layerId(item.layer), item);
      let saved = 0;
      let rememberedIn: 'profilo brand' | 'sessione' | null = null;
      if (remember !== false && (confirmedNow.length || match.staleConfirmed.length)) {
        const stale = new Set(match.staleConfirmed.map(item => item.source));
        const fresh = confirmedNow.map(item => {
          const row = rowByNumber(excel, item.row);
          return { source: normalizeText(item.layer.text), rowId: row.id, rowSource: normalizeText(row.source) };
        });
        const replaced = new Set(fresh.map(item => item.source));
        const confirmedMatches = [...knowledge().confirmedMatches.filter(item => !stale.has(item.source) && !replaced.has(item.source)), ...fresh];
        rememberedIn = await learn({ confirmedMatches });
        saved = fresh.length;
      }
      return {
        matched: session.accepted.size,
        orphans: unmatchedLayers().map(ref),
        languages: languageNeeds(),
        rememberedInBrandProfile: rememberedIn === 'profilo brand' ? saved : 0,
        rememberedIn
      };
    });

  register('exclude_layers',
    'Aggiunge o toglie livelli di contorno (To:, Reply to:, data, logo) che non vanno tradotti. Le voci restano nel Profilo brand e valgono anche nelle campagne successive (senza Brand valgono per la sessione). Una voce è il nome o il testo del livello; con prefisso "re:" è un\'espressione regolare. Richiama match_selection dopo la modifica.',
    { add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() },
    async ({ add, remove }) => {
      const lower = (value: string) => value.trim().toLowerCase();
      const removed = new Set((remove ?? []).map(lower));
      const kept = knowledge().ignoredLayers.filter(item => !removed.has(lower(item)));
      const merged = [...kept];
      for (const item of add ?? []) if (!merged.some(existing => lower(existing) === lower(item))) merged.push(item.trim());
      if (merged.some(item => item.startsWith('re:'))) validateProfile({ name: 'verifica', ignoredLayers: merged });
      const savedIn = await learn({ ignoredLayers: merged });
      session.match = null; session.accepted.clear(); session.generated = null;
      return { ignoredLayers: knowledge().ignoredLayers, savedIn, next: 'Richiama match_selection per aggiornare l\'abbinamento.' };
    });

  // ---------- generazione in Figma ----------
  register('generate_exports',
    'Fa generare al plugin le varianti linguistiche in EXPORT per i frame selezionati. Senza language_suffix o section_mode risponde "confirm-settings" con gli esempi di nome: chiedi al designer con AskUserQuestion e richiama passando le risposte. Se esistono già export con gli stessi nomi risponde "conflict": chiedi se sostituire o creare una nuova versione e richiama con on_conflict.',
    {
      languages: z.array(z.string()).optional().describe('Lingue da generare (default: quelle con traduzioni nelle righe usate dai frame, vedi languages.needed)'),
      on_conflict: z.enum(['replace', 'version']).optional(),
      language_suffix: z.enum(['lang', 'lang-country']).optional()
        .describe('Suffisso del nome: lang = solo lingua (EN_GB → EN) quando la lingua non ha altre varianti tra quelle generate; lang-country = codice completo (EN_GB)'),
      section_mode: z.enum(['none', 'locale', 'base']).optional()
        .describe('Section degli export: locale = una per lingua-paese (en_gb/), base = una per lingua (en/, con le sue varianti), none = nessuna')
    },
    async ({ languages, on_conflict, language_suffix, section_mode }) => {
      const brand = session.brand;
      const excel = requireExcel();
      const frames = session.selection;
      if (!frames || !session.match) throw new Error('Esegui prima match_selection');
      if (!session.accepted.size) throw new Error('Nessun livello abbinato: controlla Colonna sorgente e frame selezionati');
      const primary = excel.primary;
      const targets = [...new Set([primary, ...(languages ?? languageNeeds().needed).map(normalizeLanguage)])];
      if (targets.length === 1) throw new Error('Nessuna traduzione nelle righe usate dai frame: controlla le colonne lingua o passa languages');

      const rows: TranslationRow[] = session.layers.map(layer => {
        const accepted = session.accepted.get(layerId(layer));
        const values: Record<string, string> = { [primary]: layer.markup };
        if (accepted) {
          const row = rowByNumber(excel, accepted.row);
          for (const code of targets) {
            if (code === primary) continue;
            const cell = row.values[code]?.trim() ? row.values[code] : session.ai.get(`${row.row}\u0000${code}`)?.text ?? '';
            if (cell.trim()) values[code] = cellToMarkup(cell);
          }
        }
        return { frame: layer.frame, key: layer.key, translate: Boolean(accepted), values };
      });
      const errors = validateRows(rows, frames, targets, primary);
      if (errors.length) throw new Error(errors.join('\n'));

      // Quello che il designer ha compilato nella UI del plugin (modello del nome, nomi base, section) ha la precedenza
      // sui default del Profilo brand; con plugin più vecchi senza stato UI si ripiega sul profilo.
      const ui = await deps.bridge.request<UiState>('ui-state').catch(() => null);
      const fromPlugin = Boolean(ui?.naming.template.trim()) && Number.isInteger(ui?.naming.start);
      const naming = fromPlugin
        ? { template: ui!.naming.template, start: ui!.naming.start, date: ui!.naming.date || todayStamp(now()) }
        : { ...profileNaming(brand), date: todayStamp(now()) };
      // Incongruenza: il plugin ha lingue selezionate diverse da quelle che servono. Non si sceglie in silenzio.
      const pluginTargets = new Set([...(ui?.targets ?? []), primary]);
      if (!languages && ui?.targets.length && (pluginTargets.size !== targets.length || targets.some(code => !pluginTargets.has(code)))) {
        return {
          status: 'confirm-languages',
          message: 'Le lingue selezionate nel plugin non coincidono con quelle che servono per i frame (traduzioni presenti nelle righe usate). Chiedi al designer quali generare, poi richiama generate_exports passando languages.',
          pluginLanguages: [...pluginTargets],
          neededLanguages: targets
        };
      }
      const frameIds = frames.map(frame => frame.id);
      const baseNames = Object.fromEntries(frames.map(frame => [frame.id, ui?.baseNames[frame.id]?.trim() || frame.baseName]));
      const suggestedSections = ui?.sectionMode ?? brand?.sections ?? 'none';
      // Il suffisso conta solo se qualche lingua ha un paese: con EN, DE, FR i due modi danno gli stessi nomi.
      const suffixMatters = targets.some(code => code.includes('_'));
      if ((suffixMatters && !language_suffix) || !section_mode) {
        const sample = frames[0];
        const context = { name: baseNames[sample.id], index: 0, count: frames.length, width: sample.width ?? 0, height: sample.height ?? 0 };
        const names = (suffix: LanguageSuffix) => targets.map(code =>
          renderOutputName(context, code, { ...naming, shortLanguages: shortLanguages(targets, suffix) }));
        const kept = targets.filter(code => code.includes('_') && !shortLanguages(targets, 'lang').includes(code));
        return {
          status: 'confirm-settings',
          message: 'Prima di generare chiedi al designer, con AskUserQuestion e una domanda per ciascun punto in "questions", le impostazioni mancanti. Mostra gli esempi nelle opzioni. Poi richiama generate_exports con language_suffix e section_mode (e languages se le avevi passate).',
          questions: [
            ...(suffixMatters && !language_suffix ? [{
              param: 'language_suffix',
              question: 'Vuoi usare Lang o Lang-Country come suffisso?',
              options: [
                { value: 'lang', label: 'Lang', example: names('lang'), recommended: true,
                  note: kept.length ? `${kept.join(', ')} restano con il paese: la stessa lingua ha più varianti` : undefined },
                { value: 'lang-country', label: 'Lang-Country', example: names('lang-country') }
              ]
            }] : []),
            ...(!section_mode ? [{
              param: 'section_mode',
              question: 'Gli export li vuoi dentro una section?',
              options: [
                { value: 'locale', label: 'Sì, divise per country', example: [...new Set(targets.map(code => `${code.toLowerCase()}/`))] },
                { value: 'base', label: 'Sì, divise per lang', example: [...new Set(targets.map(code => `${code.split('_')[0].toLowerCase()}/`))] },
                { value: 'none', label: 'No' }
              ].map(option => ({ ...option, recommended: option.value === suggestedSections || undefined }))
            }] : [])
          ]
        };
      }
      const suffix: LanguageSuffix = language_suffix ?? 'lang';
      const finalNaming: NamingOptions = { ...naming, shortLanguages: shortLanguages(targets, suffix) };
      const base = { frameIds, targets, primary, baseNames, naming: finalNaming };
      const sectionMode = section_mode;
      const plan = await deps.bridge.request<{ replacements: Array<{ id: string; name: string; language: string }> }>('plan', base);
      if (plan.replacements.length && !on_conflict) {
        return {
          status: 'conflict',
          message: 'Esistono già export con questi nomi. Chiedi al designer: sostituirli (replace) o creare una nuova versione _v2, _v3 (version).',
          existing: plan.replacements.map(item => ({ name: item.name, language: item.language }))
        };
      }
      const replace = on_conflict === 'replace' && plan.replacements.length > 0;
      const result = await deps.bridge.request<{ names: string[]; warnings: string[] }>('generate', {
        kind: 'generate', ...base, rows,
        sectionMode,
        collisionMode: replace ? 'replace' : 'version',
        confirmedReplacementIds: replace ? plan.replacements.map(item => item.id) : []
      }, 300_000);
      session.generated = { frameIds, languages: targets, rows };
      session.usedSettings = { naming: { template: naming.template, start: naming.start }, sections: sectionMode, languages: targets };
      const fallbacks = result.warnings.filter(item => / usato /.test(item)).length;
      const differences = brand ? settingsDifferences(brand, session.usedSettings) : [];
      return {
        status: 'done', created: result.names, fallbackCells: fallbacks, warnings: result.warnings,
        usedSettings: { source: fromPlugin ? 'plugin' : brand ? 'profilo brand' : 'default', nameTemplate: naming.template, languageSuffix: suffix, baseNames: base.baseNames, sectionMode },
        profileSuggestion: differences.length
          ? `Impostazioni diverse da ${brand!.name}: ${differences.join('; ')}. A fine sessione chiedi in una riga se ricordarle (pending_profile_updates).`
          : undefined
      };
    });

  // ---------- Excel aggiornato ----------
  register('write_updated_excel',
    'Scrive la copia <nome>_updated.xlsx con i testi effettivamente usati in Figma (correzioni manuali incluse), i Livelli orfani in coda e le eventuali Traduzioni AI. L\'originale non viene toccato; le celle già piene non si sovrascrivono senza conferma (overwrite).',
    {
      output_path: z.string().optional(),
      overwrite: z.array(z.object({ row: z.number().int(), language: z.string() })).optional().describe('Celle piene che il designer ha confermato di sovrascrivere'),
      only_used_rows: z.boolean().optional().describe('Default true: la copia contiene solo le righe usate dai frame. false = tutte le righe del cliente'),
      add_orphans: z.boolean().optional().describe('Default false: aggiunge in coda i Livelli orfani. Solo se il designer lo chiede')
    },
    async ({ output_path, overwrite, only_used_rows, add_orphans }) => {
      const excel = requireExcel();
      if (excel.inline) throw new Error('Le traduzioni vengono dalla chat (load_translations): non c\'è un Excel cliente da aggiornare');
      const figma = session.generated ? await snapshot(session.generated.frameIds) : [];
      const plan = planUpdates({
        rows: excel.rows, languageColumns: excel.languageColumns, primary: excel.primary, sourceColumn: excel.sourceColumn,
        matches: [...session.accepted.values()], orphans: add_orphans ? unmatchedLayers() : [],
        generated: session.generated?.rows ?? [], figma, ai: [...session.ai.values()],
        overwrite: (overwrite ?? []).map(item => ({ row: item.row, language: normalizeLanguage(item.language) })), lastRow: excel.lastRow
      });
      const output = output_path ?? defaultOutputPath(excel.original);
      const usedRows = [...new Set([...session.accepted.values()].map(item => item.row))];
      const { removedRows } = await writeUpdatedWorkbook({
        input: excel.path, output, sheet: excel.sheet, plan, idColumn: excel.idColumn,
        keepRows: only_used_rows === false ? undefined : usedRows, headerRow: excel.headerRow,
        // si rigenera solo una copia scritta da noi (in questa sessione o riconosciuta dal marcatore), mai un altro file
        allowOverwrite: session.writtenOutputs.has(resolve(output)) || await isGeneratedCopy(output)
      });
      session.writtenOutputs.add(resolve(output));
      const notAdded = add_orphans ? [] : unmatchedLayers();
      return {
        output,
        rows: { kept: usedRows.length, removed: removedRows, onlyUsedRows: only_used_rows !== false,
          note: removedRows ? 'Le righe sono state rinumerate nella copia; i numeri nella lista "written" sono quelli dell\'Excel originale.' : undefined },
        orphansNotAdded: notAdded.length ? notAdded.map(ref) : undefined,
        written: plan.writes.map(item => ({ row: item.row, column: columnLetter(item.column), language: item.language, source: item.source, text: item.text })),
        addedRows: plan.newRows.map(item => ({ row: item.row, id: item.id })),
        conflicts: plan.conflicts,
        note: plan.conflicts.length
          ? 'Alcune celle piene differiscono da Figma e non sono state toccate: mostra i conflitti al designer e richiama con overwrite per quelle confermate.'
          : undefined
      };
    });

  // ---------- Traduzione AI (solo su richiesta) ----------
  register('list_empty_cells',
    'Celle vuote delle righe abbinate, con testo sorgente e Glossario brand pertinente. Usale SOLO se il designer ha chiesto la Traduzione AI.',
    {},
    async () => {
      const excel = requireExcel();
      const glossaryEntries = knowledge().glossary;
      const rows = [...new Set([...session.accepted.values()].map(item => item.row))];
      const cells = rows.flatMap(rowNumber => {
        const row = rowByNumber(excel, rowNumber);
        return Object.keys(excel.languageColumns).filter(code => code !== excel.primary).flatMap(code => {
          if (row.values[code]?.trim() || session.ai.has(`${rowNumber}\u0000${code}`)) return [];
          const glossary = glossaryEntries
            .filter(entry => row.source.toLowerCase().includes(entry.term.toLowerCase()))
            .map(entry => ({ term: entry.term, keep: entry.keep, translation: entry.translations[code] }));
          return [{ row: rowNumber, language: code, source: row.source, glossary }];
        });
      });
      return {
        count: cells.length, primaryLanguage: excel.primary, cells,
        glossaryNote: session.brand ? undefined : 'Nessun Brand: non c\'è un Glossario brand da rispettare'
      };
    });

  register('save_ai_translations',
    'Salva le Traduzioni AI già riviste dal designer. Verranno usate da generate_exports e scritte (con fonte "ai") da write_updated_excel solo nelle celle vuote.',
    { translations: z.array(z.object({ row: z.number().int(), language: z.string(), text: z.string().min(1) })) },
    async ({ translations }) => {
      const excel = requireExcel();
      for (const item of translations) {
        const language = normalizeLanguage(item.language);
        const row = rowByNumber(excel, item.row);
        if (!(language in excel.languageColumns) || language === primaryOf()) throw new Error(`Lingua non traducibile: ${item.language}`);
        if (row.values[language]?.trim()) throw new Error(`Riga ${item.row} / ${language}: la cella non è vuota`);
        session.ai.set(`${item.row}\u0000${language}`, { row: item.row, language, text: item.text });
      }
      return { saved: translations.length, total: session.ai.size, next: 'Rilancia generate_exports e write_updated_excel per applicarle.' };
    });

  // ---------- reference di fine sessione ----------
  const pending = () => {
    const excel = session.excel;
    const model = session.model;
    if (!model) return null;
    const excelLanguages = excel ? Object.keys(excel.languageColumns) : (session.analysis?.analysis.languageColumns.map(item => item.code) ?? []);
    if (!session.brand) {
      return {
        mode: 'create' as const,
        suggestedName: suggestedProfileName(session.original ?? 'Nuovo profilo'),
        includes: {
          excelModel: { sheet: model.sheet, headers: model.headers.length, recurringLabels: model.labels.length },
          primaryLanguage: excel?.primary ?? null,
          languages: [...new Set([...excelLanguages, ...(session.usedSettings?.languages ?? [])])],
          naming: session.usedSettings?.naming ?? null, sections: session.usedSettings?.sections ?? null,
          ignoredLayers: session.scratch.ignoredLayers.length, confirmedMatches: session.scratch.confirmedMatches.length
        }
      };
    }
    const brand = session.brand;
    const closest = closestModelIndex(brand, model);
    const excelModel = !brand.excelModels.length ? 'nuovo'
      : closest < 0 ? 'nuovo formato (si aggiunge a quelli noti)'
        : modelChanged(brand.excelModels[closest], model) ? 'aggiornato' : null;
    const newLanguages = [...new Set([...excelLanguages, ...(session.usedSettings?.languages ?? [])])].filter(code => !knownLanguage(brand, code));
    const settings = session.usedSettings ? settingsDifferences(brand, session.usedSettings) : [];
    return { mode: 'update' as const, brand: brand.name, origin: session.brandOrigin, changes: { excelModel, newLanguages, settings } };
  };

  register('pending_profile_updates',
    'A fine sessione: che cosa si potrebbe ricordare. Senza Brand propone di salvare l\'Excel come nuovo Profilo personale (suggestedName); con un Brand elenca le novità (Modello Excel, lingue, impostazioni diverse). Non salva nulla: chiedi al designer.',
    {},
    async () => {
      const result = pending();
      if (!result) {
        return { mode: 'none', message: session.inlineSheet ? 'Traduzioni dalla chat: nessun Modello Excel da ricordare' : 'Nessun Excel analizzato in questa sessione' };
      }
      if (result.mode === 'update' && !result.changes.excelModel && !result.changes.newLanguages.length && !result.changes.settings.length) {
        return { mode: 'none', brand: result.brand, message: 'Nessuna novità rispetto al profilo' };
      }
      return result;
    });

  register('apply_profile_updates',
    'Salva le proposte di pending_profile_updates DOPO il sì del designer. Senza Brand crea un Profilo personale con nome name (Modello Excel, lingue, impostazioni usate, Livelli esclusi e Abbinamenti confermati della sessione). Con un Brand aggiorna solo le parti indicate; su un Profilo di base diventano Aggiunte personali.',
    {
      name: z.string().optional().describe('Nome del nuovo profilo (obbligatorio senza Brand)'),
      excel_model: z.boolean().optional().describe('Default true: ricorda il Modello Excel'),
      languages: z.boolean().optional().describe('Default true: aggiunge le lingue nuove'),
      settings: z.boolean().optional().describe('Default false: ricorda modello del nome e section usati')
    },
    async ({ name, excel_model, languages, settings }) => {
      const result = pending();
      if (!result || !session.model) throw new Error('Nessun Excel analizzato in questa sessione');
      const model = session.model;
      const used = session.usedSettings;
      if (result.mode === 'create') {
        const profileName = (name ?? '').trim();
        if (!profileName) throw new Error('Indica il nome del nuovo profilo (name)');
        await profiles.create(profileName);
        const saved = await profiles.save(validateProfile({
          name: profileName,
          primaryLanguage: session.excel?.primary,
          languages: result.includes.languages,
          ...(used ? { naming: used.naming, sections: used.sections } : {}),
          ignoredLayers: session.scratch.ignoredLayers,
          confirmedMatches: session.scratch.confirmedMatches,
          excelModels: [model]
        }));
        await profiles.select(saved.name);
        useBrand(saved, 'personal');
        session.scratch = { ignoredLayers: [], confirmedMatches: [] };
        return { created: saved.name, profile: saved };
      }
      const brand = session.brand!;
      const next: BrandProfile = { ...brand, excelModels: [...brand.excelModels], languages: [...brand.languages] };
      const applied: string[] = [];
      if (excel_model !== false && result.changes.excelModel) {
        const index = closestModelIndex(brand, model);
        if (index >= 0) next.excelModels[index] = model; else next.excelModels.push(model);
        applied.push('Modello Excel');
      }
      if (languages !== false && result.changes.newLanguages.length) {
        next.languages = [...next.languages, ...result.changes.newLanguages];
        applied.push(`lingue ${result.changes.newLanguages.join(', ')}`);
      }
      if (settings === true && used) {
        next.naming = used.naming;
        next.sections = used.sections;
        applied.push('modello del nome e section');
      }
      if (!applied.length) return { updated: brand.name, applied, message: 'Nulla da aggiornare' };
      if (!next.primaryLanguage && session.excel) next.primaryLanguage = session.excel.primary;
      session.brand = await profiles.save(validateProfile(next));
      return { updated: brand.name, origin: session.brandOrigin, applied, savedAs: session.brandOrigin === 'base' ? 'Aggiunte personali' : 'Profilo personale' };
    });

  // ---------- prompt ----------
  server.registerPrompt(
    'localizza-frame',
    {
      title: 'Localizza i frame da un Excel cliente o da traduzioni in chat',
      description: 'Guida il dialogo: traduzioni (Excel cliente o chat) → Brand riconosciuto (facoltativo) → abbinamento e lingue → generazione → Excel aggiornato → Traduzione AI facoltativa → reference.'
      // Nessun argomento: i client (es. Claude Desktop) mostrerebbero un modulo da compilare prima di partire.
      // Excel e Brand li chiede l'agente nel dialogo (passo 1 di WORKFLOW).
    },
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Aiutami a localizzare i frame Figma selezionati partendo dalle traduzioni (un Excel cliente o testi che ti do in chat).\n\n${WORKFLOW}`
        }
      }]
    })
  );

  return server;
}

// Differenze informative tra il profilo e l'Excel analizzato: vale sempre l'Excel.
function profileDifferences(profile: BrandProfile, model?: ExcelModel | null, excelLanguages?: string[]): string[] {
  const notes: string[] = [];
  if (model && profile.excelModels.length) {
    const closest = profile.excelModels[closestModelIndex(profile, model)] ?? profile.excelModels[0];
    if (closest.sheet.trim().toLowerCase() !== model.sheet.trim().toLowerCase()) notes.push(`foglio "${model.sheet}" invece di "${closest.sheet}"`);
  }
  for (const code of excelLanguages ?? []) if (!knownLanguage(profile, code)) notes.push(`nuova lingua ${code}`);
  return notes;
}

function settingsDifferences(profile: BrandProfile, used: { naming: { template: string; start: number }; sections: SectionMode; languages: string[] }): string[] {
  const notes: string[] = [];
  const naming = profileNaming(profile);
  if (naming.template !== used.naming.template || naming.start !== used.naming.start) notes.push(`nome di output ${used.naming.template} invece di ${naming.template}`);
  if ((profile.sections ?? 'none') !== used.sections) notes.push(`section ${used.sections} invece di ${profile.sections ?? 'none'}`);
  const extra = used.languages.filter(code => !knownLanguage(profile, code));
  if (extra.length) notes.push(`lingue ${extra.join(', ')} non nel profilo`);
  return notes;
}

function modelChanged(known: ExcelModel, current: ExcelModel): boolean {
  const structure = (model: ExcelModel) => JSON.stringify([model.sheet, model.headerRow, model.headers, model.idColumn ?? null, model.sourceColumn ?? null]);
  return structure(known) !== structure(current) || modelSimilarity(known, current).score < 0.9;
}

// Una variante (FR_BE) è già nota se il profilo ha la variante o la sua lingua base (FR).
function knownLanguage(profile: BrandProfile, code: string): boolean {
  return profile.languages.includes(code) || profile.languages.includes(code.split('_')[0]);
}
