// Prepara i file da consegnare ai designer, senza che debbano installare Node:
//  - figma-auto-fill-plugin-vX.zip: manifest.json + dist/ già compilati, da importare in Figma Desktop
//  - figma-auto-fill-vX.mcpb: server MCP in un unico file con le dipendenze incorporate (Claude Desktop)
// Uso: node scripts/package.mjs [--out <cartella>]  (richiede il comando `zip`, presente su macOS e Linux)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const outIndex = process.argv.indexOf('--out');
const out = resolve(outIndex > 0 ? process.argv[outIndex + 1] : 'release');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const zip = (cwd, target, ...paths) => execFileSync('zip', ['-qr', target, ...paths], { cwd });

// 1. Plugin
const pluginName = 'figma-auto-fill-plugin';
const plugin = join(out, 'staging', pluginName);
await mkdir(join(plugin, 'dist'), { recursive: true });
await cp('manifest.json', join(plugin, 'manifest.json'));
await cp('dist/code.js', join(plugin, 'dist/code.js'));
await cp('dist/ui.html', join(plugin, 'dist/ui.html'));
await writeFile(join(plugin, 'LEGGIMI.txt'), `Figma Auto Fill ${version}

1. Tieni questa cartella dove la trovi sempre (per esempio in Documenti): Figma la legge da qui ogni volta che apri il plugin.
2. In Figma Desktop: Plugins > Development > Import plugin from manifest...
3. Scegli il file manifest.json di questa cartella.
4. Avvia il plugin da Plugins > Development > Figma Auto Fill.

Per aggiornare: sostituisci la cartella con quella della nuova versione e riapri il plugin.
`);
zip(join(out, 'staging'), join(out, `${pluginName}-v${version}.zip`), pluginName);

// 2. Server MCP in un solo file (nessun node_modules da installare)
const bundle = join(out, 'staging', 'mcpb');
await mkdir(join(bundle, 'server'), { recursive: true });
await build({
  entryPoints: ['server/index.ts'],
  outfile: join(bundle, 'server/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // dipendenze native opzionali di `ws`: il require è già in un try/catch
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__importMetaUrl' },
  logLevel: 'warning'
});
const manifest = JSON.parse(await readFile('mcpb/manifest.json', 'utf8'));
await writeFile(join(bundle, 'manifest.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
zip(bundle, join(out, `figma-auto-fill-v${version}.mcpb`), 'manifest.json', 'server');

await rm(join(out, 'staging'), { recursive: true, force: true });
console.log(`Pronti in ${out}:\n  ${pluginName}-v${version}.zip\n  figma-auto-fill-v${version}.mcpb`);
