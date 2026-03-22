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

## Stato attuale — Fase 5 (fix overlay + centramento modal + badge mode + auto-scroll) — TESTATO

### File del plugin (`HandTranscriptMd/src/`)

| File | Cosa fa |
|------|---------|
| `main.ts` | Entry point: registra embed, editor view, comando, ribbon, settings, `previewCallbacks` per sync inline↔tab |
| `settings.ts` | Impostazioni: cartella SVG, dimensioni canvas, sfondo, lingue OCR, chiave API Gemini, toggle `hwmHandwritingMode`; mostra versione (`plugin.manifest.version`) e branch (`PLUGIN_BRANCH` costante hardcoded) nell'header della pagina impostazioni |
| `drawing-canvas.ts` | Motore disegno Canvas API: Bézier quadratiche, penna, gomma parziale, undo/redo history-based, auto-expand, righe foglio, `allowFingerScroll()` |
| `svg-utils.ts` | Conversione tratti ↔ SVG (dati riedit in `<desc>` JSON), righe e sfondo inclusi nell'SVG |
| `embed.ts` | Code block processor → preview SVG inline + pannello portale in document.body; click matita → Modal (Windows) o nuova tab (Android); scroll fix; badge mode |
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
- **Pannello portale** (`hwm_portal-panel`) in `document.body` con 4 bottoni: ✏️ (apre Modal su Windows / tab su Android), 📄 (converti OCR), ↕️ (comprimi/espandi), ✕ (elimina). Posizionato via RAF + `getBoundingClientRect()` + `position: fixed`
- **Scroll fix**: listener `scroll` su `.cm-scroller` / `.markdown-reading-view` che nasconde il pannello immediatamente durante lo scroll (visibilità ripristinata dopo 150ms)
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
- `onClosed?: () => void` — callback invocato alla chiusura per aggiornare il flag `modalOpen` nel RAF loop del pannello portale
- `replaceCodeBlock` / `removeCodeBlock` gestiscono sia formato wiki `![[svg]]` che legacy (prova prima wiki, poi code block come fallback)

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
- **Bottone portale** — pannello floating in `document.body`, si posiziona sopra il riquadro via RAF + getBoundingClientRect, scompare durante lo scroll (listener scroll + visibility hidden/visible)
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

> **Nota**: usare la forma `bash -c "..."` perché in PowerShell `bash deploy.sh` lancia bash in una directory diversa (home di WSL/Git Bash), non nella directory corrente. Racchiudendo tutto dentro bash il `cd` funziona correttamente per tutti i comandi.

