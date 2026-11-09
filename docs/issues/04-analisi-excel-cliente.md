---
title: "Analisi dell'Excel cliente e conferma delle lingue"
labels: [ready-for-agent, AFK]
blocked_by: [02]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Dato il percorso di un Excel cliente con struttura libera, `analyze_client_excel` restituisce i fogli, la riga di intestazione individuata, le colonne lingua candidate con codice normalizzato e confidenza (anche per intestazioni a nome come `English`, `Deutsch` o codici non standard come `FR-fr`), le colonne ignorate (note, ID, stato, vuote) e la Colonna sorgente proposta in base alla lingua principale del Profilo brand. Restituisce anche le differenze tra lingue dell'Excel e lingue abituali del profilo, con l'Excel che vince. L'agente presenta il risultato e chiede una sola conferma (foglio, Colonna sorgente, mappatura lingue).

## Acceptance criteria

- [ ] Con più fogli, l'analisi li elenca e propone quello più probabile.
- [ ] Intestazioni a nome lingua (italiano, inglese e nella lingua stessa, almeno per le lingue del catalogo) e codici non standard vengono convertiti in codici ISO coerenti con il plugin.
- [ ] Righe di titolo sopra l'intestazione e colonne non linguistiche non generano lingue.
- [ ] La Colonna sorgente proposta è quella della lingua principale del profilo; se manca, l'analisi lo segnala.
- [ ] Le differenze con il Profilo brand vengono restituite come lingue mancanti e lingue in più.
- [ ] Test sul modulo con fixture `.xlsx` generate nei test (seam 2) e sul tool via MCP (seam 1).

## Blocked by

- 02 Profili brand: archivio e scelta del Brand nel dialogo

User stories: 16–22
