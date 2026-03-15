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

## Stato attuale — Fase 3 COMPLETATA (editor in tab separata)

### File del plugin (`HandTranscriptMd/src/`)

| File | Cosa fa |
|------|---------|
| `main.ts` | Entry point: registra embed, editor view, comando, ribbon, settings, `previewCallbacks` per sync inline↔tab |
| `settings.ts` | Impostazioni: cartella SVG, dimensioni canvas, sfondo, lingue OCR, chiave API Gemini (campo password) |
| `drawing-canvas.ts` | Motore disegno Canvas API: Bézier quadratiche, penna, gomma parziale, undo/redo history-based, auto-expand, righe foglio, `allowFingerScroll()` |
| `svg-utils.ts` | Conversione tratti ↔ SVG (dati riedit in `<desc>` JSON), righe e sfondo inclusi nell'SVG |
| `embed.ts` | Code block processor → preview SVG inline con 3 bottoni (X, converti, comprimi) in alto a sinistra + bottone portale in document.body; preview non cliccabile |
| `editor-view.ts` | `DrawingEditorView extends ItemView` — editor canvas in tab Obsidian dedicata, toolbar completa, scroll, auto-save |
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
- **ZERO modifica al DOM dello span** — nessuna classe aggiunta, nessun figlio inserito, nessuno stile inline. Lo span resta identico a qualsiasi altra immagine Obsidian
- **Pannello portale** (`hwm_portal-panel`) in `document.body` con 4 bottoni: ✏️ (apre tab editor), 📄 (converti OCR), ↕️ (comprimi/espandi), ✕ (elimina). Posizionato via RAF + `getBoundingClientRect()` + `position: fixed`
- **Refresh immagine**: `previewCallbacks.set(embedId, ...)` aggiorna `img.src` con cache-bust `?t=timestamp` dopo ogni salvataggio dalla tab editor (Obsidian non aggiorna automaticamente `![[svg]]` in live preview quando il file cambia)
- **NO data-URI**: il src dell'img resta sempre l'URL vault (`http://localhost/_capacitor_file_/...`) — un data-URI verrebbe interpretato da Android come drawing surface

**Preview inline — Formato legacy:**
- Mostra l'SVG come CSS `background-image` su un `<div>` (no `<img>`)
- 3 bottoni inline (`<div role="button">`, non `<button>`) dentro il container del code block
- Bottone portale singolo (`hwm_portal-btn`, cerchio matita) in `document.body` per aprire la tab editor

**Editor in tab separata (`editor-view.ts`):**
- `DrawingEditorView extends ItemView` di Obsidian
- Canvas in un DOM completamente separato da CodeMirror → **nessun conflitto handwriting Android**
- Top bar: bottone ← a sinistra (chiude tab), toolbar completa a destra
- Scroll container: `overflow-y: auto` per canvas più grandi dello schermo
- Auto-scroll: callback `onResize` su DrawingCanvas → scrolla verso il basso durante auto-expand
- Finger scroll: `allowFingerScroll(scrollContainer)` — `touch-action` resta `none` (penna non scrolla), dito scrolla il container via `setPointerCapture` + JS manuale
- Resize handle visibile ma `pointer-events: none` (no drag manuale, solo auto-expand)
- Auto-save debounced 2s + callback `plugin.refreshPreview()` aggiorna la preview inline
- Converti/Elimina funzionano anche dalla tab (manipolano il .md via `sourcePath`)

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
- **Bottone portale** — pulsante cerchio con icona matita in `document.body` (fuori da cm-content), si posiziona sopra il riquadro via RAF + getBoundingClientRect, si nasconde automaticamente se la tab editor è già aperta o il riquadro esce dal viewport
- **Preview non tappabile** — click handler rimosso; l'unico modo per aprire l'editor è il bottone portale

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

