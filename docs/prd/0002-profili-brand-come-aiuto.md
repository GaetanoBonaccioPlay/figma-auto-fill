---
title: "PRD: Profili brand come aiuto, non come vincolo"
labels: [ready-for-agent]
branch: feat/profili-brand-aiuto
---

# PRD: Profili brand come aiuto, non come vincolo

Glossario: [CONTEXT.md](../../CONTEXT.md). Decisioni: [ADR 0001](../adr/0001-mcp-bridge-localhost-verso-plugin.md), [ADR 0002](../adr/0002-archivio-profili-nel-plugin.md).

## Problem Statement

Oggi il Brand è un muro. L'agente non analizza un Excel cliente, non abbina e non genera nulla finché il designer non ha scelto un Profilo brand. La lingua principale del profilo decide quale sia la Colonna sorgente, anche quando l'Excel dice altro. Il cliente però non è sempre preciso: rinomina i fogli, aggiunge lingue, cambia la colonna dei testi. Inoltre il plugin verrà usato anche per clienti senza un profilo, per cui fermarsi a "scegli prima il Brand" non ha senso.

I profili inoltre vivono in una cartella che legge solo il server MCP. Nell'uso manuale il designer non li vede, non può sceglierli, crearli, esportarli o importarli dal plugin. I profili curati dall'amministratore del repository non arrivano ai colleghi insieme al plugin.

## Solution

Il Profilo brand diventa una fonte di suggerimenti:

1. una sessione funziona **senza Brand**: la Colonna sorgente si sceglie dai dati e le impostazioni arrivano dalla UI del plugin;
2. ogni Profilo brand conserva il **Modello Excel** del suo Brand (fogli, intestazioni con la lingua, colonna ID, Colonna sorgente, **Etichette ricorrenti**, nessun testo del cliente). Un Excel nuovo viene confrontato con i modelli noti e l'agente propone il Brand a cui somiglia, chiedendo conferma;
3. se l'Excel non somiglia a nulla, si lavora senza Brand. Alla fine l'agente chiede se salvarlo come nuovo **Profilo personale**;
4. quando l'Excel differisce dal profilo vince l'Excel. Le differenze compaiono in una riga e a fine sessione l'agente chiede se aggiornare il profilo;
5. il plugin custodisce l'archivio. Contiene i **Profili di base** curati dall'amministratore e compilati a ogni release, i Profili personali e le **Aggiunte personali** fatte dal designer sopra un Profilo di base;
6. dal plugin, anche senza Claude, il designer sceglie un profilo, ne crea uno con il solo nome, lo esporta in un file e importa i file dei colleghi.

## User Stories

### Lavorare senza Brand

1. Come designer, voglio analizzare un Excel cliente senza aver scelto un Brand, così da non essere bloccato con clienti nuovi o progetti singoli.
2. Come designer, voglio che la Colonna sorgente venga scelta in base ai testi che coincidono con i livelli Figma, così da non dipendere da una lingua principale impostata altrove.
3. Come designer, voglio che senza Brand l'agente usi modello del nome, nomi base e section compilati nel plugin, così da ottenere gli stessi export che otterrei a mano.
4. Come designer, voglio poter abbinare, generare e scrivere l'Excel aggiornato senza Brand, così che nessun passo del flusso richieda un profilo.
5. Come designer, voglio che senza Brand le esclusioni e gli abbinamenti confermati valgano almeno per la sessione in corso, così da non ripetere le stesse decisioni a ogni abbinamento.
6. Come designer, voglio poter chiedere una Traduzione AI anche senza Brand, sapendo che manca il Glossario brand, così da non perdere la funzione.
7. Come designer, voglio che a fine sessione senza Brand l'agente mi chieda se salvare quell'Excel come reference, così da ritrovarlo riconosciuto la volta dopo.
8. Come designer, voglio dare io il nome al nuovo profilo (con un suggerimento preso dal file), così da ritrovarlo con un nome sensato.
9. Come designer, voglio poter rispondere di no al salvataggio, così da non riempire l'archivio di progetti usati una volta sola.

