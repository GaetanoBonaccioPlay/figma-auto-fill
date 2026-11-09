import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { frameLabel, normalizeLanguage, validateRows, type FrameInfo, type TranslationRow } from '../src/core';
import type { UiState } from '../src/agent-protocol';
import { BrandStore, validateProfile, PROFILE_VERSION, type BrandProfile } from './brands';
import type { PluginLink } from './bridge';
import {
  analyzeWorkbook, columnLetter, columnNumber, readSheets, type AnalysisReport
} from './excel-analyze';
import {
  cellToMarkup, defaultOutputPath, planUpdates, writeUpdatedWorkbook
} from './excel-update';
import {
  DEFAULT_SIMILARITY_THRESHOLD, layerId, matchLayers, normalizeText,
  type ExcelRow, type LayerRef, type MatchResult
} from './match';

type ExcelConfig = {
  path: string; sheet: string; headerRow: number; idColumn?: number; sourceColumn: number;
  languageColumns: Record<string, number>; rows: ExcelRow[]; lastRow: number;
};
type Session = {
  brand: BrandProfile | null;
  analysis: AnalysisReport | null;
  excel: ExcelConfig | null;
  selection: FrameInfo[] | null;
  layers: Array<LayerRef & { markup: string }>;
  match: MatchResult | null;
  accepted: Map<string, { layer: LayerRef; row: number }>;
  generated: { frameIds: string[]; languages: string[]; rows: TranslationRow[] } | null;
  ai: Map<string, { row: number; language: string; text: string }>;
};

const newSession = (): Session => ({
  brand: null, analysis: null, excel: null, selection: null, layers: [], match: null,
  accepted: new Map(), generated: null, ai: new Map()
});

