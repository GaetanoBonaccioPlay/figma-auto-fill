---
title: "Archivio dei profili nel plugin, Profili di base compilati e accesso dell'agente via bridge"
labels: [ready-for-agent, AFK]
blocked_by: [13]
---

## Parent

PRD: Profili brand come aiuto, non come vincolo

## What to build

Implementa l'ADR 0002. La build compila nel plugin i profili della cartella dei Profili di base del repository e fallisce se uno non è valido. Il codice del plugin custodisce Profili personali e Aggiunte personali in `clientStorage`; il profilo selezionato fa parte dello stato della UI. Nuovi comandi del bridge permettono al server di elencare i profili, leggere un profilo effettivo, salvare un fatto imparato, salvare impostazioni confermate e creare un Profilo personale. I tool MCP sui profili mantengono nome e significato ma passano dal bridge. Livelli esclusi e abbinamenti confermati si salvano subito. Spariscono il salvataggio su disco del server e l'impostazione `brands_dir` del pacchetto `.mcpb`.

## Acceptance criteria

- [ ] All'avvio il plugin espone Aurora e Borealis come Profili di base.
- [ ] Un Profilo di base non valido fa fallire la build.
- [ ] Un fatto imparato su un Profilo di base diventa un'Aggiunta personale e sopravvive al riavvio del plugin.
- [ ] `list_brand_profiles` restituisce gli stessi profili che vede il plugin; il profilo scelto dall'agente risulta selezionato nel plugin e viceversa.
- [ ] Senza plugin collegato i tool sui profili danno un errore esplicito.
- [ ] Il pacchetto `.mcpb` non ha più `brands_dir` e il server non scrive profili su disco.
- [ ] Test: harness plugin (seam 3), end-to-end MCP (seam 1), build e packaging.

## Blocked by

- 13 Schema profilo v2 e modulo puro dell'archivio

User stories: 23, 25, 26, 29, 36, 49–51
