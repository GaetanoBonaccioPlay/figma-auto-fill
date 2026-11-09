# Figma Auto Fill

Plugin per Figma Design che crea le varianti linguistiche di uno o più frame a partire da una tabella di traduzioni. Selezioni i frame, compili i testi nel plugin o in Excel e ottieni nella pagina `EXPORT` un frame modificabile per ogni lingua, con la formattazione del modello. Il frame sorgente resta intatto.

![La finestra del plugin con il foglio delle traduzioni](docs/screenshots/00-panoramica.png)

*Tutti gli screenshot mostrano l'interfaccia del plugin con dati dimostrativi di una campagna fittizia.*

**[Funzionalità](#funzionalità)** · **[Installazione per i designer](#installazione-per-i-designer-senza-nodejs)** · **[Avvio da sorgente](#avvio-da-sorgente-sviluppo)** · **[Come si usa](#come-si-usa)** · **[Modalità agente (MCP)](#modalità-agente-mcp)** · **[Formattazione e limiti](#formattazione-e-limiti)** · **[Sviluppo](#sviluppo)**

Interfaccia e logica sono scritte in TypeScript vanilla. Nell'uso manuale l'Excel viene letto dentro il plugin e i contenuti non vengono inviati in rete. La [modalità agente](#modalità-agente-mcp) è facoltativa: collega il plugin a un server MCP che gira sul tuo computer, raggiungibile solo da `localhost` (`devAllowedDomains` nel manifest).

## Funzionalità

- **Più frame insieme:** seleziona frame o section e lavora su tutti in un unico foglio.
- **Nomi di output a modello:** variabili per nome, numerazione, lingua, paese, aspect ratio e data.
- **Lingue e varianti di paese:** 11 lingue pronte con i relativi paesi, più codici ISO personalizzati.
- **Foglio di traduzione integrato:** selezione di intervalli, copia e incolla da altri fogli, modifica nella cella.
- **Import ed export `.xlsx`:** puoi tradurre nel plugin, in Excel o alternando i due.
- **Fallback controllati:** una cella vuota eredita il testo da una lingua definita e viene evidenziata.
- **Grassetto, corsivo, sottolineato e barrato:** tag `<b>`, `<i>`, `<u>`, `<s>` nelle celle, conservati anche dall'incolla HTML.
- **Organizzazione in section:** export raggruppati per lingua o per lingua base.
- **MASTER e versioni:** riapri una serie già generata, sostituiscila o crea una nuova versione `_v2`, `_v3`.
- **Preferenze salvate:** lingue, modello del nome e ordine delle colonne restano tra un avvio e l'altro.

### Selezione e nomi di output

![Modello del nome, schede dei frame e anteprima dei nomi](docs/screenshots/01-frame-e-nomi.png)

Il **Modello nome output** vale per tutti i frame selezionati e funziona come **Rename…** di Figma: i pulsanti inseriscono la variabile nel punto del cursore. Con `TBL-{Nome}-{Ratio}-{Lingua}` si ottiene per esempio `TBL-Hero-9×16-en`.

| Pulsante | Variabile | Valore |
| --- | --- | --- |
| Nome attuale | `{Nome}` | Nome base del frame, modificabile nella sua scheda |
| Numero ↑ / Numero ↓ | `{N↑}` / `{N↓}` | Numerazione crescente o decrescente nell'ordine dei frame, a partire da **Numera da** |
| Language | `{Lingua}` | Codice completo (`en_gb`); solo la lingua (`en`) se il modello usa anche `{Paese}` |
| Country | `{Paese}` | Paese (`gb`); vuoto per EN, e in quel caso il separatore che lo precede viene rimosso |
| Aspect Ratio | `{Ratio}` | Aspect ratio del frame, per esempio `9×16`, `1×1`, `1.91×1` |
| Data AAMMGG | `{Data}` | Data di oggi; un prefisso data già presente nel nome viene sostituito |

- `{Lingua}` e `{Paese}` sono sempre minuscoli. Se il modello non contiene nessuna delle due, il codice lingua viene aggiunto in fondo (`_EN`).
- Le nuove versioni aggiungono `_v2`, `_v3` al valore di `{Nome}`.
- Ogni scheda frame mostra l'anteprima dei nomi, e due export con lo stesso nome bloccano la generazione.
- I frame selezionati possono avere lo stesso nome: nell'anteprima e nella colonna `Frame` dell'Excel compaiono come `Nome (1)`, `Nome (2)` nell'ordine dei layer. Basta che il modello li distingua, per esempio con `{N↑}` o `{Ratio}`.
- Modello e numero iniziale vengono salvati per i prossimi avvii.

### Lingue e varianti

![Schede lingua con i paesi di English aperti](docs/screenshots/02-lingue.png)

Le schede sono affiancate nell'ordine English, German, French, Spanish, Dutch, Italian, Polish, Portuguese, Swedish (`SV`), Danish (`DA`), Czech (`CS`). Aprine una per vedere i paesi e il pulsante **Tutte le EN/DE/…**.

- Al primo avvio è selezionata solo EN, che è anche la lingua modello iniziale.
- Il pulsante `+` aggiunge codici personalizzati come `EN_GB`; **Ripristina lingue** torna alla selezione iniziale.
- Selezione, lingua principale e codici personalizzati sono conservati tra i riavvii.
- Sono accettati codici di lingua ISO 639-1 e, nelle varianti, codici paese ISO 3166-1. Un suffisso come `_nm` resta parte del nome del frame.

### Anteprima e modifica delle traduzioni

![Foglio di traduzione con intervallo selezionato e celle in fallback](docs/screenshots/03-anteprima.png)

**Genera locales** crea un unico foglio con intestazioni fisse (`Traduci`, `Key` e lingue) e una riga di separazione per ogni frame, nello stesso ordine dall'alto verso il basso dei layer Figma. Le celle gialle sono quelle che useranno un fallback.

- Attiva le righe una per una oppure con **Traduci tutto**. Ripremendo **Genera locales** le correzioni compatibili già inserite restano.
- Seleziona più celle trascinando o con Maiusc+clic. Con ⌘/Ctrl+C e ⌘/Ctrl+V copi e incolli intervalli da un altro foglio: tabulazioni e ritorni a capo separano colonne e righe.
- Se gli appunti contengono HTML riconoscibile, l'incolla conserva grassetto, corsivo, sottolineato e barrato.
- Doppio clic, Invio o F2 aprono la modifica della cella. Le colonne `Traduci` e `Key` non fanno parte dell'intervallo copiabile.
- Trascina l'intestazione di una colonna lingua per spostarla. Il nuovo ordine vale anche per l'Excel scaricato e viene salvato, anche per le lingue al momento non selezionate.
- La colonna `Key` è compatta: se un nome è troncato, passa il puntatore sulla cella per leggerlo per intero.

### Excel

Dopo aver generato i locals puoi scaricare il template `.xlsx`, oppure importare un file esistente. Il foglio `Translations` contiene `Frame`, `Key`, `Traduci` e una colonna per lingua. L'Excel aggiornato si scarica dall'anteprima con **Scarica Excel aggiornato**.

### Fallback

Una cella vuota in una variante usa prima la sua lingua base (`EN_GB` → `EN`) e, se anche quella è vuota, la lingua principale scelta nel plugin. Le lingue senza paese passano direttamente alla lingua principale.

La colonna della lingua base viene aggiunta automaticamente ai locals e all'Excel. Il plugin evidenzia il fallback effettivo nell'anteprima e lo segnala al termine. Se non trova alcun testo, blocca la generazione.

### Creazione degli export

![Sezione 3 con la scelta di come raggruppare gli export in section](docs/screenshots/04-export.png)

I frame creati sono modificabili e si trovano nella pagina `EXPORT`. Le colonne delle lingue sono allineate e distanziate in base al frame più largo.

Con **Organizza gli export in section** scegli tra **una section per ogni lingua o variante** (`en/`, `en_gb/`) e **varianti nella section della lingua base** (`en/` contiene EN ed EN_GB). Le section hanno nomi minuscoli con `/` finale, vengono riutilizzate nelle generazioni successive e si allargano per contenere le varianti aggiunte.

### MASTER, sostituzione e versioni

![Dialogo che propone di sostituire gli export esistenti o creare una nuova versione](docs/screenshots/05-sostituisci-o-versione.png)

Il frame della lingua principale in `EXPORT` è marcato come **MASTER**. Per rieditare una serie già generata, seleziona il frame sorgente oppure modifica e seleziona il MASTER in Figma, poi premi **Genera locales**.

- Dal sorgente l'anteprima recupera i testi dell'ultima versione esportata; dal MASTER quelli delle varianti collegate al suo gruppo. La ricerca comprende i frame dentro le section.
- Le righe con testi tradotti vengono attivate, e le correzioni non vuote già fatte nell'anteprima restano prioritarie.
- Se esistono già export creati dal plugin con gli stessi nomi, anche dentro una section, un dialogo permette di sostituirli oppure di creare una nuova versione. Il suffisso `_v2`, `_v3` è lo stesso per tutte le lingue del gruppo, e il gruppo precedente viene conservato.
- Se attivi le section su un export precedente, il MASTER viene spostato nella section appropriata.
- Quando il modello selezionato è un MASTER, i testi della lingua principale nell'anteprima sono di sola lettura.

## Installazione per i designer (senza Node.js)

Non serve installare Node.js né usare il terminale. Dalla pagina **Releases** del repository si scaricano due file; il secondo serve solo per la [modalità agente](#modalità-agente-mcp).

| File | A cosa serve |
| --- | --- |
| `figma-auto-fill-plugin-vX.Y.Z.zip` | Il plugin per Figma Desktop |
| `figma-auto-fill-vX.Y.Z.mcpb` | Il server per Claude Desktop (macOS), con tutto incorporato |

**Plugin**

1. Scompatta lo zip in una cartella che non sposterai (per esempio in Documenti): Figma la rilegge a ogni apertura.
2. In Figma Desktop: **Plugins → Development → Import plugin from manifest…** e scegli `manifest.json` della cartella.
3. Avvia **Figma Auto Fill** da **Plugins → Development**.

**Modalità agente con Claude Desktop** (facoltativa)

1. Fai doppio clic su `figma-auto-fill-vX.Y.Z.mcpb` e conferma l'installazione in Claude Desktop.
2. Scegli, se vuoi, la cartella dei Profili brand (di default `Documenti/Figma Auto Fill/Profili brand`): puoi metterla in una cartella condivisa con i colleghi.
3. Apri il plugin in Figma: nell'intestazione compare **Agente collegato**. Poi in Claude Desktop chiedi di localizzare i frame selezionati e indica l'Excel.

**Aggiornare:** scarica la nuova release, sostituisci la cartella del plugin con quella nuova e fai di nuovo doppio clic sul file `.mcpb`.

**Pubblicare una release (per chi mantiene il repo):** aggiorna `version` in `package.json`, poi crea e invia il tag corrispondente, per esempio `git tag v1.0.1 && git push origin v1.0.1`. La Action in `.github/workflows/release.yml` esegue i controlli, compila i due file e li pubblica. In locale `npm run package` li genera nella cartella `release/`.

## Avvio da sorgente (sviluppo)

1. Installa Node.js 20 o successivo e apri Figma Desktop.
2. In questa cartella esegui `npm install` e `npm run build`.
3. In un file Figma Design modificabile, apri **Plugins → Development → Import plugin from manifest…** e scegli `manifest.json` di questa cartella.
4. Avvia **Figma Auto Fill** dal menu Development.

Dopo modifiche al codice, esegui di nuovo `npm run build` e riavvia il plugin. Il plugin non importa file `.fig` direttamente: lavora sul documento aperto in Figma.

## Come si usa

Le tre sezioni numerate del plugin seguono il flusso di lavoro e si aprono e chiudono facendo clic sul titolo.

1. **Frame e lingue.** Seleziona uno o più frame o section in Figma; una section include i frame al suo interno nell'ordine dei layer, comprese le section dei MASTER in `EXPORT`. Scegli il modello del nome e le lingue, poi premi **Genera locales**.
2. **Anteprima traduzioni.** Attiva le righe e inserisci o correggi i testi, oppure lavora in Excel e reimporta il file.
3. **Crea o aggiorna EXPORT.** Se vuoi, attiva le section, poi premi **Crea / aggiorna EXPORT**.

Prima di iniziare, dai nomi univoci ai livelli di testo da tradurre, per esempio `headline` e `cta`: diventano le chiavi del foglio.

- I livelli di testo nascosti, o dentro un gruppo o frame nascosto, non compaiono tra i campi da tradurre e restano invariati negli export.
- Se più livelli visibili hanno lo stesso nome, il plugin li numera in ordine (`headline_1`, `headline_2`, …) senza rinominarli in Figma e mostra un avviso sotto l'anteprima.

## Modalità agente (MCP)

Un agente AI (per esempio Claude Code) può guidare tutto il flusso partendo da un **Excel cliente** con struttura libera: chiede il Brand, analizza l'Excel e fa confermare le lingue, abbina i testi dei frame alle righe, fa generare gli export dal plugin e scrive un **Excel aggiornato** con i testi usati in Figma. Il plugin resta l'unico a modificare Figma ([ADR 0001](docs/adr/0001-mcp-bridge-localhost-verso-plugin.md)); termini come *Profilo brand* e *Abbinamento* sono definiti in [CONTEXT.md](CONTEXT.md).

### Configurazione

Con Claude Desktop basta il file `.mcpb` descritto in [Installazione per i designer](#installazione-per-i-designer-senza-nodejs). I passi seguenti servono per lavorare da sorgente, per esempio con Claude Code.

1. Esegui `npm install` e `npm run build`.
2. Registra il server nel client MCP, per esempio con Claude Code:
   ```
   claude mcp add figma-auto-fill -- node /percorso/assoluto/figma-auto-fill/dist/server/index.mjs
   ```
3. Apri il plugin in Figma Desktop: nell'intestazione compare **Agente collegato** quando il server è raggiungibile. Se il server riparte, il plugin si ricollega da solo. Il collegamento è su `ws://localhost:3055`; con la variabile `FIGMA_AUTOFILL_PORT` puoi cambiare la porta del server, ma il plugin usa sempre la 3055.
4. Avvia il prompt MCP **`localizza-frame`** (indica Brand ed Excel se li hai già) oppure descrivi il lavoro all'agente.

Il collegamento vale solo per il plugin importato da manifest (modalità sviluppo). Per distribuire il plugin con la modalità agente serve una decisione separata sull'accesso a `localhost`.

### Il dialogo

| Passo | Cosa succede | Strumenti |
| --- | --- | --- |
| 1. Brand | L'agente chiede il Brand e carica il suo Profilo brand (modello del nome, lingue, section, glossario) | `list_brand_profiles`, `get_brand_profile`, `save_brand_profile` |
| 2. Excel cliente | Individua foglio, intestazione e colonne lingua (anche `Italiano`, `Deutsch`, `FR-fr`) e propone la Colonna sorgente; tu confermi lingue e mappatura. In caso di differenze con il profilo vale l'Excel | `analyze_client_excel` |
| 3. Selezione | Legge i frame selezionati e i livelli di testo visibili | `bridge_status`, `get_selection` |
| 4. Abbinamento | Testi identici (ignorando spazi, maiuscole, punteggiatura finale e tag) sono abbinati da soli; i **simili** (soglia 0,8), i **Livelli orfani** e le **Celle multi-livello** compaiono in un unico riepilogo | `match_selection`, `confirm_matches` |
| 5. Generazione | Il plugin crea gli export come nel flusso manuale. Se esistono già export con gli stessi nomi l'agente ti chiede se sostituire o creare `_v2`, `_v3` | `generate_exports` |
| 6. Excel aggiornato | Scrive `<nome>_updated.xlsx` | `write_updated_excel` |
| 7. Traduzione AI | Solo se la chiedi: traduce le celle vuote rispettando il glossario | `list_empty_cells`, `save_ai_translations` |

### Regole sull'Excel

- L'originale non viene mai modificato: le scritture vanno nella copia `_updated.xlsx`. Fogli, larghezze e stili del cliente restano, ma ExcelJS può non conservare elementi avanzati (grafici, tabelle pivot, immagini): controlla il file prima di rimandarlo.
- Una cella già piena **non** viene sovrascritta. Se differisce da Figma l'agente te lo segnala come conflitto, e si scrive solo con la tua conferma (`overwrite`).
- Non finisce nell'Excel il testo di *fallback*: una cella vuota resta vuota finché in Figma nessuno scrive una traduzione vera.
- Le celle modificate sono evidenziate (giallo da Figma, azzurro Traduzione AI, arancio righe aggiunte) e hanno una nota con la fonte. I Livelli orfani vengono aggiunti in coda, con colonna ID `Frame/chiave` se il foglio ha una colonna ID.
- Una **Cella multi-livello** (il testo di più livelli nella stessa cella) non viene abbinata: l'agente la segnala e la sistemi tu nel file o in Figma.

### Profili brand

Ogni Brand è un file JSON nella cartella `brand-profiles/` del progetto (cambiabile con `FIGMA_AUTOFILL_BRANDS_DIR`). Contiene modello del nome e numero iniziale, lingua principale, lingue abituali, organizzazione in section, glossario e gli **Abbinamenti confermati**, che alle sessioni successive risultano esatti. Per condividerlo con i colleghi usa `export_brand_profile` (crea un file) e `import_brand_profile` (non sovrascrive un profilo con lo stesso nome senza `overwrite`; con `rename` lo importa con un altro nome).

### Sicurezza

Il server ascolta solo su `127.0.0.1` e accetta connessioni dal plugin Figma (origine `null`), non da pagine web. Non contiene chiavi API: la Traduzione AI la esegue il modello dell'agente.

## Formattazione e limiti

- Le celle supportano `<b>`, `<i>`, `<u>` e `<s>`, anche annidati dove Figma può rappresentare la combinazione. Per scrivere un carattere `<` letterale usa `&lt;`; per `&` usa `&amp;`.
- La formattazione di base del livello viene conservata. I font e le varianti grassetto/corsivo devono essere disponibili in Figma. Differenze di famiglia, dimensione o colore *dentro lo stesso livello* non sono supportate per le righe attive.
- Il plugin non ridimensiona il testo. Un testo molto più lungo del modello genera un avviso di possibile overflow; controlla visivamente i frame risultanti.
- La pagina `EXPORT` viene riutilizzata. Se il file ha raggiunto il limite di pagine del piano Figma, la creazione iniziale di `EXPORT` non sarà possibile.
- I file PNG/JPG non vengono esportati automaticamente.

## Sviluppo

Esegui `npm run check` per controllare i tipi (plugin e server), compilare tutto e lanciare i test. `npm run server` avvia il server MCP. I test del plugin coprono codici ISO, preset e preferenze linguistiche, nomi e date, tag, fallback, intervalli e incolla TSV, lettura/scrittura `.xlsx`, colonne con frame di larghezze diverse, scelta tra sostituzione e versione, riedizione con MASTER e pulizia in caso di errore Figma; quelli del server coprono bridge, Profili brand, analisi e abbinamento dell'Excel cliente, scrittura dell'Excel aggiornato e il dialogo MCP completo con un plugin simulato.

| File | Contenuto |
| --- | --- |
| `src/plugin.ts` | Codice lato Figma: lettura della selezione, creazione degli export, section e versioni |
| `src/ui.ts`, `src/ui.html`, `src/ui.css` | Interfaccia del plugin |
| `src/core.ts` | Nomi di output, righe di traduzione, fallback e validazione |
| `src/language-catalog.ts`, `src/iso-codes.ts` | Lingue, paesi e preferenze salvate |
| `src/grid.ts` | Intervalli di celle e TSV per copia e incolla |
| `src/rich-text.ts` | Conversione dell'HTML incollato nei tag di formattazione |
| `src/workbook.ts` | Lettura e scrittura `.xlsx` |
| `src/agent-bridge.ts`, `src/agent-protocol.ts` | Collegamento della UI al server MCP e protocollo dei messaggi |
| `server/index.ts`, `server/tools.ts` | Server MCP: strumenti, prompt `localizza-frame` e sessione |
| `server/bridge.ts` | WebSocket su localhost verso il plugin |
| `server/brands.ts` | Profili brand: archivio, esportazione, importazione |
| `scripts/package.mjs`, `mcpb/manifest.json` | Zip del plugin e pacchetto `.mcpb` da consegnare ai designer |
| `server/excel-analyze.ts`, `server/match.ts`, `server/excel-update.ts` | Analisi dell'Excel cliente, abbinamento, Excel aggiornato |
