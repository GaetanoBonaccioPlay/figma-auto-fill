---
title: "Profili brand: archivio e scelta del Brand nel dialogo"
labels: [ready-for-agent, AFK]
blocked_by: [01]
---

## Parent

PRD: Agente MCP per la localizzazione dei frame da Excel cliente

## What to build

I Profili brand vivono in una cartella del progetto, un file JSON per Brand, validati da uno schema versionato (nome, modello del nome di output e numero iniziale, lingua principale, lingue e varianti abituali, organizzazione in section, Glossario brand opzionale, Abbinamenti confermati). L'agente può elencarli, leggerli, crearne uno nuovo durante il dialogo e modificarli (`list_brand_profiles`, `get_brand_profile`, `save_brand_profile`). Il primo passo del flusso è sempre la scelta del Brand.

## Acceptance criteria

- [ ] I profili vengono letti e scritti nella cartella dedicata del progetto.
- [ ] Un profilo non valido viene rifiutato con un messaggio che indica il campo errato.
- [ ] L'agente può creare un profilo per un Brand inesistente e modificarne uno esistente.
- [ ] Lo schema ha un campo `version`.
- [ ] Test sul modulo Profili brand (seam 2) e sui tool via MCP (seam 1).

## Blocked by

- 01 Tracer bullet: bridge MCP ↔ plugin e lettura della selezione

User stories: 7–11
