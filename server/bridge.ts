import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { AgentCommandName, BridgeRequest, BridgeResponse } from '../src/agent-protocol';

export const PLUGIN_NOT_CONNECTED = 'Il plugin Figma Auto Fill non è collegato: aprilo in Figma Desktop (Plugins → Development → Figma Auto Fill) e riprova';

export interface PluginLink {
  readonly connected: boolean;
  readonly startError: string | null;
  request<T = unknown>(command: AgentCommandName, payload?: unknown, timeoutMs?: number): Promise<T>;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

// Server WebSocket solo su loopback: il plugin (UI) si collega e riceve i comandi dell'agente.
export class Bridge implements PluginLink {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  startError: string | null = null;

  constructor(private readonly options: { port: number; timeoutMs?: number }) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get port(): number {
    const address = this.wss?.address();
    return typeof address === 'object' && address ? address.port : this.options.port;
  }

  start(): Promise<void> {
    return new Promise(resolve => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port: this.options.port,
        // Le pagine web mandano la loro origine; l'iframe del plugin Figma manda "null".
        verifyClient: ({ origin }: { origin?: string }) => origin === undefined || origin === 'null'
      });
      wss.once('listening', () => { this.wss = wss; resolve(); });
      wss.once('error', error => {
        this.startError = (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? `Porta ${this.options.port} già in uso: un'altra istanza del server è attiva?`
          : `Bridge non avviato: ${error.message}`;
        resolve();
      });
      wss.on('connection', socket => this.accept(socket));
    });
  }

  private accept(socket: WebSocket): void {
    let identified = false;
    socket.on('message', raw => {
      let message: unknown;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (!identified) {
        if ((message as { hello?: string }).hello !== 'figma-auto-fill-plugin') { socket.close(); return; }
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

  request<T = unknown>(command: AgentCommandName, payload?: unknown, timeoutMs = this.options.timeoutMs ?? 60_000): Promise<T> {
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
    this.failAll(new Error('Bridge chiuso'));
    this.socket?.close();
    await new Promise<void>(resolve => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }
}
