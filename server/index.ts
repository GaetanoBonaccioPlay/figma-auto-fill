import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BRIDGE_PORT } from '../src/agent-protocol';
import { Bridge } from './bridge';
import { WorkingCopies, defaultExcelDir } from './excel-locate';
import { createMcpServer } from './tools';

// Su stdio stdout è riservato al protocollo MCP: i log vanno su stderr.
const log = (message: string): void => { process.stderr.write(`[figma-auto-fill] ${message}\n`); };

async function main(): Promise<void> {
  const port = Number(process.env.FIGMA_AUTOFILL_PORT ?? BRIDGE_PORT);

  const bridge = new Bridge({ port });
  await bridge.start();
  log(bridge.startError ?? `bridge in ascolto su ws://localhost:${port}`);
  log('profili brand: archivio del plugin (via bridge)');

  const workingCopies = new WorkingCopies(process.env.FIGMA_AUTOFILL_EXCEL_DIR || defaultExcelDir());
  await workingCopies.cleanStale();
  process.on('exit', () => workingCopies.releaseAll());
  log(`copie temporanee degli Excel in ${workingCopies.dir}`);

  const server = createMcpServer({ bridge, workingCopies });
  await server.connect(new StdioServerTransport());

  // Il processo deve uscire davvero quando il client chiude: se restasse appeso terrebbe la porta.
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(0), 1000).unref();
    void bridge.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
}

main().catch(error => {
  log(`avvio fallito: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
