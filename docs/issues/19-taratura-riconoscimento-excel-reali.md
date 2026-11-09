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

- Nel formato d'agenzia le colonne `IE`, `FI`, `NL` sono inglese per Irlanda, Finlandia e Paesi Bassi, ma l'analisi automatica le legge come lingue e non riconosce `AT` né `BE EN`. Ora, con un Brand, le corrispondenze intestazione → lingua del suo Modello Excel prevalgono (`IE` → `EN_IE`, `AT` → `DE_AT`, `BE FR` → `FR_BE`) e l'agente mostra le correzioni (`profileMapping`). Il Modello Excel d'agenzia di Columbia è allineato ai codici del suo formato master.
- Le varianti di una lingua già nel profilo (`FR_BE` con `FR`) non vengono più proposte come lingue nuove.

## Collaudo d'integrazione (2026-11-09)

Server MCP reale, codice compilato del plugin (`dist/code.js`) con Figma simulato, relay come la UI, Excel d'agenzia Columbia reale (`ecom-52631-…-technical-tee-focus`), frame con i suoi testi inglesi più un livello `To:`:

- Columbia riconosciuto con candidato chiaro (0,68); dopo la conferma la mappatura è corretta dal profilo.
- Colonna sorgente scelta dai dati: A (`EN_GB`), diversa da `EN` del profilo, segnalata.
- 4 abbinamenti esatti; `To:` escluso e salvato come Aggiunta personale in `clientStorage`, il Profilo di base intatto.
- 8 export generati in `EXPORT` con le traduzioni reali; Excel aggiornato scritto con le sole righe usate; originale intatto (lavorato su una copia).
- A fine sessione proposte solo le novità vere: lingue `CS` e `PL`, Modello Excel aggiornato.

Resta da fare a mano con il designer: la stessa sessione in Figma Desktop con Claude Desktop o Claude Code (sezione Profilo brand della UI, export/import tra due utenti).

## Blocked by

- 17 Modello Excel: estrazione e riconoscimento
- 18 Proposte di salvataggio a fine sessione

User stories: 10–17, 23

## Collaudo manuale in Figma Desktop

- 2026-11-09, apertura del plugin: Figma rifiutava il codice con `SyntaxError: possible import expression rejected around line 1`. Causa: il metodo dell'archivio chiamato come la parola chiave degli import, che nel bundle somiglia a un import dinamico. Corretto (`importFile`) e aggiunto un test che controlla il bundle con lo stesso schema del sandbox di Figma.
