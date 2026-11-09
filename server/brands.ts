import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_NAME_TEMPLATE, normalizeLanguage } from '../src/core';

export const PROFILE_VERSION = 1;
export const EXPORT_FORMAT = 'figma-auto-fill-brand-profile';

const languageCode = z.string().transform((value, context) => {
  try { return normalizeLanguage(value); }
  catch (error) { context.addIssue({ code: 'custom', message: (error as Error).message }); return z.NEVER; }
});

const glossaryEntry = z.object({
  term: z.string().min(1),
  // true = il termine resta identico in tutte le lingue
  keep: z.boolean().default(false),
  translations: z.record(z.string(), z.string()).default({})
});

const confirmedMatch = z.object({
  // testo sorgente normalizzato del livello Figma
  source: z.string().min(1),
  // valore della colonna ID dell'Excel cliente, se presente
  rowId: z.string().optional(),
  // testo sorgente normalizzato della riga abbinata
  rowSource: z.string().min(1)
});

// Livelli di contorno (To:, Reply to:, date, logo) che non vanno mai tradotti. Una voce è il nome o il testo del
// livello; con prefisso "re:" è un'espressione regolare (senza distinzione tra maiuscole e minuscole).
const ignoredLayers = z.array(z.string().trim().min(1)).default([]).superRefine((items, context) => {
  items.forEach((item, index) => {
    if (!item.startsWith('re:')) return;
    try { new RegExp(item.slice(3), 'i'); }
    catch { context.addIssue({ code: 'custom', path: [index], message: `Espressione regolare non valida: ${item}` }); }
  });
});

export const brandProfileSchema = z.object({
  version: z.literal(PROFILE_VERSION),
  name: z.string().trim().min(1),
  naming: z.object({
    template: z.string().min(1).default(DEFAULT_NAME_TEMPLATE),
    start: z.number().int().min(0).default(1)
  }).default({ template: DEFAULT_NAME_TEMPLATE, start: 1 }),
  primaryLanguage: languageCode,
  languages: z.array(languageCode).default([]),
  sections: z.enum(['none', 'locale', 'base']).default('none'),
  glossary: z.array(glossaryEntry).default([]),
  ignoredLayers,
  confirmedMatches: z.array(confirmedMatch).default([])
});

export type BrandProfile = z.infer<typeof brandProfileSchema>;
export type GlossaryEntry = z.infer<typeof glossaryEntry>;
export type ConfirmedMatch = z.infer<typeof confirmedMatch>;

export function validateProfile(input: unknown): BrandProfile {
  const result = brandProfileSchema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues.map(issue => `${issue.path.join('.') || 'profilo'}: ${issue.message}`);
  throw new Error(`Profilo brand non valido — ${details.join('; ')}`);
}

export function slugify(name: string): string {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`Nome brand non valido: "${name}"`);
  return slug;
}

export type ImportResult =
  | { status: 'imported'; profile: BrandProfile }
  | { status: 'conflict'; existing: string; message: string };

// Un file JSON per brand in una cartella del progetto.
export class BrandStore {
  constructor(private readonly dir: string) {}

  private file(name: string): string {
    return join(this.dir, `${slugify(name)}.json`);
  }

  async list(): Promise<Array<{ name: string; primaryLanguage: string; languages: string[] }>> {
    let files: string[];
    try { files = await readdir(this.dir); }
    catch { return []; }
    const profiles: Array<{ name: string; primaryLanguage: string; languages: string[] }> = [];
    for (const file of files.filter(item => item.endsWith('.json')).sort()) {
      try {
        const profile = validateProfile(JSON.parse(await readFile(join(this.dir, file), 'utf8')));
        profiles.push({ name: profile.name, primaryLanguage: profile.primaryLanguage, languages: profile.languages });
      } catch { /* un file non valido non deve bloccare l'elenco */ }
    }
    return profiles;
  }

  async get(name: string): Promise<BrandProfile | null> {
    try { return validateProfile(JSON.parse(await readFile(this.file(name), 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(input: unknown): Promise<BrandProfile> {
    const profile = validateProfile(input);
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(profile.name), `${JSON.stringify(profile, null, 2)}\n`);
    return profile;
  }

  async exportTo(name: string, path: string): Promise<string> {
    const profile = await this.get(name);
    if (!profile) throw new Error(`Profilo brand non trovato: ${name}`);
    await writeFile(path, `${JSON.stringify({ format: EXPORT_FORMAT, version: PROFILE_VERSION, profile }, null, 2)}\n`);
    return path;
  }

  // Un nome già presente non viene mai sovrascritto senza `overwrite`; con `rename` si importa con un altro nome.
  async importFrom(path: string, options: { overwrite?: boolean; rename?: string } = {}): Promise<ImportResult> {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { throw new Error(`File profilo non leggibile (${path}): ${(error as Error).message}`); }
    const wrapper = raw as { format?: unknown; version?: unknown; profile?: unknown };
    if (!wrapper || wrapper.format !== EXPORT_FORMAT) throw new Error('Il file non è un profilo brand esportato da Figma Auto Fill');
    if (wrapper.version !== PROFILE_VERSION) throw new Error(`Versione del profilo non supportata: ${String(wrapper.version)} (supportata: ${PROFILE_VERSION})`);
    const profile = validateProfile({ ...(wrapper.profile as object), ...(options.rename ? { name: options.rename } : {}) });
    const existing = await this.get(profile.name);
    if (existing && !options.overwrite) {
      return { status: 'conflict', existing: existing.name, message: `Esiste già un profilo "${existing.name}": importa con overwrite=true oppure scegli un altro nome (rename)` };
    }
    return { status: 'imported', profile: await this.save(profile) };
  }
}
