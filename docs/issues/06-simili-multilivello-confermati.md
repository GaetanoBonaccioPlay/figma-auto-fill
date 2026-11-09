---
title: "Abbinamenti simili, Celle multi-livello e Abbinamenti confermati"
labels: [ready-for-agent, AFK]
blocked_by: [05]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

L'abbinamento si estende ai casi dubbi: i testi simili vengono proposti con un punteggio e il confronto Figma ↔ Excel; le Celle multi-livello (una cella che contiene il testo di più livelli dello stesso frame) vengono segnalate con un avviso e mai abbinate, così che le sistemi il designer. L'agente presenta un unico riepilogo (simili, Livelli orfani, Celle multi-livello). Le decisioni vengono salvate con `confirm_matches` come Abbinamenti confermati nel Profilo brand e, nelle sessioni successive, diventano esatte; quelli che puntano a righe non più presenti nell'Excel vengono ignorati.

## Acceptance criteria

- [ ] I simili hanno un punteggio sopra una soglia configurabile e sotto il 100%.
- [ ] Una Cella multi-livello produce un avviso con la cella e i livelli coinvolti e non genera abbinamenti.
- [ ] Il riepilogo è un'unica struttura con le tre categorie.
- [ ] Gli Abbinamenti confermati vengono salvati nel Profilo brand e riapplicati come esatti.
- [ ] Gli Abbinamenti confermati obsoleti non vengono applicati.
- [ ] Test sul modulo (seam 2) e via MCP (seam 1).

## Blocked by

- 05 Abbinamento esatto e generazione degli export in Figma

User stories: 25–27, 29, 30
