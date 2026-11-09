import { BRIDGE_URL, type AgentCommandMessage, type AgentResultMessage, type BridgeHello, type BridgeRequest, type BridgeResponse, type UiState } from './agent-protocol';

const RECONNECT_MS = 2000;

// Collega la UI del plugin al server MCP locale e fa da relay verso il codice Figma.
// Se il server non è raggiungibile riprova in silenzio: il plugin resta usabile a mano.
export function startAgentBridge(onStatus: (connected: boolean) => void, uiState?: () => UiState): void {
  let socket: WebSocket | null = null;

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
      onStatus(true);
    };
    current.onmessage = event => {
      let request: BridgeRequest;
      try { request = JSON.parse(String(event.data)) as BridgeRequest; }
      catch { return; }
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
    current.onclose = () => {
      if (socket === current) socket = null;
      onStatus(false);
      setTimeout(connect, RECONNECT_MS);
    };
    current.onerror = () => { /* onclose gestisce il nuovo tentativo */ };
  };

  onStatus(false);
  connect();
}
