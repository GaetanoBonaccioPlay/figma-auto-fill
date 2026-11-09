---
title: "Taratura del riconoscimento e migrazione di Columbia e The North Face"
labels: [HITL]
blocked_by: [17, 18]
---

## Parent

PRD: Profili brand come aiuto, non come vincolo

## What to build

Con gli Excel reali di Columbia e The North Face si tarano le soglie del riconoscimento: candidato chiaro, candidati vicini, nessun candidato. Si migrano i due profili in `brand-profiles/` allo schema versione 2 con il loro Modello Excel e si committano come primi Profili di base. Collaudo in Figma Desktop con Claude: sessione senza Brand, riconoscimento, export e import tra due utenti.

## Acceptance criteria

- [x] Ogni Excel reale disponibile viene riconosciuto come il proprio Brand e mai come l'altro.
- [x] Columbia e The North Face versione 2 sono nel repository e passano la build.
- [ ] Il collaudo manuale è annotato con eventuali correzioni.

## Esito della taratura (2026-11-09)

Campione: 22 Excel Columbia (15 in formato "master", 7 nel formato d'agenzia), 1 The North Face, 52 Sorel come controllo.

- Somiglianza Columbia ↔ The North Face: al massimo 0,30. Columbia master tra loro: minimo 0,71; Columbia d'agenzia tra loro: mediana 0,54.
- Riconoscimento leave-one-out con i profili Columbia e The North Face: 22/22 Excel Columbia riconosciuti con candidato chiaro. The North Face ha un solo file: non verificabile finché non ne arriva un secondo.
- Soglie confermate: somiglianza minima 0,5, distacco 0,15. Aggiunto il confronto per parole delle Etichette ricorrenti, che variano a ogni campagna.
- Sorel usa gli stessi due formati di Columbia: senza un profilo Sorel un Excel Sorel viene proposto come Columbia (il designer lo rifiuta alla conferma); con un profilo Sorel i casi sono chiari o ambigui con il candidato giusto, mai chiari sbagliati.
- Columbia ha due Modelli Excel (master e agenzia), Columbia e The North Face ne hanno uno ciascuno per formato: generati dal file più rappresentativo di ciascun formato.

Correzioni emerse dai file reali:

- Un foglio formattato fino alla riga 1.048.576 bloccava la lettura: ora si legge fino all'ultima cella con un valore.
- Una colonna lingua non riconosciuta (`Dutch NLNL`, `AT`, `BE EN`) faceva passare testi del cliente tra le Etichette ricorrenti: ora le etichette vengono solo dalle colonne-chiave (intestazione vuota, `Context`, `Field`, …).

Da verificare nel collaudo in Figma Desktop:

- Nel formato d'agenzia le colonne `IE`, `FI`, `NL` sono inglese per Irlanda, Finlandia e Paesi Bassi, ma l'analisi le legge come lingue (`IE`, finlandese, olandese) e non riconosce `AT`, `BE EN`, `Dutch NLNL`: il designer deve correggere la mappatura. Proposta: riusare le corrispondenze intestazione → lingua del Modello Excel del Brand riconosciuto.

## Blocked by

- 17 Modello Excel: estrazione e riconoscimento
- 18 Proposte di salvataggio a fine sessione

User stories: 10–17, 23
