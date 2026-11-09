# Il server MCP comanda il plugin tramite un bridge WebSocket su localhost

Un agente AI deve poter guidare il flusso di localizzazione (selezione frame, lingue, generazione export, aggiornamento Excel). Abbiamo scelto un server MCP locale (Node, stdio) che apre un WebSocket su `localhost`, al quale si collega la UI del plugin aperto in Figma Desktop: il plugin resta l'unico esecutore della logica di generazione (MASTER, versioni, section), mentre il server gestisce dialogo, analisi e scrittura dell'Excel cliente (struttura libera) riusando la logica di `core.ts`.

## Considered Options

- **Figma MCP ufficiale (`use_figma`) senza bridge**: scartato perché richiede di iniettare o duplicare la logica di `plugin.ts` a ogni chiamata e rende meno affidabile la lettura della selezione corrente dell'utente.
- **Figma REST API**: scartata, non può creare né modificare nodi.

## Consequences

- Il manifest non è più `networkAccess: none`: va consentito `localhost` (il README va aggiornato, oggi dichiara "non c'è un server").
- La sessione dell'agente funziona solo con il plugin aperto in Figma Desktop.
