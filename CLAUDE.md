# Obsidian Handwriting Plugin — Contesto per Claude Code

## Chi sono / Setup esistente

- Sviluppatore IT con esperienza in C#, JavaScript, TypeScript, Python, SQL Server, VB6
- Vault Obsidian organizzato: `Project/CLIENTI/NOME_CLIENTE/Progetto/`
  - Sottocartella `_docs/` sincronizzata via **Google Drive**
  - Struttura: `01_Riunioni/`, `02_Documentazione/`, `03_UI_Diagrammi/`, `DECISIONS.md`, `IDEAS.md`, `TODO.md`
- Su PC usa **Claude Code** che legge i file markdown direttamente
- Tablet Android con pennino (in valutazione acquisto)

---

## Obiettivo: Plugin Obsidian "Handwriting to Markdown"

### Cosa voglio

Un plugin Obsidian che inserisce un **riquadro canvas inline** in un file `.md` dove posso:

1. **Scrivere a mano con il pennino** (su tablet Android)
2. Il testo scritto viene **convertito automaticamente in markdown strutturato**:
   - `# testo` → H1, `## testo` → H2, `### testo` → H3
   - `- testo` → lista, `1. testo` → lista numerata
   - `- [ ] testo` → checkbox, `- [x]` → checkbox spuntata
   - `> testo` → blockquote
   - `` `testo` `` → codice inline, ` ```js ... ``` ` → blocco codice
   - `==testo==` → highlight, `**testo**` → grassetto, `*testo*` → corsivo
   - `~~testo~~` → barrato, `---` → separatore
3. Il risultato è **testo markdown puro** inserito nel file `.md` esistente
4. I disegni/schemi restano come immagine SVG linkati nel markdown
5. **Bidirezionale**: modificabile sia da tablet che da PC
6. **Nessun formato proprietario** — i file devono essere leggibili anche senza il plugin installato

### Requisiti tecnici

- Funziona su **Android** (Obsidian Mobile) e **Windows**
- Sync via **Google Drive** (già configurato)
- I file `.md` devono restare leggibili da **Claude Code** su PC
- Preferenza per soluzioni **senza dipendenze cloud** dove possibile

---

## Stato attuale — Fase 6 (pannello portale inline + bgMode live update + fix CSS tema) — TESTATO

### File del plugin (`HandTranscriptMd/src/`)

| File | Cosa fa |
|------|---------|
| `main.ts` | Entry point: registra embed, editor view, comando, ribbon, settings, `previewCallbacks` per sync inline↔tab |
| `settings.ts` | Impostazioni: cartella SVG, dimensioni canvas, sfondo, lingue OCR, chiave API Gemini, toggle `hwmHandwritingMode`; mostra versione (`plugin.manifest.version`) e branch (`PLUGIN_BRANCH` costante hardcoded) nell'header della pagina impostazioni |
| `drawing-canvas.ts` | Motore disegno Canvas API: Bézier quadratiche, penna, gomma parziale, undo/redo history-based, auto-expand, righe foglio, `allowFingerScroll()` |
| `svg-utils.ts` | Conversione tratti ↔ SVG (dati riedit in `<desc>` JSON), righe e sfondo inclusi nell'SVG |
| `embed.ts` | Code block processor → preview SVG inline + pannello portale (figlio dello span, position:absolute); click matita → Modal (Windows) o nuova tab (Android); badge mode; `onBgModeRemap` per aggiornare SVG al cambio tema |
| `editor-view.ts` | `DrawingEditorView` (tab dedicata, Android) + `DrawingModal` (overlay fullscreen, Windows), toolbar completa, auto-save |
| `recognizer.ts` | `IRecognizer` interface + `GeminiRecognizer`: invia PNG base64 a Gemini API, restituisce testo |
| `md-parser.ts` | `parseMarkdown()`: post-processa testo OCR riga per riga applicando sintassi markdown |

### Architettura attuale (Fase 3+)

**Due formati supportati:**
- **NUOVO (default)**: `![[_handwriting/hw_xxx.svg]]` — SVG visibile nativamente anche senza plugin
- **LEGACY**: `` ```handwriting {"id":..., "svg":...}``` `` — vecchio formato, mantenuto per compatibilità

