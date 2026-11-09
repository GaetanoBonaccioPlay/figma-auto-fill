---
title: "PRD: Agente MCP per la localizzazione dei frame da Excel cliente"
labels: [ready-for-agent]
branch: feat/mcp-agent
---

# PRD: Agente MCP per la localizzazione dei frame da Excel cliente

Glossario: [CONTEXT.md](../../CONTEXT.md). Decisioni: [ADR 0001](../adr/0001-mcp-bridge-localhost-verso-plugin.md).

## Problem Statement

Oggi il designer, per localizzare una campagna, deve trasformare a mano l'Excel cliente (struttura libera, fogli e colonne decisi dal cliente o dall'agenzia) nel formato `Translations` del plugin, copiare i testi riga per riga, reimpostare ogni volta modello del nome, lingue e section del Brand, e alla fine riportare nell'Excel cliente le correzioni fatte direttamente in Figma. È un lavoro ripetitivo, soggetto a errori di copia, e l'Excel cliente si disallinea rapidamente da ciò che è stato davvero consegnato.

## Solution

Un server MCP locale permette a un agente AI di condurre l'intero flusso in dialogo con il designer, usando il plugin già aperto in Figma Desktop come esecutore:

1. l'agente chiede il **Brand** e carica il suo **Profilo brand**;
2. analizza l'**Excel cliente**, propone **Colonna sorgente** e lingue trovate e chiede conferma;
3. calcola gli **Abbinamenti** con i livelli di testo dei frame selezionati e presenta un unico riepilogo di abbinamenti simili, **Livelli orfani** e **Celle multi-livello**;
4. fa generare al plugin gli export in `EXPORT`, con le regole già esistenti (MASTER, versioni, section);
5. scrive l'**Excel aggiornato** con i testi effettivamente usati in Figma, evidenziando e annotando ogni cella modificata;
6. solo su richiesta esplicita, propone una **Traduzione AI** per le celle vuote.

I Profili brand vivono in una cartella del progetto, si esportano come file e si importano per condividerli tra colleghi.

## User Stories

### Avvio e collegamento

1. Come designer, voglio avviare il server MCP dal mio client AI con un solo comando, così da non dover configurare nulla a ogni sessione.
2. Come designer, voglio che il plugin aperto in Figma si colleghi automaticamente al server, così da non dover copiare token o indirizzi.
3. Come designer, voglio vedere nel plugin se è collegato all'agente, così da sapere se i comandi arriveranno.
4. Come designer, voglio che l'agente mi avvisi chiaramente se il plugin non è aperto o non è collegato, così da sapere cosa fare invece di ricevere errori generici.
5. Come designer, voglio poter continuare a usare il plugin manualmente anche con il server collegato, così che la modalità agente non tolga funzionalità.
6. Come designer, voglio che il plugin si ricolleghi da solo se riavvio il server, così da non dover riaprire il plugin.

### Brand e Profilo brand

7. Come designer, voglio che l'agente mi chieda per prima cosa il Brand, così che tutte le impostazioni successive siano coerenti con quel Brand.
8. Come designer, voglio scegliere il Brand da un elenco dei Profili brand esistenti, così da non doverne ricordare il nome esatto.
9. Come designer, voglio creare un nuovo Profilo brand durante il dialogo quando il Brand non esiste, così da non interrompere il lavoro.
10. Come designer, voglio che il Profilo brand precompili modello del nome di output, lingua principale, lingue e paesi abituali e organizzazione in section, così da non reinserirli ogni volta.
11. Come designer, voglio modificare un Profilo brand esistente dall'agente, così da tenerlo aggiornato quando il Brand cambia convenzioni.
12. Come designer, voglio associare al Profilo brand un Glossario brand opzionale, così che i termini protetti siano rispettati in ogni Traduzione AI.
13. Come designer, voglio esportare un Profilo brand in un file, così da condividerlo con i colleghi.
14. Come collega, voglio importare un Profilo brand ricevuto, così da lavorare con le stesse convenzioni senza riconfigurarle.
15. Come collega, voglio essere avvisato se importando un profilo sovrascriverei un Profilo brand esistente con lo stesso nome, così da non perdere le mie modifiche.

### Analisi dell'Excel cliente

