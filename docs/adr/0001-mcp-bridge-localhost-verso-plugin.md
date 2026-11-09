# Il server MCP comanda il plugin tramite un bridge WebSocket su localhost

Un agente AI deve poter guidare il flusso di localizzazione (selezione frame, lingue, generazione export, aggiornamento Excel). Abbiamo scelto un server MCP locale (Node, stdio) che apre un WebSocket su `localhost`, al quale si collega la UI del plugin aperto in Figma Desktop: il plugin resta l'unico esecutore della logica di generazione (MASTER, versioni, section), mentre il server gestisce dialogo, analisi e scrittura dell'Excel cliente (struttura libera) riusando la logica di `core.ts`.

## Considered Options

- **Figma MCP ufficiale (`use_figma`) senza bridge**: scartato perché richiede di iniettare o duplicare la logica di `plugin.ts` a ogni chiamata e rende meno affidabile la lettura della selezione corrente dell'utente.
- **Figma REST API**: scartata, non può creare né modificare nodi.

## Consequences

- Il manifest consente `localhost` solo tramite `devAllowedDomains`, valido per il plugin importato da manifest in sviluppo: pubblicare il plugin con la modalità agente richiede una decisione separata sull'accesso alla rete.
- Il server accetta solo connessioni su loopback con origine `null` (iframe del plugin), per impedire a una pagina web di farsi passare per il plugin.
- La sessione dell'agente funziona solo con il plugin aperto in Figma Desktop.