### Riconoscere il Brand da un Excel

10. Come designer, voglio che l'agente confronti un Excel nuovo con i Modelli Excel di tutti i profili, di base e personali, così da sapere se assomiglia a un Brand noto.
11. Come designer, voglio che con un solo candidato chiaro l'agente mi proponga quel Brand e mi chieda conferma, così da non sceglierlo a mano ogni volta.
12. Come designer, voglio che con due candidati vicini l'agente me li elenchi e mi faccia scegliere, così da non affidarmi a un'ipotesi incerta.
13. Come designer, voglio che senza candidati l'agente mi dica che l'Excel è nuovo e prosegua senza Brand, così da non fermarmi.
14. Come designer, voglio poter rifiutare il Brand proposto, così da correggere un riconoscimento sbagliato.
15. Come designer, voglio che il riconoscimento si basi anche sulle Etichette ricorrenti (Subject line, Preheader, CTA), così che funzioni anche quando le intestazioni sono generiche come `EN` o `FR`.
16. Come designer, voglio che se nel plugin ho selezionato un profilo e l'Excel somiglia a un altro Brand l'agente me lo faccia notare e mi chieda quale usare, così da accorgermi di un file sbagliato.
17. Come designer, voglio vedere perché l'agente pensa che un Excel somigli a un Brand (foglio, intestazioni, etichette in comune), così da fidarmi della proposta.

### L'Excel vince sul profilo

18. Come designer, voglio che quando l'Excel differisce dal profilo valga ciò che c'è nell'Excel, così da lavorare sul file reale e non su un'abitudine passata.
19. Come designer, voglio vedere le differenze rispetto al profilo in una sola riga informativa (foglio rinominato, lingua nuova, sorgente diversa), così da esserne consapevole senza dover rispondere a domande.
20. Come designer, voglio che la scelta della Colonna sorgente diversa dalla lingua principale del profilo mi venga segnalata, così da poterla correggere se l'agente ha sbagliato.
21. Come designer, voglio che a fine sessione l'agente mi chieda se aggiornare il profilo con le novità dell'Excel, così che il Modello Excel resti attuale.
22. Come designer, voglio che senza il mio sì il profilo non cambi, così che una campagna anomala non sporchi il Brand.

### Profili di base

23. Come amministratore del repository, voglio inserire profili curati in una cartella del repository e vederli compilati nel plugin a ogni release, così che ogni collega li trovi già pronti.
24. Come designer, voglio vedere nel plugin l'elenco dei Profili di base e selezionarne uno, così da partire dalle impostazioni del Brand.
25. Come designer, voglio che i Profili di base non siano modificabili direttamente, così da non alterare per errore la versione curata.
26. Come designer, voglio ricevere le nuove versioni di un Profilo di base aggiornando il plugin, così da avere sempre le informazioni curate più recenti.
27. Come amministratore, voglio che il file di un profilo esportato dal plugin abbia lo stesso formato dei Profili di base, così da promuoverlo copiandolo nella cartella del repository.
28. Come amministratore, voglio poter dichiarare in un Profilo di base il nome che aveva prima, così che una rinomina non faccia perdere le Aggiunte personali dei colleghi.
29. Come amministratore, voglio che un Profilo di base non valido faccia fallire la build, così da non distribuire un plugin con un profilo rotto.

### Profili personali e Aggiunte personali