16. Come designer, voglio passare all'agente il percorso di un Excel cliente con qualsiasi struttura, così da non doverlo convertire nel formato del plugin.
17. Come designer, voglio che l'agente mi elenchi i fogli del file e scelga quello pertinente chiedendomi conferma quando ce n'è più di uno, così da non lavorare sul foglio sbagliato.
18. Come designer, voglio che l'agente riconosca le colonne lingua anche quando le intestazioni sono nomi (`English`, `Deutsch`) o codici non standard (`FR-fr`), così da non dover rinominare le colonne.
19. Come designer, voglio vedere come ogni intestazione è stata convertita in codice lingua e confermare o correggere la conversione, così che i nomi degli export siano corretti.
20. Come designer, voglio che l'agente proponga come Colonna sorgente quella nella lingua principale del Profilo brand, così da confermare con un solo passaggio.
21. Come designer, voglio essere avvisato delle differenze tra lingue dell'Excel cliente e lingue abituali del Profilo brand, sapendo che vince l'Excel, così da accorgermi di lingue mancanti o in più.
22. Come designer, voglio che intestazioni vuote, righe di titolo e colonne non linguistiche (note, ID, stato) vengano ignorate o mostrate come tali, così che l'analisi non inventi lingue.

### Abbinamento

23. Come designer, voglio che l'agente legga i frame attualmente selezionati in Figma e i loro livelli di testo visibili, così da lavorare esattamente su ciò che ho scelto.
24. Come designer, voglio che i testi identici (a meno di spazi, maiuscole, punteggiatura finale e tag di formattazione) vengano abbinati senza domande, così da confermare solo i casi dubbi.
25. Come designer, voglio vedere gli abbinamenti simili con un punteggio e il confronto tra testo Figma e testo Excel, così da confermarli o rifiutarli con cognizione.
26. Come designer, voglio un unico riepilogo con simili, Livelli orfani e Celle multi-livello invece di una domanda per riga, così che il dialogo resti breve.
27. Come designer, voglio che una Cella multi-livello venga segnalata con un avviso e non abbinata, così da sistemarla io nel file o nei livelli.
28. Come designer, voglio che i Livelli orfani usino il testo della lingua principale come fallback e siano elencati, così da sapere cosa resterà non tradotto.
29. Come designer, voglio che gli abbinamenti confermati vengano ricordati nel Profilo brand, così che la volta successiva risultino esatti.
30. Come designer, voglio che un abbinamento confermato in passato venga ignorato se la riga corrispondente non esiste più nell'Excel cliente, così da non usare dati obsoleti.

### Generazione in Figma

31. Come designer, voglio che l'agente faccia generare dal plugin gli export di tutte le lingue confermate per i frame selezionati, così da ottenere lo stesso risultato del flusso manuale.
32. Come designer, voglio che l'agente mi chieda se sostituire o creare una nuova versione quando esistono già export con gli stessi nomi, così che la scelta resti mia come nel plugin.
33. Come designer, voglio ricevere al termine un resoconto con frame creati, fallback usati e possibili overflow di testo, così da sapere cosa controllare a vista.
34. Come designer, voglio che un errore di generazione non lasci export a metà, così da non dover pulire la pagina `EXPORT` a mano.
35. Come designer, voglio che l'agente blocchi la generazione se due export avrebbero lo stesso nome e me ne spieghi il motivo, così da correggere il modello del nome.

### Excel aggiornato

36. Come designer, voglio che l'agente scriva i testi effettivamente usati in Figma in una copia `<nome>_updated.xlsx`, così che il file originale del cliente resti intatto.
37. Come designer, voglio che fogli, colonne e formattazione del cliente vengano conservati nell'Excel aggiornato, così da poterlo rimandare al cliente così com'è.
38. Come designer, voglio che le correzioni fatte a mano nei frame di `EXPORT` vengano riportate nelle celle abbinate, così che l'Excel rifletta ciò che è stato consegnato.
39. Come designer, voglio che i Livelli orfani vengano aggiunti in fondo al foglio come nuove righe, così che il cliente possa tradurli.
40. Come designer, voglio che nessuna cella già piena venga sovrascritta senza la mia conferma, e che i conflitti tra Excel e Figma mi vengano mostrati, così da decidere io quale testo vale.
41. Come cliente, voglio che ogni cella modificata sia evidenziata e annotata con la sua fonte (frame Figma o Traduzione AI), così da vedere subito cosa è cambiato.