```powershell
# Build + deploy al vault locale (solo PC)
bash -c "cd '/c/Projects/pluginObsidian/handWrittenMarkdownConverter/HandTranscriptMd' && node esbuild.config.mjs production && bash deploy.sh"

# Build + deploy su Google Drive (per testare su tablet Android)
bash -c "cd '/c/Projects/pluginObsidian/handWrittenMarkdownConverter/HandTranscriptMd' && node esbuild.config.mjs production && bash cloudDeploy.sh"
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

## Prossimi passi

### ✅ TEST EFFETTUATI (sessione 2026-03-22)

#### Bug 1 — Pannello portale parzialmente visibile con Modal aperto — RISOLTO ✅

**Sintomo**: su Windows, cliccando il bottone matita, i bottoni "Converti" e "Comprimi" del pannello portale restavano visibili sopra il modal mentre il bottone matita scompariva correttamente.
**Causa**: il RAF loop nascondeva solo il bottone matita (`btn.style.display`) ma non l'intero pannello.
**Fix**: il RAF loop ora setta `panel.style.display = 'none'` quando `modalOpen || tabOpen`, nascondendo l'intero pannello portale (tutti e 4 i bottoni).
**File**: `src/embed.ts` — RAF loop in `decorateSpan()`.

---

#### Bug 2 — Canvas modal troppo largo, toolbar non centrata — RISOLTO ✅

**Sintomo**: nel Modal Windows, il canvas occupava tutta la larghezza dell'overlay (troppo largo e non centrato). La toolbar era allineata a sinistra invece che al centro.
**Fix CSS** (`styles.css`):
- `.hwm_canvas-wrap { display: flex; justify-content: center; }` — centra il canvas orizzontalmente
- `.hwm_canvas { max-width: 100%; }` — rimosso `width: 100%` fisso
- `.hwm_editor-topbar--modal { justify-content: center; }` — centra la toolbar nel modal
**Fix TS** (`editor-view.ts`): `DrawingModal.buildEditor()` aggiunge classe `hwm_editor-topbar--modal` alla topbar.

---

#### Bug 3 — Auto-scroll sposta i tratti durante il disegno — RISOLTO ✅

**Sintomo**: quando il canvas si espandeva automaticamente (auto-expand) mentre stavo disegnando, lo scroll automatico verso il basso spostava i punti del tratto corrente rispetto alla posizione del pennino.
**Causa**: l'evento `onResize` faceva scroll immediatamente anche con il pointer premuto, spostando il canvas mentre le coordinate del puntatore erano ancora relative alla posizione pre-scroll.
**Fix**: aggiunto metodo pubblico `isPointerDown(): boolean` in `DrawingCanvas` (`drawing-canvas.ts`). Sia `DrawingEditorView` che `DrawingModal` in `editor-view.ts` ora controllano `!canvas.isPointerDown()` prima di eseguire il `scrollTop` automatico.

---

#### Bug 4 — Badge mode mostra icona in riquadro piccolissimo — RISOLTO ✅

**Sintomo**: attivando "Modalità handwriting Android" nelle impostazioni, i riquadri SVG si riducevano a un quadratino minuscolo invece di un badge orizzontale a piena larghezza.
**Causa**: lo span `.internal-embed` senza figli visibili collassava alla sua larghezza intrinseca (quasi zero).
**Fix CSS** (`.hwm-handwriting-mode .hwm-badge-mode`):
```css
width: 100% !important; box-sizing: border-box !important;
height: 72px !important; display: flex !important;
align-items: center; justify-content: center;
background: var(--background-secondary); border-radius: 6px;
```
Più: `img { display: none !important }` per nascondere l'SVG e `::after { content: "✏️"; font-size: 28px; opacity: 0.5; }` per l'icona.
**File**: `styles.css`.

### Altri task aperti

1. **Migliorare il riconoscimento dei caratteri speciali markdown** — `src/recognizer.ts` + `src/md-parser.ts`:
   - Il testo normale viene riconosciuto correttamente da Gemini
   - Il problema riguarda solo i **simboli markdown**: `#`, `-`, `>`, `**`, `==`, ecc. non vengono riconosciuti/applicati correttamente
   - Migliorare il prompt con few-shot examples espliciti per i simboli (es. "Se vedi `# Titolo` → scrivi `# Titolo`")
   - Valutare se `md-parser.ts` può coprire i casi che il prompt non gestisce

2. **Auto-expand — animazione scattosa** — **BUG APERTO** (parzialmente risolto):
   - Fix precedente: guard `if (this.animFrameId !== null) return` in `checkAutoExpand()` → loop up/down risolto
   - Problema residuo: espansione scattosa invece che fluida
   - File: `src/drawing-canvas.ts` → `animateHeight()` e `checkAutoExpand()`

3. **Toolbar unificata Windows/Android** — **DA FARE**:
   - Attualmente la toolbar su Windows è sempre espansa, su Android è compatta con toggle ▼/▲
   - Obiettivo: unico codice toolbar condiviso, compatta di default su entrambe le piattaforme
   - File coinvolti: `src/editor-view.ts` + `styles.css`

### Problemi risolti

