// Logica della sezione Profili della UI, separata dal DOM per poterla provare in Node.
// Parla con il codice del plugin, che custodisce l'archivio (ADR 0002), con messaggi { kind: 'profiles' }.
import { exportFilename, type BrandProfile, type ImportResult, type ProfileAction, type ProfilesState, type SectionMode } from './profiles';

export type ProfilesStateMessage = { kind: 'profiles-state'; applied?: BrandProfile | null; by?: 'ui' | 'agent' } & ProfilesState;
export type ProfilesResultMessage = { kind: 'profiles-result'; requestId: string; ok: true; data: unknown } | { kind: 'profiles-result'; requestId: string; ok: false; error: string };

// Che cosa precompila nella UI la selezione di un profilo. Tutto resta modificabile dopo.
export type Prefill = { nameTemplate?: string; numberStart?: number; targets?: string[]; primary?: string; sectionMode?: SectionMode };

export function prefillFrom(profile: BrandProfile): Prefill {
  const prefill: Prefill = {};
  if (profile.naming) { prefill.nameTemplate = profile.naming.template; prefill.numberStart = profile.naming.start; }
  if (profile.languages.length) prefill.targets = [...profile.languages];
  if (profile.primaryLanguage) prefill.primary = profile.primaryLanguage;
  if (profile.sections) prefill.sectionMode = profile.sections;
  return prefill;
}

// Risposta del designer a un import che chiede una scelta: null annulla.
export type ImportChoice = { mode?: 'merge' | 'replace'; rename?: string } | null;

export class ProfilesController {
  state: ProfilesState = { profiles: [], selected: null, notices: [] };
  private next = 1;
  private readonly pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly deps: {
    send: (message: { kind: 'profiles'; requestId: string; request: ProfileAction }) => void;
    onState: (state: ProfilesState, applied: { profile: BrandProfile | null; by: 'ui' | 'agent' } | null) => void;
  }) {}

  // Da chiamare per ogni messaggio del plugin: true se era per la sezione Profili.
  handle(message: { kind?: string }): boolean {
    if (message.kind === 'profiles-state') {
      const { profiles, selected, notices, applied, by } = message as ProfilesStateMessage;
      this.state = { profiles, selected, notices: notices ?? [] };
      this.deps.onState(this.state, applied !== undefined ? { profile: applied, by: by ?? 'ui' } : null);
      return true;
    }
    if (message.kind === 'profiles-result') {
      const result = message as ProfilesResultMessage;
      const waiting = this.pending.get(result.requestId);
      if (!waiting) return true;
      this.pending.delete(result.requestId);
      if (result.ok) waiting.resolve(result.data);
      else waiting.reject(new Error(result.error));
      return true;
    }
    return false;
  }

  request<T = unknown>(request: ProfileAction): Promise<T> {
    const requestId = `p${this.next++}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (data: unknown) => void, reject });
      this.deps.send({ kind: 'profiles', requestId, request });
    });
  }

  origin(name: string | null): 'base' | 'personal' | null {
    return name ? this.state.profiles.find(item => item.name === name)?.origin ?? null : null;
  }

  hasAdditions(name: string | null): boolean {
    return Boolean(name && this.state.profiles.find(item => item.name === name)?.hasAdditions);
  }

  select(name: string | null): Promise<unknown> { return this.request({ action: 'select', name }); }

  async create(name: string): Promise<BrandProfile> {
    const { profile } = await this.request<{ profile: BrandProfile }>({ action: 'create', name });
    await this.select(profile.name);
    return profile;
  }

  rename(name: string, next: string): Promise<unknown> { return this.request({ action: 'rename', name, next }); }
  remove(name: string): Promise<unknown> { return this.request({ action: 'remove', name }); }
  clearAdditions(name: string): Promise<unknown> { return this.request({ action: 'clear-additions', name }); }

  async exportProfile(name: string): Promise<{ filename: string; content: string }> {
    const file = await this.request({ action: 'export', name });
    return { filename: exportFilename(name), content: `${JSON.stringify(file, null, 2)}\n` };
  }

  // Importa il testo di un file scelto dal designer; `ask` risolve le scelte unisci/sostituisci o sostituisci/rinomina.
  async importText(text: string, ask: (result: Extract<ImportResult, { status: 'choose' }>) => Promise<ImportChoice>): Promise<ImportResult | null> {
    let file: unknown;
    try { file = JSON.parse(text); }
    catch { throw new Error('Il file non è un profilo brand di Figma Auto Fill (JSON non valido)'); }
    let options: { mode?: 'merge' | 'replace'; rename?: string } = {};
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await this.request<ImportResult>({ action: 'import', file, ...options });
      if (result.status === 'imported') {
        await this.select(result.name);
        return result;
      }
      const choice = await ask(result);
      if (!choice) return null;
      options = choice;
    }
    throw new Error('Importazione non completata: troppe scelte in sospeso');
  }
}
