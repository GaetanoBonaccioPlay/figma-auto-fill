import { BRIDGE_URL, PLUGIN_ALREADY_CONNECTED, type AgentCommandMessage, type AgentResultMessage, type BridgeHello, type BridgeRequest, type BridgeResponse, type UiState } from './agent-protocol';

const RECONNECT_MS = 2000;
// Senza benvenuto entro questo tempo il server è di una versione precedente (non lo manda) e il plugin è collegato.
// È più lungo del ping con cui il server verifica un altro plugin già collegato, prima di rifiutare questo.
export const WELCOME_FALLBACK_MS = 1500;

// Collega la UI del plugin al server MCP locale e fa da relay verso il codice Figma.
// Se il server non è raggiungibile riprova in silenzio: il plugin resta usabile a mano.
// `busy`: il server ha già un altro plugin collegato (per esempio in un altro file Figma) e ha rifiutato questo.
export type AgentStatus = { connected: boolean; busy: boolean };
export function startAgentBridge(onStatus: (connected: boolean, status: AgentStatus) => void, uiState?: () => UiState): void {
  let socket: WebSocket | null = null;
  // Si dice «collegato» solo al benvenuto del server: un rifiuto (altro plugin già collegato) arriva prima e non fa lampeggiare lo stato.
  let welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  const stopWelcomeTimer = (): void => { if (welcomeTimer !== null) clearTimeout(welcomeTimer); welcomeTimer = null; };
  const report = (connected: boolean, busy = false): void => onStatus(connected, { connected, busy });

  const toFigma = (message: AgentCommandMessage): void => {
    parent.postMessage({ pluginMessage: message }, '*');
  };

  window.addEventListener('message', event => {
    const message = (event.data as { pluginMessage?: AgentResultMessage } | undefined)?.pluginMessage;
    if (!message || message.kind !== 'agent-result' || socket?.readyState !== WebSocket.OPEN) return;
    const response: BridgeResponse = message.ok
      ? { id: message.id, ok: true, data: message.data }
      : { id: message.id, ok: false, error: message.error };
    socket.send(JSON.stringify(response));
  });

  const connect = (): void => {
    let current: WebSocket;
    try { current = new WebSocket(BRIDGE_URL); }
    catch { setTimeout(connect, RECONNECT_MS); return; }
    socket = current;
    current.onopen = () => {
      const hello: BridgeHello = { hello: 'figma-auto-fill-plugin' };
      current.send(JSON.stringify(hello));
      stopWelcomeTimer();
      welcomeTimer = setTimeout(() => {
        welcomeTimer = null;
        if (socket === current && current.readyState === WebSocket.OPEN) report(true);
      }, WELCOME_FALLBACK_MS);
    };
    current.onmessage = event => {
      let request: BridgeRequest;
      try { request = JSON.parse(String(event.data)) as BridgeRequest; }
      catch { return; }
      if ((request as unknown as { welcome?: string }).welcome === 'figma-auto-fill-server') {
        stopWelcomeTimer();
        report(true);
        return;
      }
      if (typeof request.id !== 'string' || typeof request.command !== 'string') return;
      if (request.command === 'ui-state') {
        // Lo stato della UI vive qui, non nel codice Figma: si risponde senza passare da Figma.
        const response: BridgeResponse = uiState
          ? { id: request.id, ok: true, data: uiState() }
          : { id: request.id, ok: false, error: 'Questa versione del plugin non espone lo stato della UI' };
        current.send(JSON.stringify(response));
        return;
      }
      toFigma({ kind: 'agent-command', id: request.id, command: request.command, payload: request.payload });
    };
    current.onclose = event => {
      if (socket === current) socket = null;
      stopWelcomeTimer();
      report(false, event?.code === PLUGIN_ALREADY_CONNECTED);
      setTimeout(connect, RECONNECT_MS);
    };
    current.onerror = () => { /* onclose gestisce il nuovo tentativo */ };
  };

  report(false);
  connect();
}
