---
title: "Proposte di salvataggio a fine sessione: nuova reference e aggiornamento del profilo"
labels: [ready-for-agent, AFK]
blocked_by: [12, 14, 17]
---

## Parent

PRD: Profili brand come aiuto, non come vincolo

## What to build

A fine sessione l'agente propone di salvare ciò che è emerso, sempre su conferma. Senza Brand propone di salvare l'Excel come nuovo Profilo personale, con un nome suggerito dal file e modificabile; il profilo include Modello Excel, impostazioni usate, Livelli esclusi e abbinamenti confermati della sessione. Con un Brand propone di aggiornare il profilo con le novità dell'Excel (Modello Excel, lingue nuove). Alla fine della generazione, se nome di output, lingue o section differiscono dal profilo effettivo, chiede in una riga se ricordarli. Senza un sì il profilo non cambia; su un Profilo di base le modifiche diventano Aggiunte personali.

## Acceptance criteria

- [ ] Sessione senza Brand: con un sì nasce un Profilo personale riconosciuto alla sessione successiva sullo stesso Excel; con un no l'archivio resta invariato.
- [ ] Con Columbia di base e un Excel con PT-BR, il sì crea un'Aggiunta personale e il Profilo di base resta intatto.
- [ ] Impostazioni diverse dal profilo non si salvano senza conferma.
- [ ] Il prompt `localizza-frame` descrive queste proposte nel punto giusto del flusso.
- [ ] Test end-to-end MCP (seam 1).

## Blocked by

- 12 Sessione agente senza Brand
- 14 Archivio dei profili nel plugin
- 17 Modello Excel: estrazione e riconoscimento

User stories: 7–9, 21, 22, 37
