# Figma Auto Fill

Creazione delle varianti linguistiche di frame Figma a partire da una tabella di traduzioni, guidabile da un plugin o da un agente AI.

## Language

**Brand**:
Il cliente o marchio per cui si producono le varianti. È facoltativo: una sessione può lavorare senza Brand, e quando c'è il suo Profilo brand suggerisce impostazioni senza imporle.
_Avoid_: cliente, marchio, account

**Profilo brand**:
L'insieme di conoscenze ricorrenti su un Brand, usate come suggerimenti: Modello Excel, modello del nome di output, lingua principale, lingue e paesi abituali, organizzazione in section, glossario opzionale, Livelli esclusi e abbinamenti confermati. Nasce da un Excel cliente non riconosciuto, solo dopo conferma dell'utente. Si esporta e importa come file per condividerlo tra colleghi.
_Avoid_: preset, template, configurazione brand

**Profilo di base**:
Un Profilo brand curato dall'amministratore del repository e distribuito dentro il plugin; ogni designer lo trova già disponibile e può selezionarlo.
_Avoid_: profilo ufficiale, profilo di sistema, preset

**Profilo personale**:
Un Profilo brand creato da un designer per conto proprio, che resta sul suo computer finché non lo esporta o non viene promosso a Profilo di base.
_Avoid_: profilo utente, profilo locale

**Aggiunte personali**:
Ciò che un designer impara lavorando con un Profilo di base (Livelli esclusi, abbinamenti confermati, lingue, voci di glossario, impostazioni diverse), salvato a parte e sommato al Profilo di base senza modificarlo; in caso di conflitto prevale l'aggiunta. Sopravvive agli aggiornamenti del Profilo di base e si può esportare per proporla all'amministratore.
_Avoid_: override, fork, copia del profilo

**Glossario brand**:
Elenco di termini di un Brand che non vanno tradotti o hanno una traduzione obbligata.
_Avoid_: dizionario, termbase

**Excel cliente**:
File di traduzioni fornito dal cliente o dall'agenzia, con struttura libera (fogli, colonne e righe qualsiasi), distinto dal formato `Translations` del plugin.
_Avoid_: file traduzioni, sheet, template Excel

**Modello Excel**:
La struttura di un Excel cliente svuotata dei testi: fogli, intestazioni con la loro lingua, colonna ID, Colonna sorgente ed Etichette ricorrenti. Le celle delle colonne lingua e gli ID non vengono conservati. Ogni Brand ha di norma il proprio; serve a riconoscere a quale Brand somiglia un Excel cliente nuovo, come suggerimento e mai come vincolo.
_Avoid_: template, template Excel, layout

**Etichetta ricorrente**:
Il valore di una colonna non di lingua dell'Excel cliente che nomina un campo e torna uguale a ogni campagna (per esempio `Subject line`, `Preheader`, `CTA`); fa parte del Modello Excel.
_Avoid_: chiave, label, campo

**Abbinamento**:
Il collegamento tra una riga dell'Excel cliente e un livello di testo di un frame selezionato; è *esatto* quando il testo sorgente coincide, *simile* quando richiede conferma.
_Avoid_: mapping, match, associazione

**Colonna sorgente**:
La colonna dell'Excel cliente i cui testi coincidono con quelli presenti in Figma, usata per riconoscerli. Si sceglie dai dati dell'Excel; la lingua principale del Profilo brand è solo un indizio.
_Avoid_: colonna master, colonna base

**Livello orfano**:
Un livello di testo da tradurre che non ha alcuna riga abbinata nell'Excel cliente. Non entra nell'Excel aggiornato, salvo richiesta esplicita.
_Avoid_: testo mancante, unmatched

**Livello escluso**:
Un livello di contorno (per esempio `To:`, `Reply to:`, data, logo) che non va mai tradotto; l'elenco è nel Profilo brand e vale per tutte le campagne di quel Brand. Non conta come Livello orfano.
_Avoid_: livello ignorato, livello da saltare

**Cella multi-livello**:
Una cella dell'Excel cliente che contiene il testo di più livelli insieme (per esempio headline e subhead); non viene abbinata automaticamente ma segnalata al designer.
_Avoid_: cella composta, cella multipla

**Excel aggiornato**:
Copia dell'Excel cliente (`<nome>_updated.xlsx`) che contiene solo le righe usate dai frame, con i testi effettivamente usati in Figma e le celle modificate evidenziate e annotate con la loro fonte.
_Avoid_: Excel finale, export Excel

**Traduzione AI**:
Testo generato dall'agente per una cella vuota, rispettando il Glossario brand; esiste solo se richiesta esplicitamente dall'utente.
_Avoid_: traduzione automatica, auto-translate

**Abbinamento confermato**:
Un abbinamento approvato dall'utente e ricordato nel Profilo brand, così da risultare esatto nelle sessioni successive.
_Avoid_: mapping salvato, cache