- **Handwriting Android (disegno)** ✅ — risolto con editor in tab separata (`ItemView`), canvas fuori da `cm-content`
- **Pen scroll** ✅ — penna non scrolla più, solo dito (JS manuale via `setPointerCapture`)
- **Toolbar — tema scuro** ✅
- **Spazio vuoto sezione colori in toolbar compatta** ✅
- **Trashcan non cancella visualmente** ✅
- **Bottoni inline coprivano `</>` di Obsidian** ✅ — spostati a `left: 6px`
- **Ordine bottoni inline** ✅ — invertito: X, Converti, Freccia (da sinistra)
- **Placeholder text** ✅ — aggiornato a "Usa il bottone matita in alto a destra per disegnare"
- **Bottone portale non cerchio perfetto** ✅ — risolto con `width/height/min-width/min-height: 36px !important`, `padding: 0 !important`, `overflow: hidden`
- **Icona bottone portale non visibile** ✅ — SVG con `stroke="currentColor"` non diventava bianco; risolto con `.hwm_portal-btn svg { stroke: #ffffff !important }`
- **Bottone portale non si nasconde con editor aperto** ✅ — check `workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING).some(...)` nel RAF loop (Android) + flag `modalOpen` (Windows)
- **Bottone portale `position: absolute` invece di `fixed`** ✅ — `getBoundingClientRect()` restituisce coordinate viewport, non serviva aggiungere `scrollY/scrollX`
- **Bottoni pannello portale rimangono visibili durante lo scroll** ✅ — listener `scroll` su `.cm-scroller`/`.markdown-reading-view` che setta `visibility: hidden` durante lo scroll
- **Modal Windows** ✅ — implementato `DrawingModal extends Modal`; click matita su Desktop apre modal invece di nuova tab
- **Switch handwriting** ✅ — `hwmHandwritingMode` in settings; badge mode via classe CSS su `document.body` e sullo span
- **DrawingModal non gestiva formato wiki** ✅ — aggiunto `wikiEmbedRegex()` e logica try-wiki-then-legacy in `replaceInMd()`
- **Pannello portale visibile con Modal aperto (Bug 1)** ✅ — RAF loop ora nasconde l'intero panel (`display: none`) quando `modalOpen || tabOpen`, non solo il bottone matita
- **Canvas modal non centrato, toolbar a sinistra (Bug 2)** ✅ — `display: flex; justify-content: center` su `.hwm_canvas-wrap`; `max-width: 100%` su `.hwm_canvas`; classe `hwm_editor-topbar--modal` aggiunta al topbar del modal per centrare la toolbar
- **Auto-scroll sposta tratti durante disegno (Bug 3)** ✅ — aggiunto `isPointerDown()` in `DrawingCanvas`; scroll automatico bloccato se il pointer è premuto, sia in `DrawingEditorView` che in `DrawingModal`
- **Badge mode mostra riquadro minuscolo (Bug 4)** ✅ — CSS `.hwm-handwriting-mode .hwm-badge-mode` con `width: 100% !important`, `height: 72px`, flex centrato, `img { display: none }` + `::after` con emoji matita

### BUG APERTO — Handwriting disabilitato nel documento quando il riquadro è presente

**Sintomo**: quando nel documento è presente un riquadro handwriting con un disegno (SVG non vuoto), la stylus handwriting-to-text di Android smette di funzionare nell'intero editor. Cancellare il riquadro ripristina l'handwriting. Il problema persiste tra riavvii di Obsidian.

**Progressione delle scoperte**:

**Fase 1 — Formato code block** (tentativi 16-26):
- `contenteditable="false"` su wrapper CM6 → rimosso → non risolve
- `touch-action: none` → rimosso → non risolve
- `background-image` SVG → rimossa → non risolve
- `<canvas>` nel DOM → rimosso → non risolve
- Canvas in `document.body` (fuori da CM6) toccato con stylus → **rompe handwriting** — conclusione: è il canvas element quando toccato dalla stylus, non la sua posizione nel DOM
- **Causa root fase 1**: Android WebView tratta qualsiasi `<canvas>` toccato dalla stylus come "drawing surface" e disabilita handwriting-to-text a livello di sessione WebView

**Fase 2 — Passaggio a formato wiki `![[svg]]`** (sessione 2026-03-19):

L'obiettivo era eliminare il `<canvas>` dal documento e mostrare solo l'`<img>` nativa di Obsidian.

Problema riscontrato: l'SVG vuoto (300px di altezza) NON rompe l'handwriting. L'SVG con un disegno (altezza variabile dopo auto-expand) SÌ lo rompe — anche dopo riavvio Obsidian, anche senza mai aprire la tab editor.

Cambiamenti implementati durante la fase 2:
- Passaggio da code block a `![[svg]]` come formato principale
- `insertHandwritingBlock()` crea il file SVG PRIMA di inserire il wikilink (altrimenti Obsidian mostra "could not be found")
- MutationObserver su `document.body` per intercettare gli span (il post-processor non funziona per i widget CM6 immagine in live preview)
- Fix data-URI: `img.src = data:image/svg+xml,...` → cambiato in cache-bust URL (`?t=timestamp`) perché la data-URI veniva interpretata da Android come drawing surface
- Rimosso `addWikiOverlay` (aggiungeva `hwm_inline-buttons` come figlio dello span): la struttura dello span è ora identica a un'immagine normale
- Pannello portale (`hwm_portal-panel`) in `document.body` con tutti e 4 i bottoni

**Fase 3 — Test approfonditi (sessione 2026-03-22)**:

**Test A — Rimozione `touch-action: none` da `.hwm_resize-handle`** (tentativo 29):
- Motivazione: `touch-action: none` è uno dei segnali che Android WebView usa per identificare "drawing surfaces". Rimuovendolo dal resize handle, si riduce il numero di elementi che si qualificano come drawing surface.
- Risultato: **non risolve**. L'handwriting si rompe ugualmente dopo aver aperto la tab editor.