### Traduzione AI

42. Come designer, voglio che l'agente mi chieda esplicitamente se tradurre le celle vuote, indicando quante sono, così che nulla venga tradotto senza la mia decisione.
43. Come designer, voglio che le Traduzioni AI rispettino il Glossario brand, così che nomi di prodotto e claim non vengano alterati.
44. Come designer, voglio rivedere le Traduzioni AI prima che vengano usate nei frame o scritte nell'Excel, così da poterle correggere.
45. Come cliente, voglio che le Traduzioni AI siano distinguibili dai testi forniti o approvati, così da poterle revisionare.

## Implementation Decisions

- **Architettura** (ADR 0001): un server MCP Node locale con trasporto stdio, che apre un WebSocket su `localhost`. La UI del plugin si collega come client. Il server non scrive mai direttamente in Figma: ogni operazione sul documento è un comando eseguito dal plugin.
- **Moduli nuovi lato server**, nella stessa repo, in una cartella dedicata con build esbuild come il resto del progetto:
  - **Bridge**: gestisce la connessione del plugin e il protocollo richiesta/risposta (ogni messaggio ha un `id` di correlazione, un `kind` e un payload; le risposte riportano `ok` o `error`). Espone timeout e lo stato "plugin collegato/non collegato".
  - **Analisi Excel cliente**: modulo puro che, dato il contenuto di un file, restituisce i fogli, la riga di intestazione individuata, le colonne lingua candidate con il codice normalizzato e un livello di confidenza, le colonne ignorate e la Colonna sorgente proposta. Riusa la normalizzazione dei codici lingua e il catalogo lingue esistenti; aggiunge una tabella nomi-lingua → codice ISO (almeno nelle lingue del catalogo, in italiano, inglese e nella lingua stessa).
  - **Abbinamento**: modulo puro che, dati i livelli di testo dei frame selezionati, le righe dell'Excel cliente, la Colonna sorgente e gli Abbinamenti confermati del Profilo brand, restituisce abbinamenti esatti, simili con punteggio, Livelli orfani e Celle multi-livello. La normalizzazione ignora spazi multipli, maiuscole, punteggiatura finale e tag `<b> <i> <u> <s>`. Una cella che contiene il testo di più livelli (per esempio separati da un a capo) viene classificata come Cella multi-livello e mai abbinata.
  - **Scrittura Excel aggiornato**: modulo che produce la copia `_updated.xlsx` conservando fogli, colonne e stili, applicando un riempimento e un commento con la fonte a ogni cella scritta, aggiungendo i Livelli orfani in coda e rifiutando di sovrascrivere celle piene salvo conferma esplicita per cella. Richiede una libreria xlsx che conservi gli stili e scriva commenti; la versione community di SheetJS usata dal plugin non scrive gli stili, quindi lato server serve una libreria diversa (per esempio ExcelJS), mentre il plugin resta invariato.
  - **Profili brand**: archivio su disco in una cartella del progetto, un file JSON per Brand, con validazione dello schema. Supporta elenco, lettura, creazione, modifica, esportazione in un file singolo e importazione con controllo dei conflitti di nome. Il formato di esportazione ha un campo `version` per gestire evoluzioni future.
- **Forma del Profilo brand** (proposta):
  - `name`, `version`
  - `naming`: modello del nome di output e numero iniziale
  - `primaryLanguage`, `languages` (lingue e varianti abituali)
  - `sections`: nessuna / per lingua / varianti nella lingua base
  - `glossary`: elenco di termini con traduzione obbligata per lingua oppure marcati come non traducibili
  - `confirmedMatches`: testo sorgente normalizzato → identificativo della riga dell'Excel cliente (colonna ID se presente, altrimenti il testo sorgente)
- **Tool MCP** esposti all'agente (nomi indicativi):
  - `bridge_status`
  - `list_brand_profiles`, `get_brand_profile`, `save_brand_profile`, `export_brand_profile`, `import_brand_profile`
  - `get_selection`: frame selezionati e livelli di testo, letti dal plugin con le regole attuali (livelli nascosti esclusi, chiavi univoche)
  - `analyze_client_excel(path, sheet?)`
  - `match_selection(path, sheet, sourceColumn, languageColumns, brand)`
  - `confirm_matches(brand, decisions)`: salva gli Abbinamenti confermati
  - `generate_exports(brand, languages, matches, onConflict?)`: costruisce le righe di traduzione e le invia al plugin; se esistono export con lo stesso nome restituisce il conflitto senza generare, e l'agente richiama con `onConflict = replace | version`
  - `list_empty_cells` e `write_updated_excel(path, sheet, writes, overwrite?)`: le scritture portano la fonte (`figma:<frame>` o `ai`)
