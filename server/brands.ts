// Il server non custodisce più i Profili brand: li legge e li scrive nell'archivio del plugin passando dal bridge (ADR 0002).
import type { PluginLink } from './bridge';
import type {
  Additions, BrandProfile, ExportFile, ImportResult, ProfileAction, ProfileOrigin, ProfileSummary
} from '../src/profiles';

export type ProfileWithOrigin = BrandProfile & { origin: ProfileOrigin };

export class PluginProfiles {
  constructor(private readonly bridge: PluginLink) {}

  private call<T>(request: ProfileAction): Promise<T> {
    return this.bridge.request<T>('profiles', request);
  }

  list(): Promise<{ profiles: ProfileSummary[]; selected: string | null }> { return this.call({ action: 'list' }); }
  all(): Promise<{ profiles: ProfileWithOrigin[]; selected: string | null }> { return this.call({ action: 'all' }); }
  get(name: string): Promise<{ profile: BrandProfile; origin: ProfileOrigin; additions: Additions | null }> { return this.call({ action: 'get', name }); }
  async select(name: string | null): Promise<BrandProfile | null> { return (await this.call<{ profile: BrandProfile | null }>({ action: 'select', name })).profile; }
  async save(profile: BrandProfile): Promise<BrandProfile> { return (await this.call<{ profile: BrandProfile }>({ action: 'save', profile })).profile; }
  async create(name: string): Promise<BrandProfile> { return (await this.call<{ profile: BrandProfile }>({ action: 'create', name })).profile; }
  exportFile(name: string): Promise<ExportFile> { return this.call({ action: 'export', name }); }
  importFile(file: unknown, options: { mode?: 'merge' | 'replace'; rename?: string }): Promise<ImportResult> {
    return this.call({ action: 'import', file, ...options });
  }
}
