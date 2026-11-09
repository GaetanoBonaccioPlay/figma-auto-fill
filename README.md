# Figma Auto Fill

Plugin per Figma Design che crea le varianti linguistiche di uno o più frame a partire da una tabella di traduzioni. Selezioni i frame, compili i testi nel plugin o in Excel e ottieni nella pagina `EXPORT` un frame modificabile per ogni lingua, con la formattazione del modello. Il frame sorgente resta intatto.

![La finestra del plugin con il foglio delle traduzioni](docs/screenshots/00-panoramica.png)

*Tutti gli screenshot mostrano l'interfaccia del plugin con dati dimostrativi di una campagna fittizia.*

**[Funzionalità](#funzionalità)** · **[Avvio](#avvio)** · **[Come si usa](#come-si-usa)** · **[Formattazione e limiti](#formattazione-e-limiti)** · **[Sviluppo](#sviluppo)**

Interfaccia e logica sono scritte in TypeScript vanilla. L'Excel viene letto dentro il plugin: non c'è un server e i contenuti non vengono inviati in rete (`networkAccess` è impostato su `none` nel manifest).

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

## Avvio

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

## Formattazione e limiti

- Le celle supportano `<b>`, `<i>`, `<u>` e `<s>`, anche annidati dove Figma può rappresentare la combinazione. Per scrivere un carattere `<` letterale usa `&lt;`; per `&` usa `&amp;`.
- La formattazione di base del livello viene conservata. I font e le varianti grassetto/corsivo devono essere disponibili in Figma. Differenze di famiglia, dimensione o colore *dentro lo stesso livello* non sono supportate per le righe attive.
- Il plugin non ridimensiona il testo. Un testo molto più lungo del modello genera un avviso di possibile overflow; controlla visivamente i frame risultanti.
- La pagina `EXPORT` viene riutilizzata. Se il file ha raggiunto il limite di pagine del piano Figma, la creazione iniziale di `EXPORT` non sarà possibile.
- I file PNG/JPG non vengono esportati automaticamente.

## Sviluppo

Esegui `npm run check` per controllare i tipi, compilare il plugin e lanciare i test. I test coprono codici ISO, preset e preferenze linguistiche, nomi e date, tag, fallback, intervalli e incolla TSV, lettura/scrittura `.xlsx`, colonne con frame di larghezze diverse, scelta tra sostituzione e versione, riedizione con MASTER e pulizia in caso di errore Figma.

| File | Contenuto |
| --- | --- |
| `src/plugin.ts` | Codice lato Figma: lettura della selezione, creazione degli export, section e versioni |
| `src/ui.ts`, `src/ui.html`, `src/ui.css` | Interfaccia del plugin |
| `src/core.ts` | Nomi di output, righe di traduzione, fallback e validazione |
| `src/language-catalog.ts`, `src/iso-codes.ts` | Lingue, paesi e preferenze salvate |
| `src/grid.ts` | Intervalli di celle e TSV per copia e incolla |
| `src/rich-text.ts` | Conversione dell'HTML incollato nei tag di formattazione |
| `src/workbook.ts` | Lettura e scrittura `.xlsx` |
