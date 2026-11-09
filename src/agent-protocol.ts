// Messaggi scambiati sul bridge locale tra server MCP, UI del plugin e codice Figma.
// Server ⇄ UI viaggiano su WebSocket (JSON); UI ⇄ codice Figma su postMessage.

export const BRIDGE_PORT = 3055;
export const BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;

export type AgentCommandName = 'snapshot' | 'plan' | 'generate' | 'ui-state';

// Valori compilati nella UI del plugin: l'agente li usa al posto dei default (nome output, nomi base, section).
export type UiState = {
  naming: { template: string; start: number; date: string };
  baseNames: Record<string, string>;
  sectionMode: 'none' | 'locale' | 'base';
  targets: string[];
  primary: string;
};

// Server → plugin
export type BridgeRequest = { id: string; command: AgentCommandName; payload?: unknown };
// Plugin → server
export type BridgeResponse = { id: string; ok: true; data: unknown } | { id: string; ok: false; error: string };
// Primo messaggio inviato dal plugin dopo la connessione
export type BridgeHello = { hello: 'figma-auto-fill-plugin' };

// UI → codice Figma / codice Figma → UI
export type AgentCommandMessage = { kind: 'agent-command'; id: string; command: AgentCommandName; payload?: unknown };
export type AgentResultMessage =
  | { kind: 'agent-result'; id: string; ok: true; data: unknown }
  | { kind: 'agent-result'; id: string; ok: false; error: string };
