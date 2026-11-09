import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/plugin.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  format: 'iife',
  target: 'es2017',
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
