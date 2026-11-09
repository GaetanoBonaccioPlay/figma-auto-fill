---
title: "Abbinamento esatto e generazione degli export in Figma"
labels: [ready-for-agent, AFK]
blocked_by: [04]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Il primo flusso completo dimostrabile: l'agente abbina i livelli di testo dei frame selezionati alle righe dell'Excel cliente tramite la Colonna sorgente, considerando solo gli abbinamenti esatti (normalizzazione di spazi, maiuscole, punteggiatura finale e tag di formattazione); i Livelli orfani usano il fallback della lingua principale. `generate_exports` costruisce le righe di traduzione e le fa generare al plugin con le regole esistenti (MASTER, section, nomi da Profilo brand), poi restituisce un resoconto con frame creati, fallback usati e possibili overflow. Questa slice copre il caso senza export preesistenti con lo stesso nome; il conflitto sostituisci/versione è coperto dalla issue 07.

## Acceptance criteria

- [ ] `match_selection` restituisce abbinamenti esatti e Livelli orfani per i frame selezionati.
- [ ] `generate_exports` produce in `EXPORT` gli stessi frame che produrrebbe il flusso manuale con gli stessi testi.
- [ ] Nomi duplicati negli export bloccano la generazione con una spiegazione.
- [ ] Un errore Figma durante la generazione non lascia export parziali.
- [ ] Il resoconto elenca frame creati, fallback e possibili overflow.
- [ ] Test sul modulo Abbinamento (seam 2), sul flusso via MCP con plugin finto (seam 1) e sull'harness del plugin (seam 3).

## Blocked by

- 04 Analisi dell'Excel cliente e conferma delle lingue

User stories: 24, 28, 31, 33–35