export function todayStamp(now = new Date()): string {
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

export const WORKFLOW = `Segui questi passi, uno alla volta, chiedendo conferma al designer dove indicato.
REGOLA GENERALE: davanti a un'incongruenza (lingue del plugin diverse da quelle dell'Excel, testi o traduzioni mancanti, nomi o impostazioni che non tornano, risposte "conflict" o "confirm-languages") NON decidere da solo e non andare avanti: fai una domanda breve al designer, con una proposta consigliata, e agisci solo dopo la risposta.
1. BRAND — chiedi per quale Brand si lavora. Usa list_brand_profiles e poi get_brand_profile (che seleziona il Brand). Se non esiste, proponi di crearlo con save_brand_profile.
2. EXCEL CLIENTE — chiedi il percorso dell'Excel e chiama analyze_client_excel. Mostra foglio, lingue trovate (intestazione → codice), Colonna sorgente proposta e le differenze con il Profilo brand; chiedi conferma o correzioni.
3. SELEZIONE — chiedi di selezionare i frame in Figma con il plugin aperto (bridge_status, get_selection).
4. ABBINAMENTO — chiama match_selection con le colonne confermate. Presenta UN SOLO riepilogo: abbinamenti simili (con punteggio), Livelli orfani e Celle multi-livello (queste ultime vanno sistemate dal designer, non abbinarle). Registra le decisioni con confirm_matches.
5. GENERAZIONE — chiama generate_exports. Se risponde "conflict", chiedi se sostituire (replace) o creare una nuova versione (version) e richiama con on_conflict.
6. EXCEL AGGIORNATO — chiama write_updated_excel. Non sovrascrivere celle piene: mostra i conflitti e passa overwrite solo per quelle che il designer conferma.
7. TRADUZIONE AI (facoltativa) — alla fine chiedi SOLO se il designer vuole tradurre le celle vuote (list_empty_cells ne dà il numero). Se sì, traduci rispettando il Glossario brand, fai rivedere le traduzioni, salvale con save_ai_translations e rilancia generate_exports e write_updated_excel.`;

export function createMcpServer(deps: { bridge: PluginLink; brands: BrandStore; now?: () => Date }): McpServer {
  const server = new McpServer({ name: 'figma-auto-fill', version: '1.0.0' });
  const session = newSession();
  const now = deps.now ?? (() => new Date());

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

  const requireBrand = (): BrandProfile => {
    if (!session.brand) throw new Error('Scegli prima il Brand: list_brand_profiles, poi get_brand_profile');
    return session.brand;
  };
  const requireExcel = (): ExcelConfig => {
    if (!session.excel) throw new Error('Nessun Excel cliente in uso: esegui analyze_client_excel e match_selection');
    return session.excel;
  };
  const rowByNumber = (excel: ExcelConfig, row: number): ExcelRow => {
    const found = excel.rows.find(item => item.row === row);
    if (!found) throw new Error(`Riga ${row} non presente nell'Excel cliente`);
    return found;
  };
  const snapshot = async (frameIds?: string[]): Promise<FrameInfo[]> =>
    (await deps.bridge.request<{ frames: FrameInfo[] }>('snapshot', frameIds ? { frameIds } : undefined)).frames;
  const unmatchedLayers = () => session.layers.filter(layer => normalizeText(layer.text) && !session.accepted.has(layerId(layer)));
  const ref = (layer: LayerRef) => ({ frame: layer.frame, key: layer.key, text: layer.text });

  // ---------- bridge ----------
  register('bridge_status', 'Stato del collegamento con il plugin Figma Auto Fill (deve essere aperto in Figma Desktop).', {}, async () => ({
    connected: deps.bridge.connected,
    error: deps.bridge.startError,
    hint: deps.bridge.connected ? undefined : 'Apri il plugin in Figma Desktop: Plugins → Development → Figma Auto Fill'
  }));

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
  register('list_brand_profiles', 'Elenca i Profili brand salvati.', {}, async () => ({ brands: await deps.brands.list() }));

  register('get_brand_profile', 'Carica un Profilo brand e lo seleziona come Brand corrente della sessione.', { name: z.string() }, async ({ name }) => {
    const profile = await deps.brands.get(name);
    if (!profile) {
      const known = (await deps.brands.list()).map(item => item.name);
      throw new Error(`Profilo brand "${name}" non trovato.${known.length ? ` Disponibili: ${known.join(', ')}.` : ''} Puoi crearlo con save_brand_profile.`);
    }
    session.brand = profile;
    return profile;
  });

  register('save_brand_profile',
    'Crea o aggiorna un Profilo brand (i campi omessi restano invariati; gli Abbinamenti confermati si conservano) e lo seleziona.',
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
      const existing = await deps.brands.get(input.name);
      if (!existing && !input.primaryLanguage) throw new Error('Per creare un Profilo brand serve primaryLanguage');
      const merged = {
        ...(existing ?? { version: PROFILE_VERSION }),
        ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
        naming: { template: input.naming?.template ?? existing?.naming.template ?? '{Nome}', start: input.naming?.start ?? existing?.naming.start ?? 1 },
        version: PROFILE_VERSION
      };
      const profile = await deps.brands.save(validateProfile(merged));
      session.brand = profile;
      return profile;
    });

  register('export_brand_profile', 'Esporta un Profilo brand in un file da condividere.',
    { name: z.string(), path: z.string().describe('Percorso del file .json di destinazione') },
    async ({ name, path }) => ({ exported: await deps.brands.exportTo(name, path) }));

  register('import_brand_profile', 'Importa un Profilo brand esportato. Un nome già presente non viene sovrascritto senza overwrite=true.',
    { path: z.string(), overwrite: z.boolean().optional(), rename: z.string().optional() },
    async ({ path, overwrite, rename }) => {
      const result = await deps.brands.importFrom(path, { overwrite, rename });
      if (result.status === 'imported') session.brand = result.profile;
      return result;
    });

  // ---------- Excel cliente ----------
  register('analyze_client_excel',
    'Analizza un Excel cliente (struttura libera): fogli, colonne lingua con codice normalizzato, colonne ignorate, Colonna sorgente proposta e differenze con il Profilo brand. Chiedi conferma al designer.',
    { path: z.string(), sheet: z.string().optional(), brand: z.string().optional() },
    async ({ path, sheet, brand }) => {
      if (brand) {
        const profile = await deps.brands.get(brand);
        if (!profile) throw new Error(`Profilo brand "${brand}" non trovato`);
        session.brand = profile;
      }
      const profile = requireBrand();
      const report = analyzeWorkbook(path, await readSheets(path), { sheet, primary: profile.primaryLanguage, profileLanguages: profile.languages });
      session.analysis = report;
      session.excel = null; session.match = null; session.accepted.clear(); session.generated = null; session.ai.clear();
      return report;
    });

  register('match_selection',
    'Abbina i livelli di testo dei frame selezionati alle righe dell\'Excel cliente. Restituisce esatti, simili (da confermare), Livelli orfani e Celle multi-livello. Dopo la conferma delle lingue, passa le colonne confermate (altrimenti si usano quelle proposte).',
    {
      source_column: z.string().optional().describe('Colonna sorgente, es. "C"'),
      languages: z.array(z.object({ column: z.string(), code: z.string() })).optional().describe('Mappatura confermata colonna → codice lingua'),
      threshold: z.number().min(0.5).max(0.99).optional().describe(`Soglia di similarità (default ${DEFAULT_SIMILARITY_THRESHOLD})`)
    },
    async ({ source_column, languages, threshold }) => {
      const brand = requireBrand();
      const report = session.analysis;
      if (!report) throw new Error('Esegui prima analyze_client_excel');
      const languageColumns: Record<string, number> = {};
      if (languages) {
        for (const item of languages) languageColumns[normalizeLanguage(item.code)] = columnNumber(item.column);
      } else {
        for (const item of report.analysis.languageColumns) if (!(item.code in languageColumns)) languageColumns[item.code] = item.column;
      }
      const sourceColumn = source_column ? columnNumber(source_column) : report.sourceColumn?.column;
      if (!sourceColumn) throw new Error('Colonna sorgente non determinata: indica source_column');
      languageColumns[brand.primaryLanguage] = sourceColumn;

      const sheet = (await readSheets(report.path)).find(item => item.name === report.analysis.sheet);
      if (!sheet) throw new Error(`Foglio "${report.analysis.sheet}" non più presente nel file`);
      const { headerRow, idColumn } = report.analysis;
      const rows: ExcelRow[] = [];
      sheet.rows.forEach((cells, index) => {
        if (index + 1 <= headerRow) return;
        const values = Object.fromEntries(Object.entries(languageColumns).map(([code, column]) => [code, cells[column - 1] ?? '']));
        if (Object.values(values).every(value => !value.trim())) return;
        rows.push({ row: index + 1, id: idColumn ? (cells[idColumn - 1] ?? '').trim() || undefined : undefined, source: values[brand.primaryLanguage] ?? '', values });
      });
      session.excel = { path: report.path, sheet: sheet.name, headerRow, idColumn, sourceColumn, languageColumns, rows, lastRow: sheet.rows.length };

      const frames = await snapshot();
      if (!frames.length) throw new Error('Nessun frame selezionato: seleziona i frame in Figma e riprova');
      session.selection = frames;
      session.layers = frames.flatMap(frame => frame.textLayers.map(layer => ({
        frameId: frame.id, frame: frameLabel(frame), key: layer.key, text: layer.text, markup: layer.markup
      })));
      const result = matchLayers({ layers: session.layers, rows, confirmed: brand.confirmedMatches, threshold });
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
      return {
        summary: {
          layers: session.layers.length, exact: result.exact.length, similar: result.similar.length,
          orphans: result.orphans.length, multiLevel: result.multiLevel.length, emptyLayersSkipped: result.skippedEmpty
        },
        columns: { source: columnLetter(sourceColumn), languages: Object.fromEntries(Object.entries(languageColumns).map(([code, column]) => [code, columnLetter(column)])) },
        exact: result.exact.map(item => ({ ...ref(item.layer), row: item.row, via: item.via })),
        similar: result.similar.map(item => ({ ...ref(item.layer), row: item.row, score: item.score, excelText: item.rowText })),
        orphans: result.orphans.map(item => ({ ...ref(item.layer), reason: item.reason, row: item.row })),
        multiLevel: result.multiLevel.map(cell => ({ row: cell.row, text: cell.text, layers: cell.layers.map(ref) })),
        warnings
      };
    });

  register('confirm_matches',
    'Registra le decisioni del designer sul riepilogo: accetta abbinamenti simili ("all" o elenco), assegna manualmente un livello a una riga. Gli abbinamenti confermati vengono ricordati nel Profilo brand (remember).',
    {
      accept_similar: z.union([z.literal('all'), z.array(z.object({ frame: z.string(), key: z.string() }))]).optional(),
      assign: z.array(z.object({ frame: z.string(), key: z.string(), row: z.number().int() })).optional(),
      remember: z.boolean().optional()
    },
    async ({ accept_similar, assign, remember }) => {
      const brand = requireBrand();
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
      if (remember !== false && (confirmedNow.length || match.staleConfirmed.length)) {
        const stale = new Set(match.staleConfirmed.map(item => item.source));
        const fresh = confirmedNow.map(item => {
          const row = rowByNumber(excel, item.row);
          return { source: normalizeText(item.layer.text), rowId: row.id, rowSource: normalizeText(row.source) };
        });
        const replaced = new Set(fresh.map(item => item.source));
        const confirmedMatches = [...brand.confirmedMatches.filter(item => !stale.has(item.source) && !replaced.has(item.source)), ...fresh];
        session.brand = await deps.brands.save({ ...brand, confirmedMatches });
        saved = fresh.length;
      }
      return {
        matched: session.accepted.size,
        orphans: unmatchedLayers().map(ref),
        rememberedInBrandProfile: saved
      };
    });

  // ---------- generazione in Figma ----------
  register('generate_exports',
    'Fa generare al plugin le varianti linguistiche in EXPORT per i frame selezionati. Se esistono già export con gli stessi nomi risponde "conflict": chiedi se sostituire o creare una nuova versione e richiama con on_conflict.',
    {
      languages: z.array(z.string()).optional().describe('Lingue da generare (default: tutte quelle dell\'Excel)'),
      on_conflict: z.enum(['replace', 'version']).optional(),
      section_mode: z.enum(['none', 'locale', 'base']).optional()
    },
    async ({ languages, on_conflict, section_mode }) => {
      const brand = requireBrand();
      const excel = requireExcel();
      const frames = session.selection;
      if (!frames || !session.match) throw new Error('Esegui prima match_selection');
      if (!session.accepted.size) throw new Error('Nessun livello abbinato: controlla Colonna sorgente e frame selezionati');
      const primary = brand.primaryLanguage;
      const targets = [...new Set([primary, ...(languages ?? Object.keys(excel.languageColumns)).map(normalizeLanguage)])];

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
        : { template: brand.naming.template, start: brand.naming.start, date: todayStamp(now()) };
      // Incongruenza: il plugin ha lingue selezionate diverse da quelle dell'Excel. Non si sceglie in silenzio.
      const pluginTargets = new Set([...(ui?.targets ?? []), primary]);
      if (!languages && ui?.targets.length && (pluginTargets.size !== targets.length || targets.some(code => !pluginTargets.has(code)))) {
        return {
          status: 'confirm-languages',
          message: 'Le lingue selezionate nel plugin non coincidono con quelle dell\'Excel. Chiedi al designer quali generare, poi richiama generate_exports passando languages.',
          pluginLanguages: [...pluginTargets],
          excelLanguages: targets
        };
      }
      const frameIds = frames.map(frame => frame.id);
      const base = {
        frameIds, targets, primary,
        baseNames: Object.fromEntries(frames.map(frame => [frame.id, ui?.baseNames[frame.id]?.trim() || frame.baseName])),
        naming
      };
      const sectionMode = section_mode ?? ui?.sectionMode ?? brand.sections;
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
      const fallbacks = result.warnings.filter(item => / usato /.test(item)).length;
      return {
        status: 'done', created: result.names, fallbackCells: fallbacks, warnings: result.warnings,
        usedSettings: { source: fromPlugin ? 'plugin' : 'profilo brand', nameTemplate: naming.template, baseNames: base.baseNames, sectionMode }
      };
    });

  // ---------- Excel aggiornato ----------
  register('write_updated_excel',
    'Scrive la copia <nome>_updated.xlsx con i testi effettivamente usati in Figma (correzioni manuali incluse), i Livelli orfani in coda e le eventuali Traduzioni AI. L\'originale non viene toccato; le celle già piene non si sovrascrivono senza conferma (overwrite).',
    {
      output_path: z.string().optional(),
      overwrite: z.array(z.object({ row: z.number().int(), language: z.string() })).optional().describe('Celle piene che il designer ha confermato di sovrascrivere')
    },
    async ({ output_path, overwrite }) => {
      const excel = requireExcel();
      const brand = requireBrand();
      const figma = session.generated ? await snapshot(session.generated.frameIds) : [];
      const plan = planUpdates({
        rows: excel.rows, languageColumns: excel.languageColumns, primary: brand.primaryLanguage, sourceColumn: excel.sourceColumn,
        matches: [...session.accepted.values()], orphans: unmatchedLayers(),
        generated: session.generated?.rows ?? [], figma, ai: [...session.ai.values()],
        overwrite: (overwrite ?? []).map(item => ({ row: item.row, language: normalizeLanguage(item.language) })), lastRow: excel.lastRow
      });
      const output = output_path ?? defaultOutputPath(excel.path);
      await writeUpdatedWorkbook({ input: excel.path, output, sheet: excel.sheet, plan, idColumn: excel.idColumn });
      return {
        output,
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
      const brand = requireBrand();
      const excel = requireExcel();
      const rows = [...new Set([...session.accepted.values()].map(item => item.row))];
      const cells = rows.flatMap(rowNumber => {
        const row = rowByNumber(excel, rowNumber);
        return Object.keys(excel.languageColumns).filter(code => code !== brand.primaryLanguage).flatMap(code => {
          if (row.values[code]?.trim() || session.ai.has(`${rowNumber}\u0000${code}`)) return [];
          const glossary = brand.glossary
            .filter(entry => row.source.toLowerCase().includes(entry.term.toLowerCase()))
            .map(entry => ({ term: entry.term, keep: entry.keep, translation: entry.translations[code] }));
          return [{ row: rowNumber, language: code, source: row.source, glossary }];
        });
      });
      return { count: cells.length, primaryLanguage: brand.primaryLanguage, cells };
    });

  register('save_ai_translations',
    'Salva le Traduzioni AI già riviste dal designer. Verranno usate da generate_exports e scritte (con fonte "ai") da write_updated_excel solo nelle celle vuote.',
    { translations: z.array(z.object({ row: z.number().int(), language: z.string(), text: z.string().min(1) })) },
    async ({ translations }) => {
      const excel = requireExcel();
      for (const item of translations) {
        const language = normalizeLanguage(item.language);
        const row = rowByNumber(excel, item.row);
        if (!(language in excel.languageColumns) || language === requireBrand().primaryLanguage) throw new Error(`Lingua non traducibile: ${item.language}`);
        if (row.values[language]?.trim()) throw new Error(`Riga ${item.row} / ${language}: la cella non è vuota`);
        session.ai.set(`${item.row}\u0000${language}`, { row: item.row, language, text: item.text });
      }
      return { saved: translations.length, total: session.ai.size, next: 'Rilancia generate_exports e write_updated_excel per applicarle.' };
    });

  // ---------- prompt ----------
  server.registerPrompt(
    'localizza-frame',
    {
      title: 'Localizza i frame da un Excel cliente',
      description: 'Guida il dialogo: Brand → Excel cliente → lingue → abbinamento → generazione → Excel aggiornato → Traduzione AI facoltativa.',
      argsSchema: { brand: z.string().optional(), excel_path: z.string().optional() }
    },
    ({ brand, excel_path }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Aiutami a localizzare i frame Figma selezionati partendo da un Excel cliente.\n${brand ? `Brand: ${brand}.\n` : ''}${excel_path ? `Excel cliente: ${excel_path}.\n` : ''}\n${WORKFLOW}`
        }
      }]
    })
  );

  return server;
}
