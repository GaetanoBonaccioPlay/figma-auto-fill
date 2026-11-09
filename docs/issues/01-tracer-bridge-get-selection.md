---
title: "Tracer bullet: bridge MCP ↔ plugin e lettura della selezione"
labels: [ready-for-agent, AFK]
blocked_by: []
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Il primo percorso completo agente → server MCP → plugin → Figma e ritorno. Un server MCP locale (stdio) apre un WebSocket su `localhost`; la UI del plugin, in una nuova modalità agente, si collega automaticamente e si ricollega se il server riparte. L'agente può chiedere lo stato del collegamento (`bridge_status`) e leggere i frame selezionati con i loro livelli di testo (`get_selection`), con le stesse regole del plugin (livelli nascosti esclusi, chiavi univoche). Il plugin mostra se è collegato; il flusso manuale resta invariato. Il manifest consente `localhost` per l'uso in sviluppo (vedi ADR 0001).

## Acceptance criteria

- [ ] Il server MCP si avvia con un solo comando ed è registrabile in un client MCP.
- [ ] Il plugin aperto in Figma Desktop si collega senza configurazione e mostra lo stato del collegamento.
- [ ] Il plugin si ricollega da solo dopo un riavvio del server.
- [ ] `bridge_status` restituisce collegato / non collegato; con plugin chiuso gli altri tool rispondono con un errore esplicito che dice di aprire il plugin.
- [ ] `get_selection` restituisce frame selezionati (anche dentro section) e livelli di testo visibili con chiavi univoche, come il flusso manuale.
- [ ] Il protocollo usa messaggi con id di correlazione e timeout.
- [ ] Test: client MCP di test + plugin WebSocket finto (seam 1); estensione dell'harness `vm` del plugin per i nuovi messaggi (seam 3); `npm run check` verde.

## Blocked by

None - can start immediately

User stories: 1–6, 23
