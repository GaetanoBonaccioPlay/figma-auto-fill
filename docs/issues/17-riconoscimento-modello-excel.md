---
title: "Modello Excel: estrazione e riconoscimento del Brand"
labels: [ready-for-agent, AFK]
blocked_by: [12, 13, 14]
---

## Parent

PRD: Profili brand come aiuto, non come vincolo

## What to build

Un modulo puro estrae il Modello Excel da un foglio analizzato: nome del foglio, riga di intestazione, intestazioni con codice lingua, colonna ID, Colonna sorgente, Etichette ricorrenti. Non conserva celle delle colonne lingua né ID. Calcola un punteggio di somiglianza con i Modelli Excel di tutti i profili, di base e personali; le Etichette ricorrenti pesano più delle intestazioni generiche. L'analisi dell'Excel restituisce uno di tre esiti: un candidato chiaro, più candidati vicini, nessun candidato. Ogni candidato riporta gli elementi in comune. Se nel plugin è selezionato un profilo diverso dal candidato, il server restituisce entrambi senza scegliere e il prompt fa chiedere al designer.

## Acceptance criteria

- [ ] Il Modello Excel estratto non contiene testi delle colonne lingua né ID.
- [ ] Un Excel Columbia con foglio rinominato viene ancora riconosciuto come Columbia grazie alle Etichette ricorrenti.
- [ ] Un Excel Columbia e uno The North Face non vengono confusi.
- [ ] Un Excel sconosciuto dà "nessun candidato" e la sessione prosegue senza Brand.
- [ ] Profilo selezionato nel plugin diverso dal candidato: entrambi nel risultato, nessuna scelta automatica.
- [ ] Test sui moduli puri (seam 2) ed end-to-end MCP (seam 1).

## Blocked by

- 12 Sessione agente senza Brand
- 13 Schema profilo v2
- 14 Archivio dei profili nel plugin

User stories: 10–17
