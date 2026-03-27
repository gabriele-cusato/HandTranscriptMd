# Handwriting to Markdown — Obsidian Plugin

Convert handwritten notes (drawn with a stylus on a canvas) into structured Markdown, directly inside Obsidian. Works on both Windows (desktop) and Android (mobile with stylus).

---

## Table of Contents

1. [User Guide](#user-guide)
2. [Project Structure & Architecture](#project-structure--architecture)
3. [Maintainability Cheat Sheet](#maintainability-cheat-sheet)

---

## User Guide

### What the Plugin Does

This plugin embeds a **handwriting canvas** inside any `.md` file. You draw or write with a stylus (or mouse), and the plugin can:

- **Save the drawing** as an SVG file in your vault — visible as an image even without the plugin installed
- **Convert the handwriting to Markdown** using Google Gemini OCR, replacing the drawing block with structured text (headings, lists, tables, etc.)

The SVG embed is standard Obsidian wiki syntax (`![[_handwriting/hw_xxx.svg]]`), so the image appears in any Obsidian view and is readable by tools like Claude Code.

---

### Inserting a Handwriting Block

1. Open a Markdown file.
2. Click the **pencil ribbon icon** in the left sidebar (or run the command `Insert handwriting block` via `Ctrl+P`).
3. A new block `![[_handwriting/hw_xxx.svg]]` is inserted at the cursor position.
4. A **portal panel** (toolbar overlay) appears on the image. Click the **pencil button** (✏️) to open the drawing editor.

---

### The Drawing Editor

The editor opens differently depending on your platform:

| Platform | How it opens |
|----------|-------------|
| **Windows (desktop)** | Full-screen overlay modal on top of your document |
| **Android (mobile)** | A new Obsidian tab |

#### Toolbar Buttons

| Button | Action |
|--------|--------|
| **Pen** | Switch to drawing mode (stylus or mouse draws strokes) |
| **Eraser** | Switch to eraser mode (drag to erase strokes under the pointer) |
| **Color dots** (4) | Select the current drawing color |
| **Undo** | Undo last stroke or erase action |
| **Redo** | Redo last undone action |
| **Clear** | Remove all strokes and reset canvas to default size |
| **Convert** | Run OCR and replace the drawing block with Markdown text |
| **Save** | Save the current drawing as SVG and update the preview |
| **Delete** (🗑️) | Delete the handwriting block and its SVG file |
| **Close / ←** | Close the editor (Windows: close modal; Android: go back) |

#### Drawing Tips

- **Stylus draws, finger scrolls** — on Android, a finger touch scrolls the canvas; the stylus draws. No conflict.
- **Canvas auto-expands** — as you draw near the bottom edge, the canvas grows automatically.
- **Horizontal lines** — the canvas shows ruled lines (like a notebook) as a visual guide; they appear in the saved SVG too.
- **Colors adapt to theme** — strokes drawn in black on a light theme are automatically remapped to white when you switch to dark theme (and vice versa).

---

### Portal Panel (Inline Controls)

When you hover over a handwriting image in your document, a small floating panel appears with four buttons:

| Button | Action |
|--------|--------|
| ✏️ | Open drawing editor |
| 📄 | Convert drawing to Markdown (OCR) directly from the preview |
| ↕️ | Collapse / expand the image preview |
| ✕ | Delete the block and its SVG file |

---

### OCR Conversion to Markdown

The plugin uses **Google Gemini** to recognize handwritten text and converts it to Markdown based on special keywords you write in the drawing.

#### Supported Keywords

Write these keywords in your drawing to produce structured Markdown output. All keywords start with `//` and are **case-insensitive** (`//list` = `//LIST`). The colon after the keyword name is **optional** (`//H1 Title` and `//H1: Title` both work).

| Keyword | Syntax | Output |
|---------|--------|--------|
| `//H1` | `//H1 My Title` | `# My Title` |
| `//H2` | `//H2 Section` | `## Section` |
| `//H3` | `//H3 Sub` | `### Sub` |
| `//H4` | `//H4 Sub` | `#### Sub` |
| `//LIST` | `//LIST item1, item2, item3` | bullet list |
| `//NUMLIST` | `//NUMLIST item1, item2` | numbered list (starts at 1) |
| `//NUMLIST` (offset) | `//NUMLIST 3 item1, item2` | numbered list starting at 3 |
| `//CHECK` | `//CHECK task1, task2` | checklist (all unchecked) |
| `//CHECK` (mixed) | `//CHECK x done, pending, x also done` | checklist with checked/unchecked items |
| `//QUOTE` | `//QUOTE Text` | `> Text` |
| `//NOTE` | `//NOTE Title` | Obsidian callout `[!NOTE]` |
| `//WARN` | `//WARN Title` | Obsidian callout `[!WARNING]` |
| `//TIP` | `//TIP Title` | Obsidian callout `[!TIP]` |
| `//INFO` | `//INFO Title` | Obsidian callout `[!INFO]` |
| `//ERROR` | `//ERROR Title` | Obsidian callout `[!ERROR]` |
| `//IMPORTANT` | `//IMPORTANT Title` | Obsidian callout `[!IMPORTANT]` |
| `//CODE` | `//CODE snippet` | `` `snippet` `` (inline code) |
| `//CODEBLOCK` | `//CODEBLOCK js` + lines + blank line | fenced code block |
| `//B` / `//BOLD` | `//BOLD text` | `**text**` |
| `//I` | `//I text` | `*text*` |
| `//BI` | `//BI text` | `***text***` |
| `//S` / `//STRIKE` | `//S text` | `~~text~~` |
| `//HL` | `//HL text` | `==text==` (highlight) |
| `//LINK` | `//LINK label, url` | `[label](url)` |
| `//IMG` | `//IMG alt, url` | `![alt](url)` |
| `//TABLE` | `//TABLE Col1, Col2` + rows + `//TABLE` | Markdown table |
| `//HR` / `//SEP` | `//HR` | `---` |
| `//FN` | `//FN footnote text` | `[^1]: footnote text` (auto-numbered) |
| `//MATH` | `//MATH x^2` | `$x^2$` (inline math) |
| `//MATHBLOCK` | `//MATHBLOCK` + lines + blank line | `$$...$$` math block |
| `//TAG` | `//TAG my tag` | `#my_tag` |
| `//DATE` | `//DATE` | today's date (YYYY-MM-DD) |
| `//TIME` | `//TIME` | current time (HH:MM) |
| `//DATETIME` | `//DATETIME` | date + time |
| `//INDENT` | `//INDENT text` | text indented by 2 spaces |

Plain text lines (without a `//` keyword) are inserted as-is.

---

#### Multi-line Continuation

Any keyword that accepts a comma-separated list (`//LIST`, `//NUMLIST`, `//CHECK`, `//TABLE` rows) supports **wrapping across lines**: if a line ends with a comma, the next line is automatically treated as a continuation.

```
//LIST groceries, milk, bread,
butter, eggs
```
Output:
```markdown
- groceries
- milk
- bread
- butter
- eggs
```

---

#### CHECK with Mixed States

Prefix any item with `x` or `X` (with or without brackets) to mark it as already checked:

```
//CHECK x bought milk, prepare slides, x sent email, review PR
```
Output:
```markdown
- [x] bought milk
- [ ] prepare slides
- [x] sent email
- [ ] review PR
```

---

#### Multi-line Callouts

The text on the keyword line becomes the callout **title**. Any lines that follow (up to the first blank line or next `//` keyword) become the callout **body**:

```
//NOTE Database connection
The connection may fail on an unstable network.
Always verify the timeout in the settings.

Normal paragraph — outside the callout.
```
Output:
```markdown
> [!NOTE] Database connection
> The connection may fail on an unstable network.
> Always verify the timeout in the settings.

Normal paragraph — outside the callout.
```

---

After conversion, the SVG is archived to `_handwriting/_converted/YYYY-MM-DD_HH-MM-SS.svg` and the drawing block is replaced with the generated Markdown.

---

### Settings

Open **Settings → Handwriting to Markdown** to configure:

| Setting | Description |
|---------|-------------|
| **Interface language** | Language for the settings UI. "Auto" follows Obsidian's language. |
| **SVG folder** | Vault subfolder where SVG drawing files are saved (default: `_handwriting`) |
| **Canvas width / height** | Default canvas resolution in pixels |
| **Canvas background** | Light / Dark / Auto (follows Obsidian theme) |
| **Gemini API key** | Required for OCR. Get it free at [aistudio.google.com](https://aistudio.google.com). |
| **OCR languages** | Comma-separated BCP-47 codes (e.g. `it, en, fr`). Tells Gemini which languages to expect. |

> **Note — Free API key limitations:** With the free tier of Google AI Studio, your data may be used by Google to improve their models. Additionally, under high traffic you may see a **"Too many requests — please try again later"** error. To avoid rate limits, enable billing on [Google AI Studio](https://aistudio.google.com); costs are minimal for occasional OCR use.

---

### Platform Support

| Feature | Windows | Android |
|---------|---------|---------|
| Drawing (stylus/mouse) | ✅ | ✅ |
| Finger scroll while drawing | — | ✅ |
| OCR conversion | ✅ | ✅ |
| Editor opens as modal | ✅ | — |
| Editor opens as new tab | — | ✅ |
| Collapse/expand preview | ✅ | ✅ |

---

## Project Structure & Architecture

This section explains how the codebase is organized, how Obsidian's plugin system works, and which file to open for any given task.

---

### Folder & File Layout

```
HandTranscriptMd/
│
├── src/                        ← all TypeScript source files
│   ├── main.ts                 ← plugin entry point (class HandwritingPlugin)
│   ├── settings.ts             ← settings definition, defaults, settings tab UI
│   ├── i18n.ts                 ← translation loader and t() helper
│   ├── locales/                ← one JSON file per language
│   │   ├── en.json             ← English (the fallback — always the reference)
│   │   ├── it.json
│   │   ├── de.json  fr.json  es.json  ru.json  ja.json
│   │   ├── zh-cn.json  pt-br.json  pl.json
│   ├── drawing-canvas.ts       ← HTML Canvas drawing engine (strokes, eraser, undo)
│   ├── svg-utils.ts            ← SVG ↔ strokes serialization, PNG conversion, archive
│   ├── embed.ts                ← inline preview decoration + portal panel
│   ├── editor-view.ts          ← drawing editor (modal on Windows, tab on Android)
│   ├── recognizer.ts           ← Gemini OCR interface + HTTP call
│   ├── md-parser.ts            ← keyword-based OCR text → Markdown converter
│   └── parser.test.ts          ← unit tests for the markdown parser
│
├── main.js                     ← ⚠ compiled output (generated by esbuild, do not edit)
├── styles.css                  ← all plugin CSS (classes prefixed with hwm_)
├── manifest.json               ← plugin metadata (id, name, version, minAppVersion)
├── package.json                ← npm dependencies, build scripts
├── esbuild.config.mjs          ← build configuration (entry: src/main.ts → main.js)
├── deploy.sh                   ← copies main.js + manifest.json + styles.css to local vault
├── cloudDeploy.sh              ← same but to Google Drive vault (for Android testing)
├── README.md                   ← this file
├── CLAUDE.md                   ← context notes for Claude Code AI assistant
└── NOTES.md                    ← developer session log, resolved bugs, completed tasks
```

The three files that Obsidian loads are: **`main.js`**, **`manifest.json`**, **`styles.css`**. Everything under `src/` is TypeScript source that gets compiled down to the single `main.js` by esbuild.

---

### How an Obsidian Plugin Works

Obsidian plugins are JavaScript modules that run inside the Obsidian Electron app (desktop) or WebView (mobile). The key concepts:

#### 1. The Plugin Class (`src/main.ts`)

Every plugin exports a default class that extends Obsidian's `Plugin`. Obsidian calls **`onload()`** when the plugin is enabled and **`onunload()`** when it is disabled.

```typescript
export default class HandwritingPlugin extends Plugin {
    async onload() { /* register everything here */ }
}
```

Inside `onload()` this plugin registers:
- **A view type** (`registerView`) — the drawing editor tab on Android
- **A code block processor** (`registerMarkdownCodeBlockProcessor`) — renders `handwriting` code blocks
- **Commands** (`addCommand`) — appear in `Ctrl+P` palette
- **A ribbon icon** (`addRibbonIcon`) — the pencil button in the left sidebar
- **A settings tab** (`addSettingTab`)
- **Event listeners** (`registerEvent`) — e.g. the right-click file menu

The plugin class also carries three **shared state maps** used to coordinate between the preview (embed.ts) and the editor (editor-view.ts):
- `previewCallbacks` — after a save, the editor calls `refreshPreview()` to update the inline image
- `embedPaths` — maps embed IDs to SVG file paths, used for color remapping on theme change
- `bgModeListeners` — `Set` of callbacks notified when the background mode setting changes
- `embedActions` — maps embed IDs to their expand/collapse/convert functions, used by the right-click menu

#### 2. The Vault API

The **Vault** is Obsidian's file system abstraction. Use `this.app.vault` (or `plugin.app.vault`) to read/write files:

```typescript
// Read a file as text
const content = await plugin.app.vault.read(tFile);

// Write / overwrite a file
await plugin.app.vault.modify(tFile, newContent);

// Create a file
await plugin.app.vault.create(path, content);

// Move / rename
await plugin.app.vault.rename(tFile, newPath);
```

A `TFile` is Obsidian's object for a file. Get one with:
```typescript
const file = plugin.app.vault.getAbstractFileByPath('folder/name.md');
```

#### 3. The Workspace API

The **Workspace** manages the layout of open tabs and panels. Used to open the editor tab on Android:

```typescript
const leaf = plugin.app.workspace.getLeaf('tab'); // open in a new tab
await leaf.setViewState({ type: VIEW_TYPE_HANDWRITING, state: { ... } });
```

#### 4. ItemView — The Drawing Editor Tab (`src/editor-view.ts`)

`DrawingEditorView extends ItemView` is an Obsidian **custom view** — a full tab with its own DOM. Key lifecycle methods:
- `getViewType()` — returns a unique string ID (`'handwriting-editor'`)
- `getDisplayText()` — the tab title
- `onOpen()` — called when the tab opens; here `buildEditor()` is called to build the canvas UI
- `onClose()` — called when the tab closes; cleanup (remove listeners, disconnect observers)

The view receives data (which SVG to load, which MD file to update) via `leaf.setViewState({ state: { svgPath, sourcePath, embedId } })`, read back in `getState()`.

#### 5. Modal — The Desktop Drawing Overlay (`src/editor-view.ts`)

`DrawingModal extends Modal` is an Obsidian **modal dialog** — a fullscreen overlay on desktop. Key methods:
- `onOpen()` — builds the canvas UI by calling `buildEditor()`
- `onClose()` — cleanup
- `this.close()` — closes the modal programmatically (used in the ← and ✕ buttons)

`Modal` and `ItemView` are completely different Obsidian base classes, which is why `buildEditorUI()` was extracted as a shared standalone function — both classes call it and pass their specific callbacks for save/close/delete.

#### 6. Code Block Processor (Legacy Format)

`registerMarkdownCodeBlockProcessor('handwriting', callback)` tells Obsidian: "when you render a ` ```handwriting ``` ` block, run my callback instead." The callback receives the block source text and the DOM element to fill. This is the legacy embed format.

#### 7. MutationObserver (Wiki Format)

For the new `![[svg]]` format, Obsidian renders the embed itself as a `<span class="internal-embed image-embed">`. The plugin cannot intercept this with a code block processor. Instead, a **MutationObserver** watches `document.body` for new nodes and decorates any span whose `src` attribute points to the `_handwriting/` folder. This happens in `registerEmbed()` in `embed.ts`.

#### 8. Settings (`src/settings.ts`)

Settings are stored as a JSON object in Obsidian's `data.json` (inside the plugin folder). `plugin.loadData()` reads it; `plugin.saveData(obj)` writes it. The `HandwritingSettings` interface defines the shape; `DEFAULT_SETTINGS` provides initial values. `HandwritingSettingTab extends PluginSettingTab` builds the settings UI using `new Setting(containerEl)`.

#### 9. The Build System

esbuild bundles all TypeScript files starting from `src/main.ts` into a single `main.js`. The `obsidian` package is marked **external** — it is provided at runtime by Obsidian itself and must never be bundled. esbuild does **not** run TypeScript type-checking — type errors are invisible at build time. To catch them: `npx tsc --noEmit`.

Two build modes:
- `npm run dev` → watch mode, inline sourcemap, not minified
- `node esbuild.config.mjs production` → single build, minified, no sourcemap

---

### What File to Open for a Given Task

| I want to… | Open this file |
|-----------|---------------|
| Change what happens when the plugin loads/unloads | `src/main.ts` → `onload()` / `onunload()` |
| Add or remove a command (`Ctrl+P`) | `src/main.ts` → `this.addCommand(...)` |
| Add or remove the ribbon icon | `src/main.ts` → `this.addRibbonIcon(...)` |
| Add an item to the right-click file menu | `src/main.ts` → `this.app.workspace.on('file-menu', ...)` |
| Change a setting (add field, change default, add UI control) | `src/settings.ts` → `HandwritingSettings`, `DEFAULT_SETTINGS`, `HandwritingSettingTab.display()` |
| Change the color palette for light/dark theme | `src/settings.ts` → `LIGHT_COLORS`, `DARK_COLORS` |
| Change how "is dark mode" is resolved | `src/settings.ts` → `resolveIsDark()` |
| Add or fix a translation string | `src/locales/en.json` first, then all other locale files |
| Add a new interface language | `src/locales/XX.json` + `src/i18n.ts` → `locales` map + `localeNames` |
| Change how the `t()` lookup or fallback works | `src/i18n.ts` |
| Change drawing behavior (stroke, eraser, pressure, auto-expand) | `src/drawing-canvas.ts` → `DrawingCanvas` class |
| Change the ruler line spacing | `src/drawing-canvas.ts` → `export const LINE_SPACING` |
| Change how strokes are saved into / read from SVG | `src/svg-utils.ts` → `strokesToSvg()`, `svgToStrokes()` |
| Change how the SVG is converted to a PNG for OCR | `src/svg-utils.ts` → `svgToBase64Png()` |
| Change where archived SVGs go after conversion | `src/svg-utils.ts` → `archiveSvgFile()` |
| Change how the inline image preview is decorated | `src/embed.ts` → `tryDecorate()`, `decorateWikiEmbed()` |
| Add or change buttons in the portal panel overlay | `src/embed.ts` → `createPortalPanel()` |
| Change the OCR pipeline (what happens when "Convert" is clicked from the preview) | `src/embed.ts` → `runOcrPipeline()` |
| Change the drawing editor toolbar or canvas layout | `src/editor-view.ts` → `buildEditorUI()` |
| Change behavior specific to the desktop modal only | `src/editor-view.ts` → `DrawingModal` class |
| Change behavior specific to the Android tab only | `src/editor-view.ts` → `DrawingEditorView` class |
| Change the save / delete / convert logic inside the editor | `src/editor-view.ts` → `DrawingModal.doSave/doConvert/doDelete` or `DrawingEditorView.doSave/doConvert/doDelete` |
| Change which OCR model is called or the prompt sent to Gemini | `src/recognizer.ts` → `GeminiRecognizer.recognize()` |
| Change how OCR text is parsed into Markdown keywords | `src/md-parser.ts` → `parseHandwritingToMarkdown()`, `expandKeywords()` |
| Change how `//TABLE` blocks are parsed | `src/md-parser.ts` → table handling logic inside `parseHandwritingToMarkdown()` |
| Change plugin CSS (colors, sizes, layout) | `styles.css` |
| Change the plugin version | `manifest.json` + `package.json` (both must match) |
| Change the build configuration | `esbuild.config.mjs` |
| Change the deploy target path (local vault) | `deploy.sh` → `VAULT_PLUGIN` variable |
| Change the deploy target path (Google Drive / Android) | `cloudDeploy.sh` → `VAULT_PLUGIN` variable |

---

### Data Flow: From Drawing to Saved SVG

```
User draws strokes on <canvas>
        │
        ▼
DrawingCanvas (drawing-canvas.ts)
  stores strokes as Stroke[] array in memory
        │
        ▼  (on Save button or auto-save debounce)
saveSvgToDisk()  ─── editor-view.ts (module-level helper)
        │
        ▼
strokesToSvg()  ─── svg-utils.ts
  builds an SVG string:
  - <path> elements for each Bézier stroke
  - <line> elements for ruler lines
  - <desc class="hwm-strokes"> with JSON of all strokes (for re-editing)
        │
        ▼
plugin.app.vault.modify(tFile, svgString)
  saves the .svg file to the vault
        │
        ▼
plugin.refreshPreview(embedId, svgString)
  calls the previewCallback registered by embed.ts
        │
        ▼
embed.ts updates img.src with a cache-busting ?t=timestamp
  so the inline preview refreshes without reloading the page
```

---

### Data Flow: From Drawing to Markdown (OCR)

```
User clicks Convert (in editor toolbar or portal panel)
        │
        ▼
runOcrPipeline() / doConvert()
        │
        ├─ reads SVG content from vault
        ├─ parses SVG to DOM via DOMParser
        │
        ▼
svgToBase64Png()  ─── svg-utils.ts
  draws SVG onto a temporary <canvas>
  exports as base64 PNG via canvas.toDataURL()
        │
        ▼
GeminiRecognizer.recognize(base64)  ─── recognizer.ts
  POST to Gemini REST API with inline_data (image) + text prompt
  returns recognized text as a plain string
        │
        ▼
parseHandwritingToMarkdown(text)  ─── md-parser.ts
  splits text into lines
  maps //keywords → Markdown syntax
  returns final Markdown string
        │
        ▼
replaceInMdFile()  ─── editor-view.ts (module-level helper)
  reads the .md source file
  finds the ![[svg]] embed line via regex
  replaces it with the Markdown text
  writes the .md file back to vault
        │
        ▼
archiveSvgFile()  ─── svg-utils.ts
  moves the .svg from _handwriting/ to _handwriting/_converted/YYYY-MM-DD_HH-MM-SS.svg
```

---

### CSS Class Naming Convention

All plugin CSS classes use the `hwm_` prefix (short for **H**and**W**riting **M**arkdown) to avoid collisions with Obsidian's own classes or other plugins.

Examples: `hwm_portal-panel`, `hwm_portal-btn`, `hwm_modal`, `hwm_toolbar`, `hwm-badge-mode`.

All styles live in **`styles.css`** at the project root. There is no CSS-in-JS.

---

## Maintainability Cheat Sheet

This section is a quick reference for developers who need to extend or modify the plugin. Assumes familiarity with TypeScript and the Obsidian Plugin API.

---

### How to Add a Toolbar Button

The entire toolbar for both the desktop modal and the Android tab is built by the shared function `buildEditorUI()` in `src/editor-view.ts`. You only need to edit **one place**.

1. **Add the i18n key** (see [How to Add a Language Key](#how-to-add-a-language-key)).
2. Inside `buildEditorUI()`, find the toolbar section and call `mkBtn(toolbar, 'icon-name', 'your_i18n_key')`.
   - `mkBtn` returns the button element if you need to attach a click handler.
3. Add the click handler immediately after: `btn.addEventListener('click', () => { ... })`.

`mkBtn(parent, icon, key)` is a module-level helper that creates a `<button>` with the Obsidian icon and the localized `title` attribute.

> **Why one place?** Before the refactor, `DrawingEditorView.buildEditor()` and `DrawingModal.buildEditor()` were two separate copies. The `buildEditorUI()` function eliminates that duplication.

---

### How to Add a Portal Panel Button

The portal panel (the floating overlay on the preview image) is built in `src/embed.ts` inside `createPortalPanel()`.

1. Add the i18n key.
2. Create a button element: `const btn = panel.createEl('button', { cls: 'hwm_portal-btn' })`.
3. Set its icon: `setIcon(btn, 'icon-name')` and tooltip: `btn.title = t('your_key', plugin)`.
4. Add the click handler.

---

### How to Add an Obsidian Command (Shortcut)

Commands are registered in `src/main.ts` inside `onload()`, using `this.addCommand({...})`.

```typescript
this.addCommand({
  id: 'your-command-id',
  name: 'Human readable name',   // shown in Ctrl+P palette
  callback: () => { /* your logic */ },
  // optional: hotkeys: [{ modifiers: ['Ctrl'], key: 'K' }]
});
```

Obsidian users can reassign hotkeys in **Settings → Hotkeys**.

---

### How to Add a Ribbon Icon

Ribbon icons are registered in `src/main.ts` inside `onload()`.

```typescript
this.addRibbonIcon('icon-name', 'Tooltip text', (evt) => {
  /* your logic */
});
```

Find icon names in the [Obsidian Lucide icon set](https://lucide.dev/icons/).

---

### How to Add a Language Key (i18n)

The plugin has a simple i18n system. Locale files live in `src/locales/`.

1. Add the new key to **every** locale file (`en.json`, `it.json`, `de.json`, `fr.json`, `es.json`, `ru.json`, `ja.json`, `zh-cn.json`, `pt-br.json`, `pl.json`).
   Always start with `en.json` (the fallback language).
2. Use the `t('your_key', plugin)` helper wherever you need the translated string.

The `t()` function falls back to `en.json` if the key is missing in the active locale.

---

### How to Add a New Language

1. Create `src/locales/XX.json` (where `XX` is the BCP-47 code, e.g. `ko` for Korean).
2. Copy all keys from `en.json` and translate the values.
3. In `src/settings.ts`, add the language to the `UI_LANGUAGES` array:
   ```typescript
   { code: 'ko', label: '한국어' }
   ```
4. In `src/settings.ts`, update the dynamic `import()` switch inside the `loadLocale()` function (or equivalent loader) to handle the new code.

---

### How to Add a Setting

Settings are defined in `src/settings.ts`.

1. Add the new field to the `HandwritingSettings` interface and to `DEFAULT_SETTINGS`.
2. In `HandwritingSettingTab.display()`, add a `new Setting(containerEl)` block with `.setName(t(...))`, `.setDesc(t(...))`, and the appropriate control (`.addText()`, `.addToggle()`, `.addDropdown()`, etc.).
3. Save the value in the control's `onChange` callback: `this.plugin.settings.yourField = value; await this.plugin.saveSettings();`.

---

### How to Add an OCR Keyword

Keywords are parsed in `src/md-parser.ts` and documented in `src/settings.ts`.

**Rule: both files must be updated together. They must stay in sync.**

1. **`src/md-parser.ts`** — in `expandKeywords()`, add a new `case` (or `if/else`) for the new `//KEYWORD`. Return the corresponding Markdown string.
2. **`src/settings.ts`** — in the `KEYWORDS` constant (displayed in the settings table), add a new row:
   ```typescript
   { keyword: '//KEYWORD', syntax: '//KEYWORD text', output: 'markdown output' }
   ```

---

### How to Update the Plugin Version

The version is declared in two files that must be kept in sync:

- `package.json` → `"version"` field
- `manifest.json` → `"version"` field

The settings page reads the version from `plugin.manifest.version` at runtime, so no code changes are needed in TypeScript.

---

### How to Add a Third Embed Format

Currently the plugin supports two embed formats:
- **Wiki** (new default): `![[_handwriting/hw_xxx.svg]]`
- **Legacy code block**: `` ```handwriting {"id":"...", "svg":"..."}``` ``

To add a third format:

1. **Registration** — in `src/main.ts` → `onload()`, register a new processor (e.g. `this.registerMarkdownCodeBlockProcessor('new-format', ...)` or a new `MutationObserver` pattern).
2. **Detection** — in `src/embed.ts`, the `tryDecorate()` function checks for the wiki format. Add detection logic for your new format alongside it.
3. **Read/Write** — in `src/editor-view.ts`, the module-level helpers `wikiEmbedRegex()` / `codeBlockRegex()` and `replaceInMdFile()` handle finding and replacing the embed text in the `.md` file. Add a new regex + replacement branch for the new format. The `doSave`, `doConvert`, and `doDelete` callbacks passed to `buildEditorUI()` call these helpers — update them to try the new format as well.
4. **Backward compat** — always try the new format first, then fall back to wiki, then legacy code block (follow the existing fallback pattern in `replaceInMdFile`).

---

### Key File Map

| File | Responsibility |
|------|---------------|
| `src/main.ts` | Plugin entry point: commands, ribbon, embed registration, settings, MutationObserver |
| `src/settings.ts` | Settings interface, defaults, tab UI, i18n loader, `LIGHT_COLORS`, `DARK_COLORS`, `resolveIsDark()` |
| `src/drawing-canvas.ts` | Canvas drawing engine: Bézier strokes, eraser, undo/redo, auto-expand, `LINE_SPACING` |
| `src/svg-utils.ts` | SVG ↔ strokes serialization, `svgToBase64Png()`, `archiveSvgFile()` |
| `src/embed.ts` | Preview decoration (wiki + legacy), portal panel, OCR pipeline runner |
| `src/editor-view.ts` | `buildEditorUI()` shared builder, `DrawingEditorView` (Android tab), `DrawingModal` (desktop) |
| `src/recognizer.ts` | `IRecognizer` interface + `GeminiRecognizer` (REST call to Gemini) |
| `src/md-parser.ts` | `parseHandwritingToMarkdown()`: keyword expansion, OCR text → Markdown |
| `src/locales/*.json` | Locale strings for each supported language |