30. Come designer, voglio creare dal plugin un Profilo personale indicando solo il nome, così da iniziare subito e completarlo usandolo.
31. Come designer, voglio che ciò che imparo lavorando con un Profilo di base (Livelli esclusi, abbinamenti confermati, lingue, voci di glossario, impostazioni) venga salvato come Aggiunte personali, così da non ripeterlo alla campagna successiva.
32. Come designer, voglio vedere un Profilo di base già sommato alle mie Aggiunte personali, così da lavorare con un solo profilo coerente.
33. Come designer, voglio che in caso di conflitto valga la mia Aggiunta personale, così che le mie scelte non vengano ignorate.
34. Come designer, voglio che le mie Aggiunte personali sopravvivano a un aggiornamento del Profilo di base, così da ricevere le novità dell'amministratore senza perdere le mie.
35. Come designer, voglio poter vedere e cancellare le mie Aggiunte personali su un Profilo di base, così da tornare alla versione curata.
36. Come designer, voglio che Livelli esclusi e abbinamenti confermati si salvino subito, così da non perderli se chiudo il plugin.
37. Come designer, voglio che nome di output, lingue e section diversi dal profilo non si salvino da soli ma mi venga chiesto alla fine della generazione, così che una richiesta una tantum del cliente non cambi il profilo.
38. Come designer, voglio che se un Profilo di base sparisce le mie Aggiunte personali diventino un Profilo personale completo e che il plugin me lo dica, così da non perdere nulla.
39. Come designer, voglio cancellare o rinominare i miei Profili personali, così da tenere ordinato l'archivio.

### Export e import dal plugin

40. Come designer, voglio esportare un profilo dal plugin in un file scaricato, così da mandarlo a un collega o all'amministratore.
41. Come designer, voglio che il file esportato contenga il profilo completo (base più le mie aggiunte) e dica da quale Profilo di base e versione deriva, così che funzioni anche per chi non ha quel profilo.
42. Come designer, voglio importare un file profilo scegliendolo dal plugin, così da usare il lavoro di un collega.
43. Come designer, voglio che importando un profilo con lo stesso nome di un Profilo di base le novità diventino mie Aggiunte personali, così che il Profilo di base resti intatto.
44. Come designer, voglio che se ho già Aggiunte personali su quel profilo il plugin mi chieda se unirle o sostituirle, così da decidere io.
45. Come designer, voglio che importando un profilo con lo stesso nome di un mio Profilo personale il plugin mi chieda se sostituirlo o importarlo con un altro nome, così da non perdere il mio.
46. Come designer, voglio un messaggio chiaro se il file non è un profilo valido o ha una versione non supportata, così da sapere cosa chiedere al collega.
47. Come designer, voglio che export e import funzionino anche senza Claude, così da condividere profili usando il plugin a mano.
48. Come designer, voglio che l'agente possa esportare e importare profili passando dal plugin, così che i comandi già noti continuino a funzionare.

### Agente e archivio

49. Come designer, voglio che l'agente veda esattamente gli stessi profili che vedo nel plugin, così che "ho salvato ma non lo vedo" non succeda.
50. Come designer, voglio che se il plugin non è collegato l'agente mi dica che non può leggere i profili, così da sapere che devo aprire il plugin.
51. Come designer, voglio che il profilo scelto dall'agente risulti selezionato anche nel plugin e viceversa, così da non avere due Brand diversi in gioco.
52. Come designer, voglio importare una volta nel plugin i profili che avevo nella vecchia cartella dei Profili brand, così da non perderli con il passaggio all'archivio nel plugin.

## Implementation Decisions

