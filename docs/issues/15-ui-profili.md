---
title: "Sezione Profili nella UI del plugin"
labels: [ready-for-agent, AFK]
blocked_by: [14]
---

## Parent

PRD: Profili brand come aiuto, non come vincolo

## What to build

Una sezione Profili nella UI del plugin. Contiene: selezione del profilo con i Profili di base distinti dai personali; creazione di un Profilo personale con il solo nome; vista e cancellazione delle proprie Aggiunte personali su un Profilo di base; rinomina e cancellazione dei Profili personali; avviso quando un Profilo di base non è più disponibile e le aggiunte sono state conservate come Profilo personale. Selezionare un profilo precompila nome di output, lingue e section senza bloccarne la modifica. Si possono anche non scegliere profili.

## Acceptance criteria

- [ ] La selezione di un profilo precompila le impostazioni e restano modificabili.
- [ ] Si può lavorare senza profilo selezionato.
- [ ] Un Profilo di base non si può modificare né cancellare dalla UI; le sue Aggiunte personali sì.
- [ ] L'avviso di Profilo di base rimosso compare una volta al primo avvio dopo l'aggiornamento.
- [ ] Test UI (seam 4) e harness plugin (seam 3).

## Blocked by

- 14 Archivio dei profili nel plugin

User stories: 24, 30, 32, 35, 38, 39
