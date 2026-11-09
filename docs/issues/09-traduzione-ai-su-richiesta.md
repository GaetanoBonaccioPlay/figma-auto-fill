---
title: "Traduzione AI delle celle vuote, su richiesta"
labels: [ready-for-agent, AFK]
blocked_by: [08]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Dopo l'Excel aggiornato, l'agente chiede esplicitamente se tradurre le N celle vuote. Se il designer accetta, `list_empty_cells` restituisce le celle con testo sorgente, lingua di destinazione e Glossario brand; la traduzione la esegue il modello dell'agente (il server non ha chiavi API). Le traduzioni vengono mostrate per la revisione e, una volta approvate, scritte con fonte `ai`, evidenziate in modo distinto dai testi forniti e, se richiesto, usate per rigenerare i frame.

## Acceptance criteria

- [ ] Nessuna Traduzione AI avviene senza una richiesta esplicita.
- [ ] `list_empty_cells` include il Glossario brand pertinente per lingua.
- [ ] Le scritture con fonte `ai` hanno evidenziazione e commento distinti da quelle `figma:`.
- [ ] Le traduzioni passano dalla revisione del designer prima di essere scritte o usate in Figma.
- [ ] Il Glossario brand è modificabile nel Profilo brand.
- [ ] Test sul modulo (seam 2) e via MCP (seam 1).

## Blocked by

- 08 Excel aggiornato con i testi usati in Figma

User stories: 12, 42–45
