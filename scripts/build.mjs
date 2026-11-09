import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadBaseProfiles } from './base-profiles.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

await mkdir('dist', { recursive: true });

// Profili di base (ADR 0002): ogni file .json di brand-profiles/ viene validato e compilato nel plugin.
// Un profilo non valido o un nome duplicato fanno fallire la build (scripts/base-profiles.mjs).
await build({
  entryPoints: ['src/profiles.ts'],
  outfile: 'dist/profiles.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
});
const { validateProfile } = await import(`${pathToFileURL(join(process.cwd(), 'dist/profiles.mjs')).href}?t=${Date.now()}`);
const baseProfiles = await loadBaseProfiles('brand-profiles', validateProfile);
await build({
  entryPoints: ['src/plugin.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  format: 'iife',
  target: 'es2017',
  define: { __BASE_PROFILES__: JSON.stringify(baseProfiles) },
  logLevel: 'info'
});
const uiBuild = await build({
  entryPoints: ['src/ui.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2017',
  write: false,
  logLevel: 'info'
});
const html = await readFile('src/ui.html', 'utf8');
const css = await readFile('src/ui.css', 'utf8');
const js = uiBuild.outputFiles[0].text.replaceAll('</script', '<\\/script');
await writeFile('dist/ui.html', html.replace('/* INLINE_CSS */', () => css).replace('/* INLINE_JS */', () => js));
await build({
  entryPoints: ['src/core.ts'],
  outfile: 'dist/core.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
});
await build({
  entryPoints: ['src/workbook.ts'],
  outfile: 'dist/workbook.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
});
await build({
  entryPoints: ['src/grid.ts'],
  outfile: 'dist/grid.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
});
await build({
  entryPoints: ['src/language-catalog.ts'],
  outfile: 'dist/language-catalog.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
});

// Server MCP: ogni modulo è un'entry separata (testabile da tests/); le dipendenze npm restano esterne.
await build({
  entryPoints: {
    index: 'server/index.ts', tools: 'server/tools.ts', bridge: 'server/bridge.ts', brands: 'server/brands.ts',
    'excel-analyze': 'server/excel-analyze.ts', 'excel-update': 'server/excel-update.ts', match: 'server/match.ts'
  },
  outdir: 'dist/server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
});
await build({
  entryPoints: ['src/profiles-ui.ts'],
  outfile: 'dist/profiles-ui.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
});
await build({
  entryPoints: ['src/agent-bridge.ts'],
  outfile: 'dist/agent-bridge.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
});
