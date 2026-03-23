# Note storiche — Handwriting Plugin

Questo file contiene lo storico delle sessioni di sviluppo, bug risolti, tentativi falliti e ricerche effettuate.
Per istruzioni, architettura e task aperti vedi `CLAUDE.md`.

---

## ✅ Task completati (sessione 2026-03-23)

### Tema automatico (bgMode 'auto')
Rinominato 'custom' → 'auto' nel dropdown settings. `MutationObserver` su `document.body` in `main.ts` chiama `notifyBgModeChange()` al cambio di `theme-dark`. Aggiunta `resolveIsDark(bgMode)` in `editor-view.ts` ed `embed.ts` per risolvere 'auto' al tema Obsidian effettivo. Migrazione automatica 'custom'→'auto' in `loadSettings()`. Rimosso `bgCustomColor` e color picker dalle settings.

### Angoli arrotondati
Usato `var(--radius-m)` / `var(--radius-l)` su tutti gli elementi (toolbar, bottoni, pannello portale, modal, container). `border-radius` applicato sull'`<img>` inline invece che sullo span (no `overflow:hidden` sullo span, che clippava l'SVG). Aggiunto `border: 1.5px solid var(--background-modifier-border)` e `box-shadow` al riquadro inline per visibilità contro lo sfondo Obsidian.

### Rimosso switch "Modalità handwriting Android"
Badge mode sempre attiva su `Platform.isMobile`, preview piena sempre su desktop. Rimossi `hwmHandwritingMode` da `HandwritingSettings`, `DEFAULT_SETTINGS`, settings tab, `registerEmbed()` e `tryDecorate()` in `embed.ts`. Le classi CSS `hwm-handwriting-mode` e `hwm-badge-mode` rimangono ma vengono applicate automaticamente.

### Fix toolbar pannello portale al cambio tema
Sostituita classe generica `hwm_toolbar--dark` con `hwm_portal-panel--dark` dedicata. `resolveIsDark` inline in `createPortalPanel` gestisce 'auto', 'light' e 'dark'. `hwm_resize-handle--dark` sostituisce gli inline styles sull'handle del canvas.

---

---

## ✅ TEST EFFETTUATI (sessione 2026-03-22)

### Bug 1 — Pannello portale parzialmente visibile con Modal aperto — RISOLTO ✅

**Sintomo**: su Windows, cliccando il bottone matita, i bottoni "Converti" e "Comprimi" del pannello portale restavano visibili sopra il modal mentre il bottone matita scompariva correttamente.
**Causa**: il RAF loop nascondeva solo il bottone matita (`btn.style.display`) ma non l'intero pannello.
**Fix**: il RAF loop ora setta `panel.style.display = 'none'` quando `modalOpen || tabOpen`, nascondendo l'intero pannello portale (tutti e 4 i bottoni).
**File**: `src/embed.ts` — RAF loop in `decorateSpan()`.

---

### Bug 2 — Canvas modal troppo largo, toolbar non centrata — RISOLTO ✅

**Sintomo**: nel Modal Windows, il canvas occupava tutta la larghezza dell'overlay (troppo largo e non centrato). La toolbar era allineata a sinistra invece che al centro.
**Fix CSS** (`styles.css`):
- `.hwm_canvas-wrap { display: flex; justify-content: center; }` — centra il canvas orizzontalmente
- `.hwm_canvas { max-width: 100%; }` — rimosso `width: 100%` fisso
- `.hwm_editor-topbar--modal { justify-content: center; }` — centra la toolbar nel modal
**Fix TS** (`editor-view.ts`): `DrawingModal.buildEditor()` aggiunge classe `hwm_editor-topbar--modal` alla topbar.

---

### Bug 3 — Auto-scroll sposta i tratti durante il disegno — RISOLTO ✅

**Sintomo**: quando il canvas si espandeva automaticamente (auto-expand) mentre stavo disegnando, lo scroll automatico verso il basso spostava i punti del tratto corrente rispetto alla posizione del pennino.
**Causa**: l'evento `onResize` faceva scroll immediatamente anche con il pointer premuto, spostando il canvas mentre le coordinate del puntatore erano ancora relative alla posizione pre-scroll.
**Fix**: aggiunto metodo pubblico `isPointerDown(): boolean` in `DrawingCanvas` (`drawing-canvas.ts`). Sia `DrawingEditorView` che `DrawingModal` in `editor-view.ts` ora controllano `!canvas.isPointerDown()` prima di eseguire il `scrollTop` automatico.

---

### Bug 4 — Badge mode mostra icona in riquadro piccolissimo — RISOLTO ✅

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

---

## ✅ TEST EFFETTUATI (sessione 2026-03-23)

### Bug 5 — Pannello portale visibile nelle impostazioni e ovunque — RISOLTO ✅

**Sintomo**: il pannello portale (`position: fixed` in `document.body`) rimaneva visibile in alto a destra anche navigando nelle impostazioni, in altre schede, ecc.
**Causa**: il pannello era appeso a `document.body` e il RAF loop di posizionamento lo seguiva solo quando lo span era nel viewport.
**Fix**: pannello spostato come figlio diretto dello span contenitore con `position: absolute; top: 6px; right: 6px`. Lo span ha `position: relative`. Il pannello è ora parte del DOM del documento e scompare naturalmente quando si naviga altrove.
**File**: `src/embed.ts` — `createPortalPanel()` + `styles.css`.

---

### Bug 6 — Comprimi/Espandi modificava anche la larghezza — RISOLTO ✅