**Test B — IME reset alla chiusura della tab editor** (tentativo 30):
- Motivazione: ipotesi che la sessione IME (Input Method Engine) di Android venisse "bloccata" dall'apertura della DrawingEditorView. Un blur/focus sul `cm-content` dopo la chiusura avrebbe potuto resettarla.
- Implementazione: `DrawingEditorView.onClose()` fa `cm.blur(); setTimeout(() => cm.focus(), 80)` solo su mobile.
- Risultato: **non risolve**. L'handwriting rimane rotto dopo la chiusura.

**Test C — Sostituzione `<canvas>` con `<svg>` nel motore di disegno** (tentativo 31):
- Motivazione (Opzione C dalle ipotesi): il `<canvas>` è l'elemento che Android WebView riconosce come drawing surface. Sostituendolo con un `<svg>` (che disegna tramite elementi `<path>`), il motore di disegno non avrebbe più alcun canvas DOM.
- Implementazione: riscrittura completa di `drawing-canvas.ts` con `SVGElement`, `<rect>` per sfondo, `<g>` per righe e tratti, `<path>` per ogni tratto con Bézier midpoint. Rimosso `touch-action: none`.
- Risultato: **non risolve**. L'handwriting si rompe ugualmente dopo aver aperto la tab editor SVG. Implementazione reverted dall'utente.

**Test D — Apertura tab senza disegnare nulla** (tentativo 32):
- Motivazione: verificare se il trigger fosse il canvas toccato dalla stylus oppure la semplice apertura della tab.
- Test: aprire la DrawingEditorView, non toccarla, chiuderla → tentare handwriting nel documento.
- Risultato: **handwriting rotto anche senza aver toccato nulla nel canvas**. Il trigger è l'apertura della tab, non il disegno. Questo esclude che `touch-action`, `setPointerCapture` o qualsiasi evento di disegno siano la causa.

**Test E — Apertura in nuova finestra Obsidian** (tentativo 33):
- Motivazione: Obsidian Mobile già apre la tab editor in una nuova finestra separata (`workspace.getLeaf('tab')`). Ipotesi che la separazione di finestra potesse isolare lo stato IME.
- Risultato: **non risolve**. Confermato dall'utente che l'editor già apre in una finestra separata, ma il problema persiste. Tutto il runtime condivide lo stesso processo WebView → lo stato `StylusWritingManager` è condiviso a livello di processo, non di finestra.

**Stato finale (2026-03-22)**: limite architetturale di Obsidian Mobile confermato. Il `StylusWritingManager` di Android WebView (componente compositor-level di Chromium) viene disabilitato al livello del processo WebView quando rileva l'apertura di una "drawing surface" (qualsiasi tab con canvas/SVG interattivo). Non è risolvibile via JS/CSS dall'interno dell'app.

**Workaround attuale**: lo switch "Modalità handwriting Android" nelle impostazioni. Quando attivo, i riquadri mostrano solo il badge 72px (non interferisce con il proximity detection) e l'utente deve aprire l'editor consapevolmente quando vuole disegnare, sapendo che l'handwriting-to-text nel documento verrà interrotto per quella sessione.

**Conferma esterna**: il plugin **Excalidraw** e il plugin **Handwritten Notes** hanno lo stesso identico problema — appena si apre la tab di disegno, l'handwriting-to-text si disattiva nell'intero Obsidian e non si ripristina nemmeno riavviando l'app. È un limite di Android WebView, non specifico al nostro plugin. **Non esiste soluzione lato plugin**; il compromesso dello switch è la scelta definitiva.

**Ricerca approfondita sul sorgente Chromium (2026-03-22)**:

- **Nessun bug Chromium aperto trovato** per questo problema specifico (il tracker non è scrapeable)
- **Obsidian Ink Issue #156** — ancora aperta, nessuna soluzione
- **Scoperta chiave**: il `<canvas>` da solo NON disabilita l'handwriting — non esiste codice canvas-specifico in Chromium che imposti `kInternalNotWritable`. Il trigger reale è **`touch-action: none`**: qualsiasi elemento con quella proprietà CSS fa scattare il flag `kInternalNotWritable` in `touch_action_util.cc`, disabilitando la scrittura con stilo su quell'elemento
- **Commit rilevante** (~5 mesi fa): `b06690ad` — Samsung DirectWriting disabilitato su Android 14+. Se il dispositivo è Android 14+, il percorso Samsung proprietario (closed source, potenzialmente causa di session-corruption) è già escluso
- **Ipotesi residua più probabile**: quando `DrawingEditorView` si apre, il `touch-action: none` del canvas o del suo scroll container viene propagato a livello di Android View dal WebView, e alla chiusura della tab quella configurazione non viene resettata

