import { existsSync, rmSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

// Un Excel allegato alla chat di Claude Desktop vive nello spazio cloud dell'agente, non sul Mac dove gira
// il server: l'agente conosce solo il nome del file. Lo cerchiamo nelle cartelle dove di solito finisce.
export const DEFAULT_SEARCH_ROOTS = ['Downloads', 'Desktop', 'Documents'].map(dir => join(homedir(), dir));
const MAX_DEPTH = 4;
const SKIP = new Set(['node_modules', 'Library', 'Applications']);

export function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

// "Traduzioni (1).xlsx" è la copia che il Mac crea scaricando due volte lo stesso file: vale come lo stesso nome.
const comparable = (name: string): string =>
  basename(name, extname(name)).replace(/\s*\(\d+\)$/, '').trim().toLowerCase() + extname(name).toLowerCase();

async function walk(dir: string, target: string, depth: number, found: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; } // cartella non leggibile (permessi macOS): si salta
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue; // nascosti e file di lock di Excel
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH && !SKIP.has(entry.name)) await walk(path, target, depth + 1, found);
    } else if (entry.isFile() && comparable(entry.name) === target) {
      found.push(path);
    }
  }
}

export type Located = { path: string; modified: string };

// I file con quel nome, il più recente per primo.
export async function locateExcel(fileName: string, roots = DEFAULT_SEARCH_ROOTS): Promise<Located[]> {
  const target = comparable(basename(fileName.trim()));
  const found: string[] = [];
  for (const root of roots) await walk(root, target, 0, found);
  const withTime = await Promise.all([...new Set(found)].map(async path => ({ path, time: (await stat(path)).mtimeMs })));
  return withTime.sort((a, b) => b.time - a.time).map(item => ({ path: item.path, modified: new Date(item.time).toISOString() }));
}

// Percorso esplicito se c'è, altrimenti ricerca per nome. Più file con lo stesso nome: decide il designer.
export async function resolveExcelPath(args: { path?: string; fileName?: string }, roots = DEFAULT_SEARCH_ROOTS): Promise<string> {
  if (args.path?.trim()) {
    const path = resolve(expandHome(args.path.trim()));
    try { await stat(path); return path; }
    // un percorso che non esiste sul Mac (es. /mnt/user-data/uploads/... dello spazio cloud): si cerca per nome
    catch { return resolveExcelPath({ fileName: args.fileName ?? basename(path) }, roots); }
  }
  if (!args.fileName?.trim()) throw new Error('Indica path (percorso sul Mac) oppure file_name (nome del file allegato)');
  const found = await locateExcel(args.fileName, roots);
  const where = roots.map(root => root.replace(homedir(), '~')).join(', ');
  if (!found.length) {
    throw new Error(`"${args.fileName}" non è sul Mac in ${where}. Un allegato della chat non è raggiungibile dal plugin: chiedi al designer il percorso completo del file (in Finder: tasto destro sul file, tieni premuto Opzione, "Copia come percorso") o di salvarlo in Download.`);
  }
  if (found.length > 1) {
    throw new Error(`Più file chiamati "${args.fileName}": ${found.map(item => `${item.path} (modificato ${item.modified.slice(0, 16).replace('T', ' ')})`).join('; ')}. Chiedi al designer quale usare e richiama con path.`);
  }
  return found[0].path;
}

// ---------- Copie di lavoro temporanee ----------
// L'Excel del cliente si analizza da una copia in excel-clienti/temp-<pid>/: l'originale non si tocca e la copia
// sparisce a fine sessione. I file che il designer mette da sé in excel-clienti/ non vengono mai cancellati.
const TEMP_PREFIX = 'temp-';

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};

// La cartella excel-clienti/ accanto al server: risale dal punto d'avvio fino alla radice del progetto
// (repo in sviluppo, cartella dell'estensione in Claude Desktop).
export function defaultExcelDir(entry = process.argv[1] ?? process.cwd()): string {
  let dir = dirname(resolve(entry));
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'manifest.json'))) return join(dir, 'excel-clienti');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(dirname(resolve(entry)), 'excel-clienti');
}

export class WorkingCopies {
  readonly sessionDir: string;
  constructor(readonly dir: string, pid = process.pid) {
    this.sessionDir = join(dir, `${TEMP_PREFIX}${pid}`);
  }

  // Avanzi di sessioni chiuse male (crash, kill -9): le loro cartelle temp-<pid> si eliminano all'avvio.
  async cleanStale(): Promise<void> {
    let entries;
    try { entries = await readdir(this.dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const pid = Number(entry.name.slice(TEMP_PREFIX.length));
      if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX) || !Number.isInteger(pid)) continue;
      if (join(this.dir, entry.name) !== this.sessionDir && !alive(pid)) await rm(join(this.dir, entry.name), { recursive: true, force: true });
    }
  }

  // Una sola copia per volta: analizzando un nuovo Excel la precedente si elimina.
  async take(original: string): Promise<string> {
    await rm(this.sessionDir, { recursive: true, force: true });
    await mkdir(this.sessionDir, { recursive: true });
    const copy = join(this.sessionDir, basename(original));
    await copyFile(original, copy);
    return copy;
  }

  // Sincrona: deve funzionare anche dentro process.on('exit').
  releaseAll(): void {
    rmSync(this.sessionDir, { recursive: true, force: true });
  }
}