**Sintomo**: cliccando il bottone freccia per comprimere/espandere il riquadro, anche la larghezza cambiava (l'immagine si restringeva).
**Causa**: il codice precedente usava `max-height` sull'elemento `<img>`, che lo scalava proporzionalmente.
**Fix**: la compressione ora modifica `container.style.height` + `overflow: hidden` sullo span contenitore. L'immagine viene clippata verticalmente senza alterarne la larghezza.
**File**: `src/embed.ts` — handler del bottone collapse in `createPortalPanel()`.

---

### Bug 7 — Pannello portale rimane nel DOM dopo disabilitazione plugin — RISOLTO ✅

**Sintomo**: disabilitando il plugin, i pannelli portale (bottoni) rimanevano visibili nel documento.
**Fix**: `plugin.register(() => panel.remove())` — Obsidian chiama tutti i callback registrati con `plugin.register()` quando il plugin viene disabilitato.
**File**: `src/embed.ts` — `createPortalPanel()`.

---

### Bug 8 — Bottoni pannello portale non cliccabili — RISOLTO ✅

**Sintomo**: dopo lo spostamento del pannello dentro lo span, i bottoni non rispondevano al click.
**Causa**: lo span aveva `pointer-events: none` (impostato in `tryDecorate()` per handwriting Android). Il pannello figlio ereditava la proprietà.
**Fix**: `pointer-events: auto` in CSS su `.hwm_portal-panel` — ripristina i click solo sul pannello, lasciando il resto dello span non interattivo.
**File**: `styles.css`.

---

### Bug 9 — Palette colori SVG non aggiornata al cambio bgMode — RISOLTO ✅

**Sintomo**: cambiando bgMode nelle impostazioni, gli SVG nei documenti aperti mantenevano i vecchi colori dei tratti finché non si ricaricava il plugin.
**Fix**: aggiunto listener `onBgModeRemap` in `registerEmbed()` registrato in `plugin.bgModeListeners`. Quando il bgMode cambia:
1. Itera `plugin.embedPaths` (mappa `embedId → svgPath`)
2. Legge il file SVG dal vault e verifica il marker `hwm-strokes` (ignora SVG non del plugin)
3. Parsa `viewBox="0 0 W H"` per ottenere le dimensioni reali (non quelle di default, che perderebbero l'auto-expand)
4. Rimappa i colori dei tratti con `remapStrokeColor()`, rigenera l'SVG con `strokesToSvg()`, salva
5. Chiama `plugin.refreshPreview(embedId, newContent)` → aggiorna `img.src` con cache-bust
**File**: `src/embed.ts` — `onBgModeRemap` in `registerEmbed()`.

---

### Bug 10 — Toolbar editor non aggiornata al cambio bgMode — RISOLTO ✅

**Sintomo**: i bottoni della toolbar nel `DrawingModal` (Windows) e nel `DrawingEditorView` (Android) non cambiavano colore al cambio bgMode.
**Causa 1 (live update)**: mancava un listener. Aggiunto `bgModeListener` in entrambe le classi, registrato in `bgModeListeners` dopo la costruzione di `colorBtns` (per poterli aggiornare nel closure). Rimosso in `onClose()`.
**Causa 2 (riapertura)**: il cambio bgMode avviene sempre con editor chiuso. `buildEditor()` viene chiamato di nuovo alla riapertura e legge `plugin.settings.bgMode` → corretto per costruzione. Il problema visivo era CSS.
**Causa 3 (CSS)**: Obsidian dark theme ha regole tipo `.modal-content button { background: var(...) }` con specificità `0,1,1` > `0,1,0` di `.hwm_btn`, sovrascrivendo il nostro sfondo trasparente. Il colore del topbar senza `!important` veniva sovrascritto analogamente.
**Fix CSS** (`styles.css`):
- `.hwm_editor-topbar { background: rgba(240,240,240,0.95) !important }` e `.hwm_editor-topbar--dark { background: rgba(40,40,40,0.97) !important }` — entrambe con `!important` (la `--dark` appare dopo → vince in dark mode per cascade order)
- `.hwm_editor-topbar .hwm_btn { background: transparent !important; color: #333 !important }` — batte la specificità di Obsidian
- `.hwm_editor-topbar--dark .hwm_btn { color: #bbb !important }` — appare dopo → vince in dark mode
- Hover e active espliciti con `!important` per entrambe le modalità
**Nota importante**: il cambio bgMode viene SEMPRE effettuato con editor chiuso (il modal copre l'intera finestra). Il listener live è presente ma non è il percorso principale.
**File**: `src/editor-view.ts` + `styles.css`.

---

## Problemi risolti (storico completo)

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
- **Pannello portale visibile nelle impostazioni (Bug 5)** ✅ — pannello spostato da `document.body` (position:fixed) a figlio diretto dello span (position:absolute); eliminati RAF loop e scroll listener
- **Comprimi/Espandi modificava larghezza (Bug 6)** ✅ — usa `container.style.height + overflow:hidden` invece di `max-height` sull'img
- **Pannello resta dopo disabilitazione plugin (Bug 7)** ✅ — `plugin.register(() => panel.remove())`
- **Bottoni pannello non cliccabili (Bug 8)** ✅ — `pointer-events: auto` su `.hwm_portal-panel` in CSS
- **SVG non aggiornati al cambio bgMode (Bug 9)** ✅ — listener `onBgModeRemap` in `bgModeListeners`; legge viewBox per dimensioni reali, rimappa colori, salva SVG, refresh preview
- **Toolbar editor non aggiornata al cambio bgMode (Bug 10)** ✅ — `bgModeListener` in `DrawingEditorView` e `DrawingModal`; CSS `!important` su topbar e bottoni per battere specificità Obsidian dark theme

---

## BUG APERTO — Handwriting disabilitato nel documento quando il riquadro è presente

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