**Possibile prossimo test**: rimuovere completamente `touch-action: none` dal canvas e dal suo scroll container in `drawing-canvas.ts` / `editor-view.ts` e verificare se il problema persiste. Se il canvas da solo non rompe nulla (come confermato dal sorgente Chromium), potrebbe bastare rimuovere quella proprietà.

**Fonti**:
- [Chromium Stylus Handwriting README](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/stylus_handwriting/README.md)
- [ProseMirror Issue #565](https://github.com/ProseMirror/prosemirror/issues/565)
- Plugin Ink ha lo stesso problema irrisolto ([Issue #156](https://github.com/daledesilva/obsidian_ink/issues/156))

**Scoperte chiave consolidate**:
- `inputmode="none"` contamina l'intero WebView — MAI usare
- Empty SVG (300px) NON rompe handwriting; SVG con disegno (altezza > 300px per auto-expand) SÌ (sessione 2026-03-19)
- data-URI come `img.src` rompe handwriting → usare sempre URL vault + cache-bust
- Il problema è persistente tra sessioni (riavvio Obsidian) — non è corruzione di sessione temporanea
- Rimuovere completamente la nostra decorazione (nessun figlio nello span) non risolve — la causa è nell'SVG stesso o nella sua altezza
- **Il trigger è l'apertura della DrawingEditorView, non il disegno** — aprire senza toccare nulla già rompe l'handwriting (scoperta sessione 2026-03-22)
- **Anche una finestra Obsidian separata non isola il problema** — il WebView process è condiviso (scoperta sessione 2026-03-22)

**Tentativi falliti (completo)**:

| # | Approccio | Risultato |
|---|-----------|-----------|
| 16 | Rimuovere `beforeinput` listener globale | Non risolve |
| 17 | `<button>` → `<div role="button">` in cm-content | Non risolve |
| 18 | `<img>` → CSS `background-image` | Non risolve |
| 19 | Rimuovere `contenteditable="false"` dai wrapper CM6 + `pointer-events: none` | Non risolve |
| 20-23 | DevTools: rimuovere CE=false, touch-action, background-image, canvas dal DOM | Non risolve |
| 24 | Editor in Modal invece di tab | Non praticabile (stylus non disegna nel modal) |
| 25 | Bottone portale in `document.body` | Non risolve (canvas nella tab corrompe sessione) |
| 26 | Test console: canvas fake in `document.body` toccato con stylus | Conferma: canvas + stylus = handwriting rotto |
| 27 | Passaggio a `![[svg]]` con MutationObserver | Non risolve |
| 28 | Rimozione totale decorazione dallo span (nessun figlio aggiunto) | Non risolve |
| 29 | Rimosso `touch-action: none` da `.hwm_resize-handle` | Non risolve |
| 30 | IME reset (blur/focus su `cm-content`) in `DrawingEditorView.onClose()` | Non risolve |
| 31 | Sostituzione `<canvas>` con `<svg>` nel motore di disegno (Option C) | Non risolve — reverted |
| 32 | Apertura tab senza disegnare nulla | Conferma: il trigger è l'apertura della tab, non il disegno |
| 33 | Apertura in nuova finestra Obsidian (già fatto di default su Mobile) | Non risolve — WebView process condiviso |

---

## Ricerca effettuata — Plugin esistenti

### Nessuno fa esattamente questo. Gap confermato.

| Plugin | Cosa fa | Manca |
|--------|---------|-------|
| **Ink** (`daledesilva/obsidian_ink`) | Canvas inline nel `.md`, tldraw, penna | OCR/conversione testo (in roadmap) |
| **Handwriting to Text** (`jirayu3141`) | Foto → Gemini AI → testo nel cursore | Non è canvas inline, è workflow foto |
| **Petrify** (`jo-minjun/petrify`) | File tablet e-ink → Excalidraw/MD con OCR | Pensato per reMarkable/Boox, non canvas inline |
| **AI Image OCR** (`rootiest`) | Immagine → AI OCR → testo | Non è canvas inline |
| **Pergament** (`hobyte`) | Canvas embedded primitivo | Nessun OCR, sviluppo lento |

### Differenze rispetto a Ink (nostro riferimento)

| Ink | Il nostro plugin |
|-----|-----------------|
| tldraw (pesante, React) | Canvas API nativa (leggero, zero dipendenze extra) |
| File `.drawing` proprietari JSON | File **SVG standard** visibili ovunque |
| Nessuna conversione testo | **OCR + conversione markdown** (Fase 2) |
| React + Jotai | Vanilla TypeScript |
