---
title: "Sessione agente senza Brand e Colonna sorgente dai dati"
labels: [ready-for-agent, AFK]
blocked_by: []
---

## Parent

PRD: Profili brand come aiuto, non come vincolo

## What to build

La sessione MCP non richiede più un Brand. Analisi, abbinamento, generazione, Excel aggiornato e Traduzione AI funzionano con un profilo effettivo che può mancare. Senza profilo, Livelli esclusi e abbinamenti confermati restano nella memoria della sessione. La Colonna sorgente si sceglie in base a quanti testi di ogni colonna lingua coincidono con i livelli Figma selezionati; la lingua principale del profilo pesa solo a parità. Le differenze tra Excel e profilo compaiono nel report come informazione, non come errore. Il prompt `localizza-frame` parte dall'Excel cliente.

## Acceptance criteria

- [ ] Nessun tool fallisce con "Scegli prima il Brand": il flusso completo arriva all'Excel aggiornato senza profilo.
- [ ] Senza profilo si usano modello del nome, nomi base e section della UI del plugin.
- [ ] Con un profilo EN e un Excel i cui testi coincidono con la colonna DE, la Colonna sorgente proposta è DE e la differenza viene segnalata.
- [ ] Senza profilo, `exclude_layers` e `confirm_matches` valgono per i successivi `match_selection` della stessa sessione.
- [ ] Con un profilo, foglio rinominato e lingua nuova compaiono come differenze informative.
- [ ] Test end-to-end MCP (seam 1).

## Blocked by

Nessuno.

User stories: 1–6, 18–20