```powershell
# Build + deploy al vault locale (solo PC)
cd C:\Projects\pluginObsidian\handWrittenMarkdownConverter\HandTranscriptMd; node esbuild.config.mjs production; bash deploy.sh

# Build + deploy su Google Drive (per testare su tablet Android)
cd C:\Projects\pluginObsidian\handWrittenMarkdownConverter\HandTranscriptMd; node esbuild.config.mjs production; bash cloudDeploy.sh
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

### BUG handwriting — Test da fare in ordine

**Test A — `pointer-events: none` sullo span** (1 riga, da provare per primo):
- In `tryDecorate()`, aggiungere `span.style.pointerEvents = 'none'` dopo `span.dataset.hwmDecorated = '1'`
- I bottoni portale (in `document.body`) continuano a funzionare
- Verifica: con SVG riempito nel documento, l'handwriting funziona?
- Se sì → risolto. Se no → Chrome usa DOM walk separato, pointer-events non basta

**Test B — Limitare max-height dell'immagine** (se A non funziona):
- Ipotesi: SVG vuoto (300px) non rompe, SVG riempito (500px+) rompe → è la HEIGHT del CE=false che causa il problema
- Test empirico: aggiungere in CSS `.internal-embed[src*="_handwriting/"] img { max-height: 300px; object-fit: contain; }` e verificare se con un SVG alto (dopo auto-expand) l'handwriting funziona
- Se sì → limitare max-height è la soluzione
- Se no → l'altezza non è la causa, passare a C

**Test C — Placeholder in Live Preview** (se B non funziona):
- In live preview (span dentro `.cm-editor`), mostrare solo un piccolo badge "📝 disegno" di 40px di altezza invece dell'SVG pieno
- L'SVG pieno appare solo in Reading View (span dentro `.markdown-reading-view`)
- Come distinguerle: `span.closest('.cm-editor')` vs `span.closest('.markdown-reading-view')`
- Questo riduce il CE=false a un'area minima → handwriting dovrebbe funzionare nelle righe di testo circostanti

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
- **Bottone portale non si nasconde con editor aperto** ✅ — aggiunto check `workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING).some(...)` nel RAF loop
- **Bottone portale `position: absolute` invece di `fixed`** ✅ — `getBoundingClientRect()` restituisce coordinate viewport, non serviva aggiungere `scrollY/scrollX`

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

**Fase 2 — Passaggio a formato wiki `![[svg]]`** (sessione corrente):

L'obiettivo era eliminare il `<canvas>` dal documento e mostrare solo l'`<img>` nativa di Obsidian.

Problema riscontrato: l'SVG vuoto (300px di altezza) NON rompe l'handwriting. L'SVG con un disegno (altezza variabile dopo auto-expand) SÌ lo rompe — anche dopo riavvio Obsidian, anche senza mai aprire la tab editor.

Cambiamenti implementati durante la fase 2:
- Passaggio da code block a `![[svg]]` come formato principale
- `insertHandwritingBlock()` crea il file SVG PRIMA di inserire il wikilink (altrimenti Obsidian mostra "could not be found")
- MutationObserver su `document.body` per intercettare gli span (il post-processor non funziona per i widget CM6 immagine in live preview)
- Fix data-URI: `img.src = data:image/svg+xml,...` → cambiato in cache-bust URL (`?t=timestamp`) perché la data-URI veniva interpretata da Android come drawing surface
- Rimosso `addWikiOverlay` (aggiungeva `hwm_inline-buttons` come figlio dello span): la struttura dello span è ora identica a un'immagine normale
- Pannello portale (`hwm_portal-panel`) in `document.body` con tutti e 4 i bottoni

**Stato attuale**: dopo aver rimosso TUTTA la nostra decorazione dallo span (nessun figlio aggiunto, nessuna classe, nessuno stile), il problema persiste. Lo span è identico a quello di un'immagine normale Obsidian, ma l'handwriting si rompe ugualmente con l'SVG riempito.

**Ipotesi residue** (non ancora testate):

| # | Ipotesi | Razionale |
|---|---------|-----------|
| A | `pointer-events: none` sullo span | Se Chrome usa lo stesso hit-test dei pointer events per la proximity detection, potrebbe ignorare lo span e trovare il `cm-content[ce=true]` sottostante. Incerto: Chrome potrebbe fare un DOM walk separato per `contenteditable` indipendente da pointer-events |
| B | Altezza SVG: l'empty SVG è 300px, il filled SVG è più alto (auto-expand). Un CE=false più alto copre più area → più probabile interferire con la proximity detection (40dp dal bordo). Fix: limitare max-height dell'immagine nel documento | La proximity detection è 40dp verticale — un'immagine da 500px di altezza occupa molto più "territorio" di una da 300px |
| C | Placeholder in Live Preview | Mostrare solo un piccolo badge in live preview (dove si scrive), SVG pieno solo in Reading View. Lo span CE=false sarebbe piccolo → non interferisce |

**Fonti**:
- [Chromium Stylus Handwriting README](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/stylus_handwriting/README.md)
- [ProseMirror Issue #565](https://github.com/ProseMirror/prosemirror/issues/565)
- Plugin Ink ha lo stesso problema irrisolto ([Issue #156](https://github.com/daledesilva/obsidian_ink/issues/156))

**Scoperte chiave consolidate**:
- `inputmode="none"` contamina l'intero WebView — MAI usare
- Empty SVG (300px) NON rompe handwriting; SVG con disegno (altezza > 300px per auto-expand) SÌ
- data-URI come `img.src` rompe handwriting → usare sempre URL vault + cache-bust
- Il problema è persistente tra sessioni (riavvio Obsidian) — non è corruzione di sessione temporanea
- Rimuovere completamente la nostra decorazione (nessun figlio nello span) non risolve — la causa è nell'SVG stesso o nella sua altezza

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