- **Brand facoltativo nel server.** La sessione MCP non richiede più un Brand. Ogni tool che oggi lo esige lavora con un profilo *effettivo* che può essere assente. Senza profilo, Livelli esclusi e abbinamenti confermati stanno nella memoria della sessione e diventano parte del Profilo personale se il designer accetta di salvarlo. Il prompt `localizza-frame` cambia il primo passo: si parte dall'Excel cliente, il Brand si propone dopo l'analisi.
- **Colonna sorgente dai dati.** La proposta si basa su quanti testi di ogni colonna lingua coincidono con i livelli di testo dei frame selezionati. La lingua principale del profilo pesa solo a parità. L'analisi dell'Excel quindi propone una Colonna sorgente provvisoria, che si consolida quando è disponibile la selezione. Le differenze con il profilo restano nel report come informazione e non come errore.
- **Modello Excel nello schema del profilo.** Lo schema passa alla versione 2 e aggiunge un elenco di Modelli Excel per profilo. Di norma è uno solo, ma l'elenco permette di aggiungere un secondo formato. Ogni modello contiene: nome del foglio, riga di intestazione, intestazioni con codice lingua, posizione della colonna ID, Colonna sorgente, Etichette ricorrenti (valori delle colonne non di lingua e non ID). La lingua principale diventa facoltativa. Il solo campo obbligatorio è il nome. I profili versione 1 si leggono e si migrano senza perdite.
- **Riconoscimento.** Un modulo puro estrae il Modello Excel da un foglio analizzato e calcola un punteggio di somiglianza con ciascun modello noto, combinando foglio, intestazioni e Etichette ricorrenti. Le Etichette ricorrenti pesano di più delle intestazioni generiche. Il risultato ha tre esiti: un candidato chiaro, più candidati vicini, nessun candidato. Ogni candidato riporta gli elementi in comune che giustificano il punteggio. Le soglie si tarano sugli Excel reali, come in issue 11.
- **Discrepanza tra plugin e riconoscimento.** Se nel plugin è selezionato un profilo e il riconoscimento indica un altro Brand, il server non sceglie: restituisce entrambi e l'agente chiede al designer.
- **Archivio nel plugin (ADR 0002).** Il codice del plugin custodisce i profili:
  - i Profili di base arrivano compilati nel bundle a ogni build, dalla cartella dei Profili di base del repository, e la build fallisce se uno non è valido;
  - Profili personali e Aggiunte personali stanno nello `clientStorage` di Figma;
  - il profilo selezionato fa parte dello stato della UI.
- **Modulo puro dell'archivio, condiviso tra plugin e server.** Contiene lo schema e le operazioni:
  - elenco dei profili con la loro origine (base o personale);
  - profilo effettivo (base sommato alle aggiunte, con le aggiunte che prevalgono);
  - registrazione di un fatto imparato;
  - calcolo delle differenze tra un profilo importato e un Profilo di base;
  - unione o sostituzione delle aggiunte;
  - conversione delle aggiunte orfane in Profilo personale;
  - risoluzione del nome precedente dichiarato da un Profilo di base.
  Oggi lo schema è definito con zod nel server. Nel bundle del plugin va valutato se includere zod o tenere una validazione a mano equivalente. La scelta è dell'implementatore, purché i messaggi d'errore indichino il campo errato.
- **Due tipi di informazione e quando si salvano.** I *fatti imparati* (Livelli esclusi, abbinamenti confermati) si salvano subito. Le *impostazioni* (modello del nome, lingue, section, Modello Excel aggiornato) si salvano solo dopo conferma del designer, chiesta a fine generazione o a fine sessione quando differiscono dal profilo effettivo.
- **Nuovi comandi del bridge.** Si aggiungono comandi per elencare i profili, leggere un profilo effettivo, salvare un fatto imparato, salvare impostazioni confermate, creare un Profilo personale, esportare e importare. I tool MCP esistenti sui profili mantengono nome e significato e passano dal bridge invece che dal disco. Export e import via agente accettano un percorso: il server legge o scrive il file, mentre conflitti e unione si risolvono con la logica del modulo archivio.
- **Formato di export.** Il wrapper dichiara formato e versione e contiene il profilo completo, più l'origine facoltativa (nome e versione del Profilo di base da cui deriva). Il formato è identico a quello dei file dei Profili di base, più l'origine, che i Profili di base ignorano.
- **UI del plugin.** Si aggiunge una sezione Profili con:
  - selezione del profilo, con i Profili di base distinti da quelli personali;
  - creazione con il solo nome;
  - esportazione, come file scaricato;
  - importazione, con scelta file e domande su unire/sostituire o sostituire/rinominare;
  - vista e cancellazione delle proprie Aggiunte personali;
  - cancellazione e rinomina dei Profili personali;
  - avviso di Profilo di base non più disponibile.
  Selezionare un profilo precompila nome di output, lingue e section senza bloccarne la modifica.
