import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BRIDGE_PORT } from '../src/agent-protocol';
import { BrandStore } from './brands';
import { Bridge } from './bridge';
import { createMcpServer } from './tools';

// Su stdio stdout è riservato al protocollo MCP: i log vanno su stderr.
const log = (message: string): void => { process.stderr.write(`[figma-auto-fill] ${message}\n`); };

const port = Number(process.env.FIGMA_AUTOFILL_PORT ?? BRIDGE_PORT);
const brandsDir = resolve(process.env.FIGMA_AUTOFILL_BRANDS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'brand-profiles'));

const bridge = new Bridge({ port });
await bridge.start();
log(bridge.startError ?? `bridge in ascolto su ws://localhost:${port}`);
log(`profili brand in ${brandsDir}`);

const server = createMcpServer({ bridge, brands: new BrandStore(brandsDir) });
await server.connect(new StdioServerTransport());

const shutdown = (): void => { void bridge.close().finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
