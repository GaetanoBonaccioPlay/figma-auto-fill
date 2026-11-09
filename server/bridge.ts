import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { AgentCommandName, BridgeRequest, BridgeResponse } from '../src/agent-protocol';

export const PLUGIN_NOT_CONNECTED = 'Il plugin Figma Auto Fill non è collegato: aprilo in Figma Desktop (Plugins → Development → Figma Auto Fill) e riprova';

export interface PluginLink {
  readonly connected: boolean;
  readonly startError: string | null;
  // Prende il collegamento col plugin se lo tiene un'altra istanza del server (vedi Bridge.claim).
  claim?(): Promise<void>;
  request<T = unknown>(command: AgentCommandName, payload?: unknown, timeoutMs?: number): Promise<T>;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

// Saluto con cui un'altra istanza del server chiede di cedere la porta.
const SERVER_HELLO = 'figma-auto-fill-server';
type YieldRequest = { hello: typeof SERVER_HELLO; action: 'yield' };
type YieldReply = { yielded: boolean; busy?: boolean };

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Server WebSocket solo su loopback: il plugin (UI) si collega e riceve i comandi dell'agente.
//
// Ogni sessione Claude (Desktop, Code, VS Code) avvia la propria istanza del server, e Claude Desktop
// a volte ne avvia due in rapida successione: la porta però è una sola. Chi non riesce ad aprirla
// resta in attesa e riprova da solo; quando un'istanza in attesa riceve una richiesta chiede a chi
// tiene la porta di cederla (se non ha richieste in corso), così vince la sessione che si sta usando.
export class Bridge implements PluginLink {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private listening: Promise<boolean> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private closed = false;
  startError: string | null = null;

  constructor(private readonly options: { port: number; timeoutMs?: number; retryMs?: number; pluginWaitMs?: number }) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  // true se questa istanza tiene la porta.
  get active(): boolean {
    return this.wss !== null;
  }

  get port(): number {
    const address = this.wss?.address();
    return typeof address === 'object' && address ? address.port : this.options.port;
  }

  private get retryMs(): number {
    return this.options.retryMs ?? 2000;
  }

  async start(): Promise<void> {
    if (!(await this.listen())) this.scheduleRetry();
  }