**Preview inline — Nuovo formato wiki:**
- Obsidian renderizza `![[svg]]` come `<span class="internal-embed image-embed">[img][/img]</span>`
- **MutationObserver su `document.body`** intercetta gli span con `src*="_handwriting/"` non appena appaiono nel DOM (funziona sia in reading view che in live preview dove il post-processor non viene chiamato)
- `tryDecorate()` con flag `data-hwm-decorated="1"` per evitare doppia elaborazione; ritenta dopo 150ms se la classe `image-embed` non è ancora presente (caricamento asincrono)
- **Classe badge mode**: `span.classList.toggle('hwm-badge-mode', hwmHandwritingMode)` — unica modifica allo span quando lo switch è attivo
- **Pannello portale** (`hwm_portal-panel`) con 4 bottoni: ✏️ (apre Modal su Windows / tab su Android), 📄 (converti OCR), ↕️ (comprimi/espandi), ✕ (elimina).
  - **Posizione**: `container.appendChild(panel)` — il pannello è un figlio diretto dello span; `position: absolute; top: 6px; right: 6px` ancorato allo span (che ha `position: relative`). Non più in `document.body`.
  - **Nessun RAF loop**: eliminato il loop `requestAnimationFrame` e il listener `scroll`. Il pannello segue lo span naturalmente nel DOM.
  - **Cleanup**: `plugin.register(() => panel.remove())` — il pannello viene rimosso quando il plugin viene disabilitato.
  - **Click dei bottoni**: lo span ha `pointer-events: none` (per handwriting Android); il pannello ha `pointer-events: auto` in CSS per ripristinare i click.
  - **Nascondere con modal aperto**: Desktop → `panel.style.display = 'none'` nel click handler, ripristinato nel callback `modal.onClosed`; Mobile → `workspace.on('layout-change', ...)` per rilevare apertura/chiusura tab.
- **Comprimi/Espandi**: usa `container.style.height + overflow: hidden` sullo span contenitore — modifica solo l'altezza visibile senza toccare la larghezza dell'immagine.
- **Refresh immagine**: `previewCallbacks.set(embedId, ...)` aggiorna `img.src` con cache-bust `?t=timestamp` dopo ogni salvataggio dalla tab editor (Obsidian non aggiorna automaticamente `![[svg]]` in live preview quando il file cambia)
- **NO data-URI**: il src dell'img resta sempre l'URL vault (`http://localhost/_capacitor_file_/...`) — un data-URI verrebbe interpretato da Android come drawing surface

**Preview inline — Formato legacy:**
- Mostra l'SVG come CSS `background-image` su un `<div>` (no `<img>`)
- 3 bottoni inline (`<div role="button">`, non `<button>`) dentro il container del code block
- Bottone portale singolo (`hwm_portal-btn`, cerchio matita) in `document.body` per aprire la tab editor

**Editor disegno — due modalità (`editor-view.ts`):**

`DrawingEditorView extends ItemView` — usato su **Android**:
- Canvas in un DOM completamente separato da CodeMirror → **nessun conflitto handwriting Android**
- Top bar: bottone ← a sinistra (chiude tab), toolbar completa a destra
- Scroll container: `overflow-y: auto` per canvas più grandi dello schermo
- Finger scroll: `allowFingerScroll(scrollContainer)` — dito scrolla, penna disegna
- Auto-save debounced 2s + `plugin.refreshPreview()` aggiorna la preview inline

`DrawingModal extends Modal` — usato su **Windows**:
- Overlay fullscreen (`hwm_modal`: `95vw × 90vh`) che appare sopra il documento
- Stessa toolbar e stesso canvas di `DrawingEditorView`
- `onClosed?: () => void` — callback invocato alla chiusura per ripristinare `panel.style.display` nel pannello portale
- `replaceCodeBlock` / `removeCodeBlock` gestiscono sia formato wiki `![[svg]]` che legacy (prova prima wiki, poi code block come fallback)
- `private bgModeListener` registrato in `buildEditor()` (dopo `colorBtns`) e rimosso in `onClose()` — aggiorna topbar, toolbar, pallini colore e canvas al cambio bgMode in tempo reale (utile se le impostazioni fossero accessibili con modal aperto)

