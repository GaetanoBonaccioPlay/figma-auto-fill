---
title: "Excel aggiornato con i testi usati in Figma"
labels: [ready-for-agent, AFK]
blocked_by: [05]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

Dopo la generazione, `write_updated_excel` scrive la copia `<nome>_updated.xlsx` dell'Excel cliente con i testi effettivamente usati in Figma, comprese le correzioni fatte a mano nei frame di `EXPORT`. Fogli, colonne e formattazione del cliente vengono conservati; ogni cella scritta viene evidenziata e annotata con la fonte (`figma:<frame>`); i Livelli orfani vengono aggiunti come nuove righe in coda al foglio. Nessuna cella già piena viene sovrascritta senza conferma: i conflitti tra Excel e Figma vengono restituiti all'agente, che li mostra al designer. Il file originale non viene mai modificato. Lato server serve una libreria xlsx che conservi stili e scriva commenti (per esempio ExcelJS); il plugin resta su SheetJS.

## Acceptance criteria

- [ ] Il file originale resta byte per byte invariato; la copia `_updated` viene creata accanto.
- [ ] Fogli, larghezze di colonna e stili esistenti sono conservati.
- [ ] Ogni cella scritta ha riempimento e commento con la fonte.
- [ ] Le celle piene in conflitto non vengono toccate senza conferma per cella; i conflitti vengono restituiti.
- [ ] I Livelli orfani compaiono in coda con il testo sorgente.
- [ ] Test sul modulo con fixture `.xlsx` (seam 2) e via MCP (seam 1).

## Blocked by

- 05 Abbinamento esatto e generazione degli export in Figma

User stories: 36–41
