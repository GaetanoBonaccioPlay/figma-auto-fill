---
title: "Conflitto sostituisci / nuova versione gestito dall'agente"
labels: [ready-for-agent, AFK]
blocked_by: [05]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Quando in `EXPORT` esistono già export creati dal plugin con gli stessi nomi, `generate_exports` non genera e restituisce il conflitto (gruppi coinvolti, versione successiva proposta). L'agente chiede al designer se sostituire o creare una nuova versione `_vN` e richiama con la scelta. Il comportamento è identico al dialogo del flusso manuale, compresa la riedizione a partire dal MASTER.

## Acceptance criteria

- [ ] Senza `onConflict`, un conflitto restituisce l'elenco dei gruppi e nessun frame viene creato.
- [ ] `onConflict = replace` sostituisce gli export esistenti come il flusso manuale.
- [ ] `onConflict = version` crea `_v2`, `_v3`… con lo stesso suffisso per tutte le lingue del gruppo, conservando il gruppo precedente.
- [ ] La riedizione con MASTER selezionato recupera i testi delle varianti collegate.
- [ ] Test via MCP con plugin finto (seam 1) e sull'harness del plugin (seam 3).

## Blocked by

- 05 Abbinamento esatto e generazione degli export in Figma

User stories: 32