**Comportamento bottone matita (pannello portale):**
- `Platform.isDesktop` → `new DrawingModal(...).open()` — si apre nella stessa finestra
- `Platform.isMobile` → `workspace.getLeaf('tab')` con `DrawingEditorView`
- Bottone matita nascosto: `modalOpen || tabOpen` — scompare sia quando Modal è aperto (Windows) sia quando la tab è aperta (Android)

**Modalità handwriting (`hwmHandwritingMode`):**
- Switch nelle impostazioni: "Modalità handwriting Android"
- Se ON: `document.body.classList.add('hwm-handwriting-mode')` + classe `hwm-badge-mode` sullo span → CSS riduce l'SVG a 48px di altezza (badge/thumbnail)
- Se OFF (default): SVG piena, comportamento normale
- Si applica immediatamente senza ricaricare il plugin (toggle in settings chiama `document.body.classList.toggle(...)`; all'avvio viene applicato in `registerEmbed()`)

### Funzionalità implementate

- **Preview SVG inline** nel markdown via code block `handwriting` (immagine statica, no canvas)
- **Editor in tab dedicata** — click sulla preview apre una tab Obsidian separata
- **Curve smooth** — Bézier quadratiche con tecnica midpoint
- **Gomma parziale** — cancella solo i punti toccati, taglia i tratti in segmenti
- **Undo/Redo** — basato su history di stati (funziona sia per disegno che per gomma)
- **Auto-expand** — il canvas si espande con animazione smooth + auto-scroll nel container
- **Clear → reset** alla dimensione di default con animazione
- **Righe orizzontali** — foglio a righe (32px), sia nel canvas che nell'SVG
- **Temi sfondo** — chiaro/scuro/custom con color picker nelle impostazioni
- **Remapping colori automatico** — i tratti si adattano al cambio tema (nero↔bianco, blu↔azzurro, ecc.)
- **Toolbar completa** — penna, gomma, 4 colori, undo, redo, clear, converti, salva, elimina (X)
- **Elimina riquadro** — da inline (3 bottoni) o da tab editor
- **Auto-save** — salvataggio debounced 2s + refresh preview inline
- **SVG standard** — file `.svg` nella cartella `_handwriting/`, visibili da qualsiasi dispositivo
- **Palette colori adattiva** — colori scuri su sfondo chiaro, colori chiari su sfondo scuro
- **OCR via Gemini** — SVG → PNG base64 → Gemini 3.1 Flash Lite → `md-parser` → sostituisce code block
- **Archiviazione SVG** — dopo la conversione, SVG spostato in `_handwriting/_converted/AAAA-MM-GG_HH-MM-SS.svg`
- **Settings OCR** — chiave API Gemini (campo password) + lingue OCR configurabili (default: `it, en`)
- **Supporto Android** — penna disegna, dito scrolla, nessun conflitto handwriting
- **Comprimi/Espandi** — preview inline si può compattare all'altezza di default (freccia con rotazione 180°)
- **Bottone portale** — pannello `position: absolute` figlio diretto dello span (no RAF loop, no scroll listener, no document.body)
- **Preview non tappabile** — click handler rimosso; l'unico modo per aprire l'editor è il bottone matita nel pannello portale
- **Modal Windows** — click matita su Desktop apre `DrawingModal` (overlay fullscreen nella stessa finestra, no tab separata)
- **Nuova tab Android** — click matita su Mobile apre `DrawingEditorView` in tab separata
- **Switch handwriting** — toggle nelle Settings: se ON, i riquadri mostrano solo una piccola anteprima (48px) per non bloccare lo stylus handwriting nel testo

### Embedding nel markdown

**Nuovo formato (default):**
```markdown
![[_handwriting/hw_abc123.svg]]
```
Il file SVG è visibile come immagine anche senza il plugin. I tratti sono salvati come JSON in `<desc class="hwm-strokes">` dentro l'SVG.

**Legacy (backward compat):**
````markdown
```handwriting
{"id":"hw_abc123","svg":"_handwriting/hw_abc123.svg"}
```
````

### Deploy (comandi copia-incolla per PowerShell)

> **Nota**: usare Git Bash esplicitamente con `--login` perché PowerShell usa WSL bash di default (che non riconosce i percorsi Windows) e senza `--login` il PATH non include i tool Unix (dirname, cp, wc, ecc.).

```powershell
# Build + deploy al vault locale (solo PC)
cd C:\Projects\pluginObsidian\handWrittenMarkdownConverter\HandTranscriptMd; node esbuild.config.mjs production; & "C:\Program Files\Git\bin\bash.exe" --login deploy.sh

# Build + deploy su Google Drive (per testare su tablet Android)
cd C:\Projects\pluginObsidian\handWrittenMarkdownConverter\HandTranscriptMd; node esbuild.config.mjs production; & "C:\Program Files\Git\bin\bash.exe" --login cloudDeploy.sh
```

### Percorsi vault

- **Vault locale di test:** `C:\Projects\CLIENTI\IOTTI\IOTTI_APP\_docs\handwriting-to-markdown\`
  - Plugin in `.obsidian\plugins\handwriting-to-markdown\`
- **Vault Google Drive (tablet):** `C:\Users\gabri\Il mio Drive (gabrielecusato@gmail.com)\Projects\handwriting-to-markdown\`

### Come sviluppare

```powershell
# Dev mode (watch)
cd C:\Projects\pluginObsidian\handWrittenMarkdownConverter\HandTranscriptMd; npm run dev

# Dopo ogni modifica per testare su PC:
cd C:\Projects\pluginObsidian\handWrittenMarkdownConverter\HandTranscriptMd; node esbuild.config.mjs production; bash deploy.sh

# Dopo ogni modifica per testare su tablet Android:
cd C:\Projects\pluginObsidian\handWrittenMarkdownConverter\HandTranscriptMd; node esbuild.config.mjs production; bash cloudDeploy.sh

# In Obsidian: Ctrl+P → "Reload app without saving"
```

---

## Note architetturali

### Come funziona il flusso OCR

1. `canvas.getStrokes()` → array di `Stroke[]`
2. `strokesToSvg()` → stringa SVG (già usata per il salvataggio)
3. `DOMParser` → `SVGElement` DOM
4. `svgToBase64Png(svgEl)` → PNG base64 via canvas HTML temporaneo (Blob URL → Image → canvas `toDataURL`)
5. `GeminiRecognizer.recognize(base64)` → POST a Gemini con `inline_data` + prompt
6. `parseMarkdown(testo)` → post-processing riga per riga
7. `archiveSvg()` → sposta SVG in `_converted/` con nome timestamp
8. `replaceEmbedWithMarkdown()` → regex sul file `.md` sostituisce il code block

### Perché Gemini e non API native Android

- `navigator.createHandwritingRecognizer` era un Origin Trial Chrome sperimentale, mai arrivato a stable
- Obsidian Mobile usa WebView → API non disponibile su Xiaomi Pad 5 né altri dispositivi
- `window.prompt()` non funziona in Electron (Obsidian desktop)
- Gemini REST API funziona identicamente su Windows e Android

### Modello Gemini usato

`gemini-3.1-flash-lite-preview` — documentazione: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview

---

> **Storico sessioni, bug risolti e funzionalità completate** → vedi [`NOTES.md`](./NOTES.md)
> I task completati vanno spostati in `NOTES.md`; in questa sezione restano solo i task ancora da fare.

## Regole di sviluppo

> **Keyword parser**: ogni volta che si aggiunge o rimuove una keyword accettata in `src/md-parser.ts`, va aggiornata **anche** la tabella `KEYWORDS` in `src/settings.ts` (sezione "Keyword riconosciute dal parser OCR"). Le due liste devono essere sempre sincronizzate.

## Prossimi passi

### Task aperti

- **Keyword personalizzate nelle impostazioni** — `src/settings.ts` + `src/md-parser.ts`:
  - Permettere all'utente di aggiungere keyword custom nella pagina impostazioni
  - Ogni keyword custom ha: nome (es. `FIRMA`), output markdown (es. `— Mario Rossi`)
  - Le keyword custom vengono caricate in `expandKeywords` insieme a quelle predefinite

