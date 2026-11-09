---
title: "Taratura e collaudo con Excel cliente reali in Figma Desktop"
labels: [HITL]
blocked_by: [10]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Collaudo del flusso completo in Figma Desktop con 2–3 Excel cliente reali anonimizzati, forniti dal team. Si tarano la soglia di similarità, la normalizzazione dei testi e l'euristica delle Celle multi-livello; i file anonimizzati diventano fixture dei test. Si verifica anche se l'accesso a `localhost` nel manifest è compatibile con la distribuzione prevista del plugin.

## Acceptance criteria

- [ ] Almeno 2 Excel cliente reali anonimizzati sono aggiunti come fixture.
- [ ] Soglia di similarità e normalizzazione sono tarate e documentate nei test.
- [ ] Il flusso completo è stato eseguito in Figma Desktop senza interventi manuali al di fuori del dialogo previsto.
- [ ] È stata presa una decisione sull'accesso a `localhost` per la distribuzione (ADR se necessario).

## Blocked by

- 10 Prompt MCP localizza-frame e README della modalità agente
