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

## Stato attuale — Fase 2 COMPLETATA, Fase 3 IN CORSO (fix Android handwriting)

### File del plugin (`HandTranscriptMd/src/`)

| File | Cosa fa |
|------|---------|
| `main.ts` | Entry point: registra embed, comando "Insert handwriting block", ribbon icon, settings |
| `settings.ts` | Impostazioni: cartella SVG, dimensioni canvas, sfondo, lingue OCR, chiave API Gemini (campo password) |
| `drawing-canvas.ts` | Motore disegno Canvas API: Bézier quadratiche, penna, gomma parziale, undo/redo history-based, auto-expand, righe foglio |
| `svg-utils.ts` | Conversione tratti ↔ SVG (dati riedit in `<desc>` JSON), righe e sfondo inclusi nell'SVG |
| `embed.ts` | Code block processor, toolbar, bottone Converti collegato (OCR → markdown → sostituisce code block), `svgToBase64Png()` helper |
| `recognizer.ts` | `IRecognizer` interface + `GeminiRecognizer`: invia PNG base64 a Gemini API, restituisce testo |
| `md-parser.ts` | `parseMarkdown()`: post-processa testo OCR riga per riga applicando sintassi markdown |

### Funzionalità implementate

- **Canvas inline** nel markdown via code block `handwriting`
- **Disegno diretto** — click sul blocco = disegno immediato (no click "Edit")
- **Curve smooth** — Bézier quadratiche con tecnica midpoint
- **Gomma parziale** — cancella solo i punti toccati, taglia i tratti in segmenti
- **Undo/Redo** — basato su history di stati (funziona sia per disegno che per gomma)
- **Auto-expand** — il canvas si espande con animazione smooth (requestAnimationFrame, ease-out cubico)
- **Resize manuale** — handle trascinabile in basso
- **Clear → reset** alla dimensione di default con animazione
- **Righe orizzontali** — foglio a righe (32px), sia nel canvas che nell'SVG
- **Temi sfondo** — chiaro/scuro/custom con color picker nelle impostazioni
- **Remapping colori automatico** — i tratti si adattano al cambio tema (nero↔bianco, blu↔azzurro, ecc.)
- **Toolbar completa** — penna, gomma, 4 colori, undo, redo, clear, converti, salva, elimina (X)
- **Elimina riquadro** — bottone X rimuove code block dal .md e cancella SVG
- **Auto-save** — salvataggio debounced 2s dopo l'ultima modifica
- **SVG standard** — file `.svg` nella cartella `_handwriting/`, visibili da qualsiasi dispositivo
- **Palette colori adattiva** — colori scuri su sfondo chiaro, colori chiari su sfondo scuro
- **Resize handle tematizzato** — si adatta al tema scuro
- **OCR via Gemini** — bottone Converti: SVG → PNG base64 → Gemini 3.1 Flash Lite → testo → `md-parser` → sostituisce code block nel `.md`
- **Archiviazione SVG** — dopo la conversione, il file SVG viene spostato in `_handwriting/_converted/AAAA-MM-GG_HH-MM-SS.svg`
- **Settings OCR** — chiave API Gemini (campo password) + lingue OCR configurabili (default: `it, en`)
- **Supporto Android** — comportamenti differenziati tra Windows e Android:
  - Toolbar compatta su mobile (▼/▲ toggle), espansa su Windows
  - Icone SVG inline (mappa `ICONS` in `embed.ts`) — identiche su Windows e Android, nessuna dipendenza da `setIcon`/Lucide bundled — **RISOLTO**
  - Disegno solo con penna (`pointerType === 'pen'`), dito ignorato su mobile per il disegno
  - Focus fix multi-livello: `inputmode="none"` + listener `beforeinput` in capture phase + blur `.cm-editor` + `canvas.focus()` su pointerdown penna
  - Cerchi colori: bottoni colore sono `<div>` (non `<button>`) + dimensioni forzate via `style.setProperty(..., 'important')` — **RISOLTO**

### Embedding nel markdown

````markdown
```handwriting
{"id":"hw_abc123","svg":"_handwriting/hw_abc123.svg"}
```
````

### Deploy

```bash
# Sorgente plugin
cd C:/Projects/pluginObsidian/handWrittenMarkdownConverter/HandTranscriptMd

# Build + deploy al vault locale (solo PC)
node esbuild.config.mjs production && bash deploy.sh

# Build + deploy su Google Drive (per testare su tablet Android)
node esbuild.config.mjs production && bash cloudDeploy.sh

# Vault locale di test
C:/Projects/CLIENTI/IOTTI/IOTTI_APP/_docs/handwriting-to-markdown/
# Plugin installato in .obsidian/plugins/handwriting-to-markdown/

# Vault Google Drive (sincronizzato con tablet)
C:/Users/gabri/Il mio Drive (gabrielecusato@gmail.com)/Projects/handwriting-to-markdown/
```

### Come sviluppare

```bash
# Dev mode (watch)
npm run dev
# Dopo ogni modifica per testare su PC:
bash deploy.sh
# Dopo ogni modifica per testare su tablet Android:
bash cloudDeploy.sh
# In Obsidian: Ctrl+P → "Reload app without saving"
```

---

## Note architetturali — Fase 2 (sessione corrente)

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

## Prossimi passi — Da fare nella prossima sessione

1. **Migliorare il riconoscimento dei caratteri speciali markdown** — `src/recognizer.ts` + `src/md-parser.ts`:
   - Il testo normale viene riconosciuto correttamente da Gemini
   - Il problema riguarda solo i **simboli markdown**: `#`, `-`, `>`, `**`, `==`, ecc. non vengono riconosciuti/applicati correttamente
   - Migliorare il prompt con few-shot examples espliciti per i simboli (es. "Se vedi `# Titolo` → scrivi `# Titolo`")
   - Valutare se `md-parser.ts` può coprire i casi che il prompt non gestisce

