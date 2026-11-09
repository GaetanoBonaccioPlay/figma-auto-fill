---
title: "Prompt MCP localizza-frame e README della modalità agente"
labels: [ready-for-agent, AFK]
blocked_by: [06, 07, 08]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Il server espone il prompt MCP `localizza-frame`, che codifica l'ordine del dialogo: Brand → Excel cliente → conferma di foglio, Colonna sorgente e lingue → riepilogo abbinamenti → generazione (con eventuale conflitto) → Excel aggiornato → Traduzione AI facoltativa. Il README viene aggiornato con la modalità agente: avvio del server, registrazione nel client MCP, collegamento del plugin, Profili brand e loro condivisione, e la correzione della frase "non c'è un server / `networkAccess: none`".

## Acceptance criteria

- [ ] Il prompt è elencato dal server e descrive i passi nell'ordine previsto, usando i termini di CONTEXT.md.
- [ ] Un test end-to-end (seam 1) percorre l'intero dialogo con plugin finto e fixture `.xlsx`, fino all'Excel aggiornato.
- [ ] Il README documenta la modalità agente e l'accesso a `localhost`.

## Blocked by

- 06 Abbinamenti simili, Celle multi-livello e Abbinamenti confermati
- 07 Conflitto sostituisci / nuova versione gestito dall'agente
- 08 Excel aggiornato con i testi usati in Figma
