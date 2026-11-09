---
title: "Esportazione e importazione dei Profili brand"
labels: [ready-for-agent, AFK]
blocked_by: [02]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Un designer esporta un Profilo brand in un file singolo da condividere; un collega lo importa e ottiene le stesse convenzioni. Se esiste già un profilo con lo stesso nome, l'importazione si ferma e chiede se sovrascrivere o importare con un nome diverso (`export_brand_profile`, `import_brand_profile`).

## Acceptance criteria

- [ ] L'esportazione produce un file valido contenente l'intero profilo, compresi glossario e Abbinamenti confermati.
- [ ] L'importazione valida il file e rifiuta versioni di schema non supportate con un messaggio chiaro.
- [ ] Un conflitto di nome non sovrascrive nulla senza conferma esplicita.
- [ ] Esportare e poi importare restituisce un profilo identico (round-trip).
- [ ] Test sul modulo (seam 2) e sui tool via MCP (seam 1).

## Blocked by

- 02 Profili brand: archivio e scelta del Brand nel dialogo

User stories: 13–15
