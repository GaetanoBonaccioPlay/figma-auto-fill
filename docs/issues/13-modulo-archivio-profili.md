---
title: "Schema profilo v2 e modulo puro dell'archivio (Profili di base, personali, Aggiunte personali)"
labels: [ready-for-agent, AFK]
blocked_by: []
---

## Parent

PRD: Profili brand come aiuto, non come vincolo

## What to build

Un modulo puro condiviso tra plugin e server con lo schema del Profilo brand versione 2. Lo schema include: nome (unico campo obbligatorio), lingua principale facoltativa, elenco di Modelli Excel, nome precedente facoltativo per i Profili di base. Il modulo offre: elenco con origine (base/personale); profilo effettivo come base più Aggiunte personali, con prevalenza delle aggiunte; registrazione di un fatto imparato; differenze tra un profilo e un Profilo di base; unione o sostituzione delle aggiunte; conversione delle aggiunte orfane in Profilo personale; risoluzione del nome precedente; migrazione dei profili versione 1.

## Acceptance criteria

- [ ] Un profilo con il solo nome è valido; un profilo non valido viene rifiutato indicando il campo errato.
- [ ] Profilo effettivo: un'aggiunta sul modello del nome prevale sul Profilo di base; un aggiornamento del base conserva le aggiunte.
- [ ] Le differenze tra un profilo importato e il suo base producono solo le novità.
- [ ] Aggiunte il cui base non esiste più diventano un Profilo personale completo; con nome precedente dichiarato si collegano al nuovo nome.
- [ ] Un profilo versione 1 (per esempio Aurora attuale) si migra senza perdite.
- [ ] Il modulo è compilabile sia nel bundle del plugin sia nel server.
- [ ] Test sui moduli puri (seam 2).

## Blocked by

Nessuno.

User stories: 28, 31–34, 38