2. **Fix handwriting Android — IN CORSO (15+ tentativi)**:

   ### Problema fondamentale
   Il canvas vive dentro `cm-content[contenteditable="true"]` (l'editor CodeMirror di Obsidian). Android/Chrome attiva lo stylus handwriting-to-text a **livello nativo** quando il pennino tocca dentro/vicino (40dp) a un elemento `contenteditable`. Questo avviene **prima** di qualsiasi evento JavaScript.

   ### Perché è sempre "tutto o niente"
   `cm-content` è un UNICO elemento `contenteditable="true"`. Qualsiasi modifica all'editabilità di un figlio contamina lo stato dell'intero editor.

   ### Tentativi falliti e scoperte chiave

   | # | Approccio | Risultato | Perché non funziona |
   |---|-----------|-----------|---------------------|
   | 1-8 | `touch-action: none` su `.cm-editor`/`.cm-scroller`/`.cm-content` | Handwriting resta attivo | `touch-action` controlla scroll/zoom, NON l'handwriting |
   | 9 | `contenteditable="false"` + `handwriting="false"` sul **container** (figlio di cm-content) | Handwriting morto ovunque | Chrome tratta l'intero cm-content come blocco; un figlio false rompe tutto |
   | 10 | CSS `-webkit-user-modify: read-only` sul container | Handwriting morto ovunque | Stesso problema: figlio dentro cm-content |
   | 11 | `blur()` + `focus(canvas)` su `pointerenter pen` | Handwriting resta attivo | Rilevamento basato su **prossimità** al contenteditable, non sul focus |
   | 12 | `touchstart` + `preventDefault()` + `touch-action: none` | Handwriting resta attivo | Chrome decide prima degli eventi JS |
   | 13 | **Lock Button** — `contenteditable="false"` sul **container** (sbagliato) | Handwriting non si blocca | Il container è dentro cm-content → sbagliato mirare al container |
   | 14 | **Iframe** — canvas dentro `<iframe>` con `document.write` | Iframe creato (confermato da debug), handwriting resta attivo | Android's handwriting detection lavora a livello WebView (un'unica View Android), vede attraverso gli iframe |
   | 15 | **Overlay fullscreen** — pannello `position:fixed` su `document.body` + `cm-content.contenteditable="false"` mentre overlay è aperto | **PARZIALMENTE TESTATO** — handwriting ancora attivo su vecchi documenti, non testato su documento nuovo | Da verificare: testare su documento nuovo appena creato; possibile che vecchi documenti abbiano stato residuo |

   ### Scoperta critica: `inputmode="none"` contamina il WebView
   Bug confermato ([Flutter #176913](https://github.com/flutter/flutter/issues/176913)): dare focus a un elemento con `inputmode="none"` disabilita l'handwriting per l'INTERO WebView, effetto persiste fino al riavvio. **MAI usare `inputmode="none"` nel plugin.**

   ### Anche il plugin Ink ha lo stesso problema
   [Issue #156](https://github.com/daledesilva/obsidian_ink/issues/156): "Writing just puts a dot and doesn't follow pen on Android" — stessa causa, nessuna soluzione trovata.

   ### Approccio attuale (tentativo 15) — DA TESTARE MEGLIO
   Overlay quasi-fullscreen che si apre al tap sul riquadro:
   - `document.body.appendChild(overlay)` → fuori da cm-content
   - Quando overlay apre → `cm-content.setAttribute('contenteditable', 'false')`
   - Quando overlay chiude → ripristina `contenteditable="true"`
   - Backdrop semitrasparente con `backdrop-filter: blur(6px)`
   - Pannello con margini 12px, bordi arrotondati, ombra
   - Bottone ← in alto a sinistra, tool a destra
   - File: `src/embed.ts` → `showMobilePreview()`, `openFullscreenEditor()`

   ### Miglioramenti overlay ancora da fare
   - **Bordi più spessi/visibili** sul pannello (attualmente `box-shadow` sottile)
   - **Scroll interno** quando l'altezza del canvas supera quella dello schermo
   - **Verificare handwriting** su documento NUOVO (non su documenti già aperti che potrebbero avere stato residuo)
   - **Verificare causa** se handwriting ancora attivo: potrebbe essere che `cm-content.contenteditable="false"` non è sufficiente da solo, oppure che il timing è sbagliato

3. **Auto-expand — animazione scattosa** — **BUG APERTO** (parzialmente risolto):
   - Fix precedente: aggiunto guard `if (this.animFrameId !== null) return` in `checkAutoExpand()` per evitare restart multipli → il loop up/down è risolto
   - Problema residuo: l'espansione avviene in modo scattoso invece di animarsi fluidamente
   - Effetto collaterale: quando il canvas si espande oltre il viewport, la pagina scrolla bruscamente verso il basso
   - File coinvolto: `src/drawing-canvas.ts` → `animateHeight()` e `checkAutoExpand()`

4. **Toolbar unificata Windows/Android** — **DA FARE**:
   - Attualmente la toolbar su Windows è sempre espansa e quella su Android è compatta con toggle ▼/▲
   - Obiettivo: unico codice toolbar condiviso — compatta di default su entrambe le piattaforme
   - File coinvolti: `src/embed.ts` + `styles.css`

### Problemi risolti in passato
- **Toolbar — tema scuro** ✅
- **Spazio vuoto sezione colori in toolbar compatta** ✅
- **Trashcan non cancella visualmente** ✅

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