- **Rimozione di `brands_dir`.** L'impostazione del pacchetto `.mcpb` e il salvataggio su disco del server spariscono. I file della vecchia cartella si importano dal plugin come qualsiasi export, accettando anche il formato versione 1.

## Testing Decisions

- **Che cosa rende buono un test.** Verifica il comportamento osservabile dall'esterno (risposte dei tool, messaggi della UI, contenuto dell'archivio e dei file), non le strutture interne. Le fixture Excel si generano nei test, come oggi.
- **Seam 1, end-to-end sui tool MCP.** Client MCP di test e finto plugin WebSocket. Il finto plugin ora serve anche l'archivio dei profili. Copre:
  - flusso completo senza Brand fino all'Excel aggiornato;
  - proposta di salvataggio a fine sessione;
  - riconoscimento con un candidato, due candidati e nessuno;
  - discrepanza tra profilo selezionato nel plugin e Brand riconosciuto;
  - differenze Excel/profilo come informazione;
  - Colonna sorgente scelta dai dati in contrasto con la lingua del profilo;
  - plugin non collegato quando servono i profili.
- **Seam 2, moduli puri.**
  - Archivio: profilo effettivo e precedenza delle aggiunte, differenze all'import, unisci/sostituisci, aggiunte orfane, nome precedente, migrazione da versione 1, validazione con il campo errato.
  - Modello Excel: estrazione senza testi del cliente né ID, punteggio di somiglianza, peso delle Etichette ricorrenti, esiti a tre vie.
- **Seam 3, harness `vm` del plugin.** Si estende l'harness esistente, che simula già `clientStorage`. Copre: Profili di base disponibili all'avvio; persistenza di Profili personali e Aggiunte personali tra un riavvio e l'altro; comandi del bridge sui profili; Profilo di base rimosso convertito in personale al primo avvio.
- **Seam 4, UI del plugin.** Sul modello del test del bridge della UI. Copre: selezione del profilo che precompila le impostazioni senza bloccarle; creazione con il solo nome; export che produce un file scaricato con il contenuto atteso; import con le domande unisci/sostituisci e sostituisci/rinomina; messaggio per file non valido.
- **Build.** Un test verifica che un Profilo di base non valido faccia fallire la build e che quelli validi finiscano nel bundle.
- **Prior art.** I test MCP end-to-end, quelli dei moduli server, l'harness del plugin con Figma simulato, il test del bridge della UI e il test di packaging.
- Tutto deve passare con `npm run check`.

## Out of Scope

- Sincronizzazione automatica dei profili tra colleghi o via cloud: si condividono con file o con una release.
- Riconoscimento del Modello Excel nell'uso manuale del plugin, che legge solo il formato `Translations`.
- Distinzione tra brand "di maintenance" e progetti singoli: non è un'etichetta che il plugin conosce.
- Modifica dei Profili di base dal plugin: avviene solo nel repository.
- Pubblicazione del plugin con accesso di rete oltre `localhost` (resta il vincolo dell'ADR 0001).

## Further Notes

- La regola già fissata "lo stato della UI del plugin prevale sui default del profilo" resta valida per nome di output, nomi base e section. Per la scelta del Brand tra plugin e riconoscimento, invece, decide il designer.
- Le soglie di somiglianza vanno tarate sugli Excel reali di Columbia e The North Face, che hanno Modelli Excel diversi.
- La cartella dei Profili di base nel repository contiene già Columbia e The North Face, non ancora committati: diventano i primi Profili di base dopo la migrazione allo schema versione 2.