- **Prompt MCP** `localizza-frame`: codifica l'ordine del dialogo (Brand → Excel cliente → conferma lingue e Colonna sorgente → riepilogo abbinamenti → generazione → Excel aggiornato → Traduzione AI facoltativa), così che qualsiasi client MCP segua lo stesso flusso.
- **Traduzione AI**: la esegue il modello dell'agente, non il server. Il server fornisce le celle vuote e il Glossario brand, e accetta le scritture marcate con fonte `ai`. Non ci sono chiavi API nel server.
- **Plugin**: aggiunge una modalità agente nella UI che si collega al WebSocket locale e inoltra i comandi al codice Figma, riusando i flussi esistenti di lettura della selezione, recupero dei testi esportati dal MASTER, piano di generazione con conflitti sostituisci/versione e generazione. Il manifest deve consentire `localhost` (in `devAllowedDomains` per l'uso in sviluppo; la pubblicazione richiede una verifica separata). Il flusso manuale resta invariato.
- **Fonte di verità delle lingue**: in caso di differenze tra Excel cliente e Profilo brand vince l'Excel; il server restituisce le differenze e l'agente le segnala.
- **Documentazione**: README da aggiornare (sezione modalità agente e rimozione della frase "non c'è un server") nello stesso lavoro.

## Testing Decisions

- I buoni test verificano solo il comportamento esterno: input → output dei moduli e messaggi scambiati sul bridge, mai dettagli interni come funzioni private o struttura delle classi.
- **Seam 1, end-to-end sui tool MCP**: un client MCP di test chiama i tool del server mentre un client WebSocket finto si comporta come il plugin, rispondendo ai comandi con dati fissi. Copre il flusso completo del prompt `localizza-frame`, il plugin non collegato, i timeout e il conflitto sostituisci/versione.
- **Seam 2, moduli puri lato server**: analisi dell'Excel cliente (intestazioni a nome o codice, più fogli, righe di titolo, colonne non linguistiche), abbinamento (esatti, simili con soglia, orfani, Celle multi-livello, Abbinamenti confermati obsoleti), scrittura dell'Excel aggiornato (copia, stili conservati, evidenziazione e commenti, nessuna sovrascrittura senza conferma, orfani in coda) e Profili brand (validazione, esportazione e importazione, conflitto di nome). Le fixture sono file `.xlsx` generati nei test.
- **Seam 3, plugin**: si estende l'harness `vm` esistente del plugin per i nuovi messaggi della modalità agente, verificando che i comandi del bridge producano gli stessi risultati del flusso manuale.
- **Prior art**: test `node:test` sui moduli compilati in `dist` (core, workbook, grid, language-catalog) e l'harness del plugin con Figma simulato.
- Tutto deve passare con `npm run check`.

## Out of Scope

- Abbinamento automatico delle Celle multi-livello: per ora producono solo un avviso e le sistema il designer.
- Traduzione AI automatica o eseguita dal server con chiavi proprie.
- Lavorare senza il plugin aperto (Figma MCP ufficiale o REST API, vedi ADR 0001).
- Pubblicazione del plugin sulla Community di Figma con accesso alla rete.
- Esportazione PNG/JPG dei frame.
- Sincronizzazione dei Profili brand via cloud: si condividono come file.
- Formati diversi da `.xlsx` (CSV, Google Sheets).
- Ridimensionamento automatico del testo in caso di overflow.

## Further Notes

- Il plugin oggi dichiara `networkAccess: none`: l'apertura a `localhost` va comunicata agli utenti nel README.
- La soglia di similarità e la normalizzazione vanno tarate su Excel cliente reali; servono 2-3 file di esempio anonimizzati come fixture.
- Il riconoscimento della Cella multi-livello è euristico (a capo che separa testi coincidenti con più livelli dello stesso frame): falsi negativi finiscono come simili o orfani e restano comunque visibili nel riepilogo.
