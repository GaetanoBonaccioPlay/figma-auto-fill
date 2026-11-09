# L'archivio dei Profili brand vive nel plugin, non nel server MCP

I designer devono poter scegliere, creare, esportare e importare Profili brand dal plugin anche senza agente, e plugin e agente devono vedere sempre le stesse reference. Abbiamo deciso che il plugin è l'unico custode dell'archivio: i Profili di base sono compilati nel plugin a ogni release (sorgente: `brand-profiles/` nel repository, curata dall'amministratore), mentre Profili personali e Aggiunte personali stanno nello spazio di archiviazione del plugin in Figma. Il server MCP non salva più profili su disco: li legge e li scrive attraverso il bridge (ADR 0001), che è già attivo in ogni sessione agente.

## Considered Options

- **Archivio nel server (cartella `brands_dir`), come prima**: scartato perché il plugin non può leggere file su disco, quindi senza agente i designer non vedrebbero i profili.
- **Due archivi sincronizzati, plugin e server**: scartato per il costo di risolvere le divergenze ("ho salvato ma non lo vedo").

## Consequences

- I profili sono per utente e per computer: per condividerli tra colleghi si esportano e importano come file dal plugin, oppure l'amministratore li promuove a Profili di base con una nuova release.
- I profili già salvati nella cartella `brands_dir` vanno importati una volta nel plugin; l'impostazione `brands_dir` del pacchetto `.mcpb` viene rimossa.
- Aggiornare un Profilo di base richiede una nuova release del plugin.
