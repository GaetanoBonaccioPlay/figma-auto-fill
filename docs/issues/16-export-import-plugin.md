---
title: "Export e import dei profili dal plugin e via agente"
labels: [ready-for-agent, AFK]
blocked_by: [14, 15]
---

## Parent

PRD: Profili brand come aiuto, non come vincolo

## What to build

Dal plugin, anche senza Claude, il designer esporta un profilo in un file scaricato e importa un file scelto dal disco. Il file contiene il profilo completo (base più aggiunte) e l'origine (nome e versione del Profilo di base da cui deriva); il formato è quello dei Profili di base. All'import: se il nome corrisponde a un Profilo di base, le novità diventano Aggiunte personali, e se ce ne sono già il plugin chiede unisci o sostituisci; se corrisponde a un Profilo personale chiede sostituisci o importa con un altro nome. Si accettano anche i file versione 1 della vecchia cartella dei profili. `export_brand_profile` e `import_brand_profile` passano dal plugin: il server legge o scrive il file al percorso indicato.

## Acceptance criteria

- [ ] Un profilo esportato e reimportato da un collega senza quel Profilo di base produce lo stesso profilo effettivo.
- [ ] Importare un Columbia esportato da chi ha Aggiunte personali crea solo quelle novità come aggiunte di chi importa.
- [ ] Le domande unisci/sostituisci e sostituisci/rinomina compaiono nei casi previsti.
- [ ] Un file non valido o di versione non supportata dà un messaggio chiaro.
- [ ] Un file esportato copiato nella cartella dei Profili di base passa la build senza modifiche.
- [ ] Test UI (seam 4), modulo archivio (seam 2), end-to-end MCP (seam 1).

## Blocked by

- 14 Archivio dei profili nel plugin
- 15 Sezione Profili nella UI del plugin

User stories: 27, 40–48, 52