  private listen(): Promise<boolean> {
    if (this.wss) return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    this.listening ??= new Promise<boolean>(resolve => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port: this.options.port,
        // Le pagine web mandano la loro origine; l'iframe del plugin Figma manda "null".
        verifyClient: ({ origin }: { origin?: string }) => origin === undefined || origin === 'null'
      });
      wss.once('listening', () => {
        if (this.closed) { wss.close(); resolve(false); return; }
        this.wss = wss;
        this.startError = null;
        resolve(true);
      });
      wss.once('error', error => {
        this.startError = (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? `Porta ${this.options.port} già in uso da un'altra sessione di Claude: questa sessione la prende appena serve`
          : `Bridge non avviato: ${error.message}`;
        wss.close();
        resolve(false);
      });
      wss.on('connection', socket => this.accept(socket));
    }).finally(() => { this.listening = null; });
    return this.listening;
  }

  // In attesa riprova ad aprire la porta: si riprende da solo quando l'altra istanza si chiude.
  private scheduleRetry(delayMs = this.retryMs): void {
    if (this.closed || this.wss || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.listen().then(ok => { if (!ok) this.scheduleRetry(); });
    }, delayMs);
    this.retryTimer.unref();
  }

  // Chiede all'istanza che tiene la porta di cederla. "unreachable": nessuno risponde col nostro protocollo.
  private askToYield(): Promise<'yielded' | 'busy' | 'unreachable'> {
    return new Promise(resolve => {
      let done = false;
      const finish = (result: 'yielded' | 'busy' | 'unreachable'): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ws.removeAllListeners();
        ws.on('error', () => { /* già risolto */ });
        ws.terminate();
        resolve(result);
      };
      const ws = new WebSocket(`ws://127.0.0.1:${this.options.port}`);
      const timer = setTimeout(() => finish('unreachable'), 2000);
      ws.once('open', () => {
        const request: YieldRequest = { hello: SERVER_HELLO, action: 'yield' };
        ws.send(JSON.stringify(request));
      });
      ws.once('message', raw => {
        let reply: Partial<YieldReply> = {};
        try { reply = JSON.parse(String(raw)) as YieldReply; } catch { /* risposta non valida */ }
        finish(reply.yielded ? 'yielded' : reply.busy ? 'busy' : 'unreachable');
      });
      ws.once('close', () => finish('unreachable'));
      ws.once('error', () => finish('unreachable'));
    });
  }

  // Se la porta è di un'altra istanza se la fa cedere, poi aspetta che il plugin si ricolleghi.
  async claim(): Promise<void> {
    if (this.closed || this.wss) return;
    if (await this.listen()) { await this.waitForPlugin(); return; }
    const answer = await this.askToYield();
    if (answer === 'busy') {
      this.startError = 'Un\'altra sessione di Claude sta usando il plugin in questo momento: riprova tra poco';
      return;
    }
    const end = Date.now() + 3000;
    while (!this.wss && !this.closed && Date.now() < end) {
      if (await this.listen()) break;
      await sleep(100);
    }
    if (!this.wss) {
      this.startError = answer === 'yielded'
        ? `Porta ${this.options.port} ceduta ma non riaperta in tempo: riprova`
        : `Porta ${this.options.port} occupata da un processo che non la cede (una versione vecchia del server o un altro programma). Controlla con: lsof -i :${this.options.port}`;
      this.scheduleRetry();
      return;
    }
    await this.waitForPlugin();
  }

  private async waitForPlugin(): Promise<void> {
    // Il plugin ritenta il collegamento ogni 2 s.
    const end = Date.now() + (this.options.pluginWaitMs ?? 4000);
    while (!this.connected && !this.closed && Date.now() < end) await sleep(50);
  }

  // Cede la porta a un'altra istanza e si rimette in attesa.
  private release(): void {
    const wss = this.wss;
    if (!wss) return;
    this.wss = null;
    this.socket = null;
    for (const client of wss.clients) client.terminate();
    wss.close();
    this.startError = 'Il collegamento col plugin è passato a un\'altra sessione di Claude: questa sessione lo riprende appena serve';
    this.scheduleRetry();
  }

  private accept(socket: WebSocket): void {
    let identified = false;
    socket.on('message', raw => {
      let message: unknown;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (!identified) {
        const hello = message as { hello?: string; action?: string };
        if (hello.hello === SERVER_HELLO && hello.action === 'yield') {
          // Mai a metà di un comando: l'altra istanza riproverà.
          const busy = this.pending.size > 0;
          const reply: YieldReply = busy ? { yielded: false, busy: true } : { yielded: true };
          socket.send(JSON.stringify(reply), () => { if (busy) socket.close(); else this.release(); });
          return;
        }
        if (hello.hello !== 'figma-auto-fill-plugin') { socket.close(); return; }
        identified = true;
        const previous = this.socket;
        this.socket = socket;
        if (previous && previous !== socket) previous.close();
        return;
      }
      this.settle(message as BridgeResponse);
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.failAll(new Error('Il plugin si è scollegato durante la richiesta'));
    });
  }

  private settle(response: BridgeResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.data);
    else pending.reject(new Error(response.error));
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  async request<T = unknown>(command: AgentCommandName, payload?: unknown, timeoutMs = this.options.timeoutMs ?? 60_000): Promise<T> {
    if (!this.wss) await this.claim();
    return this.send<T>(command, payload, timeoutMs);
  }

  private send<T>(command: AgentCommandName, payload: unknown, timeoutMs: number): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(PLUGIN_NOT_CONNECTED));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Il plugin non ha risposto entro ${Math.round(timeoutMs / 1000)} s al comando "${command}"`));
      }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      const request: BridgeRequest = { id, command, payload };
      socket.send(JSON.stringify(request), error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failAll(new Error('Bridge chiuso'));
    const wss = this.wss;
    this.wss = null;
    this.socket = null;
    if (!wss) return;
    // Senza chiudere i client la porta resterebbe tenuta dal plugin collegato.
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  }
}
