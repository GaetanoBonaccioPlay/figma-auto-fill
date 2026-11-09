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

- [ ] Ogni Excel reale disponibile viene riconosciuto come il proprio Brand e mai come l'altro.
- [ ] Columbia e The North Face versione 2 sono nel repository e passano la build.
- [ ] Il collaudo manuale è annotato con eventuali correzioni.

## Blocked by

- 17 Modello Excel: estrazione e riconoscimento
- 18 Proposte di salvataggio a fine sessione

User stories: 10–17, 23
