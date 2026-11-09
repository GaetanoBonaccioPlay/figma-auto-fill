# Figma Auto Fill

Creazione delle varianti linguistiche di frame Figma a partire da una tabella di traduzioni, guidabile da un plugin o da un agente AI.

## Language

**Brand**:
Il cliente o marchio per cui si producono le varianti; determina il Profilo brand da applicare.
_Avoid_: cliente, marchio, account

**Profilo brand**:
L'insieme di impostazioni ricorrenti di un Brand: modello del nome di output, lingua principale, lingue e paesi abituali, organizzazione in section, glossario opzionale e abbinamenti confermati. Si esporta e importa come file per condividerlo tra colleghi.
_Avoid_: preset, template, configurazione brand

**Glossario brand**:
Elenco di termini di un Brand che non vanno tradotti o hanno una traduzione obbligata.
_Avoid_: dizionario, termbase

**Excel cliente**:
File di traduzioni fornito dal cliente o dall'agenzia, con struttura libera (fogli, colonne e righe qualsiasi), distinto dal formato `Translations` del plugin.
_Avoid_: file traduzioni, sheet, template Excel

**Abbinamento**:
Il collegamento tra una riga dell'Excel cliente e un livello di testo di un frame selezionato; è *esatto* quando il testo sorgente coincide, *simile* quando richiede conferma.
_Avoid_: mapping, match, associazione

**Colonna sorgente**:
La colonna dell'Excel cliente scritta nella lingua principale del Profilo brand, usata per riconoscere i testi presenti in Figma.
_Avoid_: colonna master, colonna base

**Livello orfano**:
Un livello di testo da tradurre che non ha alcuna riga abbinata nell'Excel cliente.
_Avoid_: testo mancante, unmatched

**Cella multi-livello**:
Una cella dell'Excel cliente che contiene il testo di più livelli insieme (per esempio headline e subhead); non viene abbinata automaticamente ma segnalata al designer.
_Avoid_: cella composta, cella multipla

**Excel aggiornato**:
Copia dell'Excel cliente (`<nome>_updated.xlsx`) in cui vengono riportati i testi effettivamente usati in Figma, con le celle modificate evidenziate e annotate con la loro fonte.
_Avoid_: Excel finale, export Excel

**Traduzione AI**:
Testo generato dall'agente per una cella vuota, rispettando il Glossario brand; esiste solo se richiesta esplicitamente dall'utente.
_Avoid_: traduzione automatica, auto-translate

**Abbinamento confermato**:
Un abbinamento approvato dall'utente e ricordato nel Profilo brand, così da risultare esatto nelle sessioni successive.
_Avoid_: mapping salvato, cache
