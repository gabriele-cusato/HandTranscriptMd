/* =============================================
   DrawingEditorView — Editor in tab Obsidian
   Apre il canvas in una tab dedicata, fuori dal
   DOM di CodeMirror → nessun conflitto
   handwriting Android.
   ============================================= */

import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, Modal, App, MarkdownView, setIcon, ViewStateResult } from 'obsidian';
import type HandwritingPlugin from './main';
import { DrawingCanvas, Stroke } from './drawing-canvas';
import { strokesToSvg, parseSvgStrokes, svgToBase64Png, archiveSvgFile } from './svg-utils';
import { getEffectiveBgColor, getEffectiveLineColor, remapStrokeColor, LIGHT_COLORS, DARK_COLORS, resolveIsDark } from './settings';
import { getRecognizer } from './recognizer';
import { parseHandwritingToMarkdown } from './md-parser';
import { t, type I18nKey } from './i18n';

export const VIEW_TYPE_HANDWRITING = 'handwriting-editor';

/* =============================================
   Utilità condivise tra DrawingEditorView e DrawingModal
   ============================================= */

// Regex per trovare ![[svgPath]] nel file .md (nuovo formato wiki)
function wikiEmbedRegex(svgPath: string): RegExp {
	const esc = svgPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`\\n?!\\[\\[${esc}\\]\\]\\n?`);
}

// Regex per trovare il code block legacy con l'id specifico
function codeBlockRegex(embedId: string): RegExp {
	const esc = embedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp('\\n?```handwriting\\n.*?"id"\\s*:\\s*"' + esc + '".*?\\n```\\n?', 's');
}

// Applica una sostituzione sul file .md.
// Prova prima il formato wiki ![[svg]], poi il code block legacy come fallback.
async function replaceInMdFile(
	mdPath: string,
	svgPath: string,
	embedId: string,
	replacement: string,
	plugin: HandwritingPlugin
): Promise<void> {
	const mdFile = plugin.app.vault.getAbstractFileByPath(mdPath);
	if (!(mdFile instanceof TFile)) { new Notice(t('error_file_not_found')); return; }
	const content = await plugin.app.vault.read(mdFile);
	let updated = content.replace(wikiEmbedRegex(svgPath), replacement);
	if (updated === content) updated = content.replace(codeBlockRegex(embedId), replacement);
	if (updated !== content) await plugin.app.vault.modify(mdFile, updated);
}

// Carica i tratti da un file SVG nel vault. Restituisce anche le dimensioni del viewBox.
async function loadStrokesFromSvg(
	svgPath: string,
	plugin: HandwritingPlugin
): Promise<{ strokes: Stroke[]; canvasWidth: number | null; canvasHeight: number | null }> {
	const file = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (file instanceof TFile) {
		const content = await plugin.app.vault.read(file);
		const m = content.match(/viewBox="0 0 (\d+) (\d+)"/);
		return {
			strokes: parseSvgStrokes(content),
			canvasWidth:  m ? parseInt(m[1] ?? '0') : null,
			canvasHeight: m ? parseInt(m[2] ?? '0') : null,
		};
	}
	return { strokes: [], canvasWidth: null, canvasHeight: null };
}

// Salva il contenuto SVG del canvas su disco e aggiorna la preview inline.
async function saveSvgToDisk(
	canvas: DrawingCanvas,
	svgPath: string,
	embedId: string,
	plugin: HandwritingPlugin
): Promise<void> {
	const svg = strokesToSvg(
		canvas.getStrokes(), canvas.getWidth(), canvas.getHeight(),
		canvas.getBgColor(), canvas.getLineColor()
	);
	const folder = svgPath.substring(0, svgPath.lastIndexOf('/'));
	if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
		await plugin.app.vault.createFolder(folder);
	}
	const existing = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (existing instanceof TFile) {
		await plugin.app.vault.modify(existing, svg);
	} else {
		await plugin.app.vault.create(svgPath, svg);
	}
	plugin.refreshPreview(embedId, svg);
}

// Crea un bottone con icona Lucide via setIcon.
// Funzione standalone (non metodo) — usata da entrambe le classi editor.
function mkBtn(parent: HTMLElement, icon: string, key: I18nKey): HTMLElement {
	const label = t(key);
	const btn = parent.createEl('button', { cls: 'hwm_btn', attr: { title: label } });
	btn.setAttribute('data-hwm-key', key);
	// setIcon: inserisce l'SVG in modo sicuro (no innerHTML)
	setIcon(btn, icon);
	return btn;
}

/* =============================================
   buildEditorUI — Costruisce la toolbar e il canvas
   condivisi tra DrawingEditorView e DrawingModal.

   Accetta callback per i comportamenti specifici:
   - onClose: cosa fare quando si clicca X
   - afterCanvas: setup post-canvas (ResizeObserver su Android,
     requestAnimationFrame su Desktop)
   Restituisce { canvas, bgModeListener } per consentire
   alla classe chiamante di fare cleanup in onClose().
   ============================================= */
async function buildEditorUI(opts: {
	el: HTMLElement;
	plugin: HandwritingPlugin;
	svgPath: string;
	embedId: string;
	sourcePath: string;
	onClose: () => void | Promise<void>;
	afterCanvas: (canvas: DrawingCanvas, scrollWrap: HTMLElement, canvasWidth: number) => void;
	doSave: () => Promise<void>;
	doConvert: () => Promise<void>;
	doDelete: () => Promise<void>;
}): Promise<{ canvas: DrawingCanvas; bgModeListener: (bgMode: string) => void }> {
	const { el, plugin } = opts;
	const isMobile = Platform.isMobile;
	const isDark   = resolveIsDark(plugin.settings.bgMode);
	const bgColor  = getEffectiveBgColor(plugin.settings);
	const lineColor = getEffectiveLineColor(plugin.settings);
	// Sfondo via CSS var: background-color: var(--hwm-bg) in .hwm_editor-view
	el.setCssProps({ '--hwm-bg': bgColor });

	// --- Top bar: contiene la toolbar centrata e il bottone X ---
	const topbar = el.createDiv({ cls: 'hwm_editor-topbar hwm_editor-topbar--modal' });
	if (isDark) topbar.classList.add('hwm_editor-topbar--dark');

	const toolbar = topbar.createDiv({ cls: 'hwm_toolbar hwm_editor-toolbar' });
	if (isDark) toolbar.classList.add('hwm_toolbar--dark');

	// Penna / Gomma
	const penBtn    = mkBtn(toolbar, 'pencil', 'btn_pen');
	penBtn.classList.add('hwm_active', 'hwm_pen-btn');
	const eraserBtn = mkBtn(toolbar, 'eraser', 'btn_eraser');
	eraserBtn.classList.add('hwm_eraser-btn');
	toolbar.createDiv({ cls: 'hwm_separator' });

	// Palette colori — valori importati da settings.ts (unica fonte di verità)
	const colors = isDark ? [...DARK_COLORS] : [...LIGHT_COLORS];
	const colorWrap = toolbar.createDiv({ cls: 'hwm_colors' });
	const colorBtns: HTMLElement[] = [];
	for (const c of colors) {
		const btn = colorWrap.createEl('div', {
			cls: 'hwm_color-btn',
			attr: { title: c, role: 'button', tabindex: '0' }
		});
		// Colore via CSS var: background-color: var(--hwm-btn-color) in .hwm_color-btn
		// Le dimensioni forzate sono ora nel CSS con !important (no più stili inline)
		btn.setCssProps({ '--hwm-btn-color': c });
		if (c === colors[0]) btn.classList.add('hwm_active');
		colorBtns.push(btn);
	}
	toolbar.createDiv({ cls: 'hwm_separator' });

	// Undo / Redo / Clear
	const undoBtn  = mkBtn(toolbar, 'rotate-ccw', 'btn_undo');
	undoBtn.classList.add('hwm_undo-btn');
	const redoBtn  = mkBtn(toolbar, 'rotate-cw', 'btn_redo');
	redoBtn.classList.add('hwm_redo-btn');
	const clearBtn = mkBtn(toolbar, 'trash', 'btn_clear');
	clearBtn.classList.add('hwm_clear-btn');
	toolbar.createDiv({ cls: 'hwm_separator' });

	// Converti / Salva / Elimina
	const convertBtn = mkBtn(toolbar, 'file-text', 'btn_convert');
	convertBtn.classList.add('hwm_convert-btn');
	const saveBtn    = mkBtn(toolbar, 'save', 'btn_save');
	saveBtn.classList.add('hwm_save-btn');
	const deleteBtn  = mkBtn(toolbar, 'file-x', 'btn_delete');
	deleteBtn.classList.add('hwm_delete-btn');

	// Bottone chiudi (X): posizionato a destra via CSS absolute
	const closeBtn = mkBtn(topbar, 'x', 'btn_close');
	closeBtn.classList.add('hwm_close-btn');
	closeBtn.addEventListener('click', () => { void opts.onClose(); });

	// --- Scroll container e canvas ---
	const scrollWrap  = el.createDiv({ cls: 'hwm_editor-scroll' });
	const canvasWrap  = scrollWrap.createDiv({ cls: 'hwm_canvas-wrap' });

	// Carica i tratti dal file SVG
	const { strokes, canvasWidth: savedW, canvasHeight: savedH } = await loadStrokesFromSvg(opts.svgPath, plugin);
	const { canvasWidth, canvasHeight } = plugin.settings;
	// Usa le dimensioni salvate nel viewBox per preservare i tratti di sessioni precedenti più larghe
	const w = savedW ?? canvasWidth;
	const h = savedH ?? canvasHeight;
	const debugFn = plugin.settings.debugMode ? (msg: string) => new Notice(msg, 3000) : null;

	const canvas = new DrawingCanvas(canvasWrap, w, h, canvasHeight, isMobile, debugFn);
	canvas.setBackground(bgColor, lineColor);
	canvas.setColor(colors[0]!);
	// Su mobile: dito = scroll manuale del container, penna = disegno
	if (isMobile) canvas.allowFingerScroll(scrollWrap);

	// Carica i tratti con remapping colori al tema corrente
	if (strokes.length > 0) {
		const remapped = strokes.map(s => ({
			...s, color: remapStrokeColor(s.color, plugin.settings.bgMode)
		}));
		canvas.loadStrokes(remapped);
	}

	// Setup specifico della classe chiamante (ResizeObserver su Android, rAF su Desktop)
	opts.afterCanvas(canvas, scrollWrap, canvasWidth);

	// Resize handle (visibile ma non interattivo)
	// NOTA: handle è dichiarato dopo colorBtns ma catturato dal bgModeListener per closure:
	// la closure legge il valore corrente di 'handle' quando viene invocata (non quando è definita).
	let handle!: HTMLElement;
	handle = scrollWrap.createDiv({ cls: 'hwm_resize-handle hwm_resize-handle--disabled' });
	handle.createEl('span', { text: '⋯' });
	handle.classList.toggle('hwm_resize-handle--dark', isDark);

	// Listener bgMode: aggiorna toolbar, pallini colore e sfondo canvas al cambio tema.
	// Registrato da buildEditorUI e restituito alla classe per poterlo rimuovere in onClose().
	const bgModeListener = (bgMode: string) => {
		const dark = resolveIsDark(bgMode);
		topbar.classList.toggle('hwm_editor-topbar--dark', dark);
		toolbar.classList.toggle('hwm_toolbar--dark', dark);
		handle.classList.toggle('hwm_resize-handle--dark', dark);
		// Sfondo via CSS var (no stile inline)
		el.setCssProps({ '--hwm-bg': getEffectiveBgColor(plugin.settings) });
		// Aggiorna i pallini colore palette via CSS var
		const newColors = dark ? DARK_COLORS : LIGHT_COLORS;
		colorBtns.forEach((btn, i) => {
			btn.setCssProps({ '--hwm-btn-color': newColors[i] ?? '' });
			btn.setAttribute('title', newColors[i] ?? '');
		});
		// Aggiorna sfondo e righe nel canvas
		canvas.setBackground(
			getEffectiveBgColor(plugin.settings),
			getEffectiveLineColor(plugin.settings)
		);
	};
	plugin.bgModeListeners.add(bgModeListener);

	// Auto-scroll quando il canvas si espande, ma solo se non si sta disegnando.
	// Durante il disegno, lo scroll sposterebbe il canvas e le coordinate salterebbero.
	canvas.onResize(() => {
		if (!canvas.isPointerDown()) scrollWrap.scrollTop = scrollWrap.scrollHeight;
	});

	// --- Event handlers ---
	const cv = canvas;

	penBtn.addEventListener('click', () => {
		cv.setMode('pen');
		penBtn.classList.add('hwm_active');
		eraserBtn.classList.remove('hwm_active');
	});
	eraserBtn.addEventListener('click', () => {
		cv.setMode('eraser');
		eraserBtn.classList.add('hwm_active');
		penBtn.classList.remove('hwm_active');
	});
	for (let i = 0; i < colorBtns.length; i++) {
		colorBtns[i]!.addEventListener('click', () => {
			colorBtns.forEach(b => b.classList.remove('hwm_active'));
			colorBtns[i]!.classList.add('hwm_active');
			cv.setColor(colors[i]!);
		});
	}
	undoBtn.addEventListener('click', () => cv.undo());
	redoBtn.addEventListener('click', () => cv.redo());
	clearBtn.addEventListener('click', () => cv.clear());
	convertBtn.addEventListener('click', () => { void opts.doConvert(); });
	saveBtn.addEventListener('click', () => { void opts.doSave().then(() => new Notice(t('notice_saved'))); });
	deleteBtn.addEventListener('click', () => { void opts.doDelete(); });

	return { canvas, bgModeListener };
}

/* =============================================
   DrawingEditorView — Tab dedicata (Android)
   ============================================= */

export class DrawingEditorView extends ItemView {
	plugin: HandwritingPlugin;
	private canvas: DrawingCanvas | null = null;
	private embedId = '';
	private svgPath = '';
	private sourcePath = '';
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	// Listener per aggiornare la classe dark al cambio bgMode
	private bgModeListener: ((bgMode: string) => void) | null = null;
	// ResizeObserver per adattare il canvas al layout reale (inclusa rotazione schermo)
	private displayRo: ResizeObserver | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: HandwritingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE_HANDWRITING; }
	getDisplayText() { return 'Handwriting editor'; }
	getIcon() { return 'pencil'; }
	getEmbedId() { return this.embedId; }

	async setState(state: unknown, result: ViewStateResult) {
		// Cast a un tipo strutturato per accedere ai campi in modo type-safe
		const s = state as { id?: string; svg?: string; sourcePath?: string } | null;
		if (s?.id) this.embedId = s.id;
		if (s?.svg) this.svgPath = s.svg;
		if (s?.sourcePath) this.sourcePath = s.sourcePath;
		// Costruisci la UI solo quando abbiamo i dati
		if (this.embedId && this.svgPath) await this.buildEditor();
		await super.setState(state, result);
	}

	getState() {
		return { id: this.embedId, svg: this.svgPath, sourcePath: this.sourcePath };
	}

	async onOpen() { /* UI costruita in setState */ }

	async onClose() {
		if (this.canvas) {
			await this.saveSvg();
			this.canvas.destroy();
			this.canvas = null;
		}
		if (this.saveTimer) clearTimeout(this.saveTimer);
		// Deregistra il listener bgMode
		if (this.bgModeListener) {
			this.plugin.bgModeListeners.delete(this.bgModeListener);
			this.bgModeListener = null;
		}
		// Ferma l'osservatore di resize (orientamento schermo)
		this.displayRo?.disconnect();
		this.displayRo = null;
	}

	private async buildEditor() {
		const el = this.contentEl;
		el.empty();
		el.classList.add('hwm_editor-view');

		const { canvas, bgModeListener } = await buildEditorUI({
			el,
			plugin: this.plugin,
			svgPath: this.svgPath,
			embedId: this.embedId,
			sourcePath: this.sourcePath,
			// Chiude la tab dopo aver salvato
			onClose: async () => { await this.saveSvg(); this.leaf.detach(); },
			// Adatta il canvas alla larghezza reale e la mantiene sincronizzata
			// ad ogni cambio orientamento (portrait ↔ landscape).
			// expandWorld=false: la larghezza logica del mondo resta canvasWidth
			// → il viewBox dell'SVG salvato non cresce con la larghezza del tablet,
			//   evitando che la preview inline si accorci e mostri sfondo nero sotto.
			afterCanvas: (cv, scrollWrap) => {
				this.displayRo = new ResizeObserver(() => {
					const displayW = scrollWrap.clientWidth || el.clientWidth;
					if (displayW === 0) return;
					cv.setDisplayWidth(displayW, false);
				});
				this.displayRo.observe(scrollWrap);
				this.displayRo.observe(el);
			},
			doSave: () => this.saveSvg(),
			doConvert: () => this.doConvert(),
			doDelete: () => this.doDelete(),
		});

		this.canvas = canvas;
		this.bgModeListener = bgModeListener;

		// Auto-save debounced (2s dopo l'ultimo cambiamento)
		canvas.onChange(() => {
			if (this.saveTimer) clearTimeout(this.saveTimer);
			this.saveTimer = setTimeout(() => { void this.saveSvg(); }, 2000);
		});
	}

	private async saveSvg() {
		if (!this.canvas) return;
		await saveSvgToDisk(this.canvas, this.svgPath, this.embedId, this.plugin);
	}

	private async doConvert() {
		if (!this.canvas || this.canvas.getStrokes().length === 0) {
			new Notice(t('error_no_strokes')); return;
		}
		// Overlay a tutto schermo sull'editor: spinner + blocco interazione
		const overlay = this.contentEl.createDiv({ cls: 'hwm_confirm-overlay hwm_convert-overlay--editor' });
		overlay.createDiv({ cls: 'hwm_spinner' });
		try {
			const svg = strokesToSvg(this.canvas.getStrokes(), this.canvas.getWidth(),
				this.canvas.getHeight(), this.canvas.getBgColor(), this.canvas.getLineColor());
			const svgEl  = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGElement;
			const base64 = await svgToBase64Png(svgEl);
			const recognizer = getRecognizer(this.plugin.settings.geminiApiKey, this.plugin.settings.ocrLanguages);
			const rawText = await recognizer.recognize(base64);
			if (!rawText.trim()) throw new Error(t('error_no_text'));
			const markdown = parseHandwritingToMarkdown(rawText);
			await archiveSvgFile(this.svgPath, this.plugin);
			await replaceInMdFile(this.sourcePath, this.svgPath, this.embedId, '\n' + markdown + '\n', this.plugin);
			overlay.remove();
			this.canvas.destroy(); this.canvas = null;
			this.leaf.detach();
			new Notice(t('notice_converted'));
		} catch (e: unknown) {
			// Errore: sostituisce lo spinner con messaggio + OK
			overlay.empty();
			const msg = e instanceof Error ? e.message : String(e);
			overlay.createEl('p', { text: msg, cls: 'hwm_convert-error-msg' });
			const okBtn = overlay.createEl('button', { text: 'OK', cls: 'hwm_convert-ok-btn mod-warning' });
			okBtn.addEventListener('click', () => overlay.remove(), { once: true });
		}
	}

	// Overlay di conferma inline (come DrawingModal) — evita window.confirm() che
	// non funziona in Electron e ruba il focus dalla finestra principale.
	private showDeleteConfirm(): Promise<boolean> {
		return new Promise(resolve => {
			const overlay = this.contentEl.createDiv({ cls: 'hwm_confirm-overlay' });
			overlay.createEl('span', { text: t('confirm_delete'), cls: 'hwm_confirm-msg' });
			const okBtn     = overlay.createEl('button', { text: t('confirm_ok'), cls: 'mod-warning' });
			const cancelBtn = overlay.createEl('button', { text: t('confirm_cancel') });
			okBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
			cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });
			okBtn.focus();
		});
	}

	private async doDelete() {
		if (!await this.showDeleteConfirm()) return;
		if (this.canvas) { this.canvas.destroy(); this.canvas = null; }
		await replaceInMdFile(this.sourcePath, this.svgPath, this.embedId, '\n', this.plugin);
		const svgFile = this.plugin.app.vault.getAbstractFileByPath(this.svgPath);
		if (svgFile instanceof TFile) await this.plugin.app.vault.delete(svgFile);
		this.leaf.detach();
		new Notice(t('notice_deleted'));
	}
}

/* =============================================
   DrawingModal — Editor disegno come Modal overlay.
   Aperto tramite bottone portale (document.body)
   per evitare tap su widget CM6.
   ============================================= */

export class DrawingModal extends Modal {
	private plugin: HandwritingPlugin;
	private embedId: string;
	private svgPath: string;
	private sourcePath: string;
	private canvas: DrawingCanvas | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	// Listener per aggiornare la classe dark al cambio bgMode
	private bgModeListener: ((bgMode: string) => void) | null = null;
	// Callback invocato alla chiusura del modal (usato per nascondere/mostrare il bottone matita)
	onClosed?: () => void;

	constructor(app: App, plugin: HandwritingPlugin, embedId: string, svgPath: string, sourcePath: string) {
		super(app);
		this.plugin = plugin;
		this.embedId = embedId;
		this.svgPath = svgPath;
		this.sourcePath = sourcePath;
		this.modalEl.addClass('hwm_modal');
	}

	async onOpen() {
		this.contentEl.addClass('hwm_editor-view');
		await this.buildEditor();
	}

	async onClose() {
		if (this.canvas) {
			await this.saveSvg();
			this.canvas.destroy();
			this.canvas = null;
		}
		if (this.saveTimer) clearTimeout(this.saveTimer);
		// Deregistra il listener bgMode
		if (this.bgModeListener) {
			this.plugin.bgModeListeners.delete(this.bgModeListener);
			this.bgModeListener = null;
		}
		// Notifica il chiamante che il modal è stato chiuso
		this.onClosed?.();
	}

	private async buildEditor() {
		const el = this.contentEl;

		const { canvas, bgModeListener } = await buildEditorUI({
			el,
			plugin: this.plugin,
			svgPath: this.svgPath,
			embedId: this.embedId,
			sourcePath: this.sourcePath,
			// Chiude il modal (Obsidian gestisce il cleanup via onClose)
			onClose: () => this.close(),
			// Espande il canvas a tutta la larghezza del modal eliminando le bande laterali.
			// requestAnimationFrame garantisce che il layout del modal sia pronto prima di misurarlo.
			afterCanvas: (cv, scrollWrap, canvasWidth) => {
				requestAnimationFrame(() => {
					const displayW = scrollWrap.clientWidth;
					if (displayW > canvasWidth) cv.setDisplayWidth(displayW);
				});
			},
			doSave: () => this.saveSvg(),
			doConvert: () => this.doConvert(),
			doDelete: () => this.doDelete(),
		});

		this.canvas = canvas;
		this.bgModeListener = bgModeListener;

		// Auto-save debounced (2s dopo l'ultimo cambiamento)
		canvas.onChange(() => {
			if (this.saveTimer) clearTimeout(this.saveTimer);
			this.saveTimer = setTimeout(() => { void this.saveSvg(); }, 2000);
		});
	}

	private async saveSvg() {
		if (!this.canvas) return;
		await saveSvgToDisk(this.canvas, this.svgPath, this.embedId, this.plugin);
	}

	private async doConvert() {
		if (!this.canvas || this.canvas.getStrokes().length === 0) { new Notice(t('error_no_strokes')); return; }
		// Overlay a tutto schermo sul modal: spinner + blocco interazione
		const overlay = this.contentEl.createDiv({ cls: 'hwm_confirm-overlay hwm_convert-overlay--editor' });
		overlay.createDiv({ cls: 'hwm_spinner' });
		try {
			const svg = strokesToSvg(this.canvas.getStrokes(), this.canvas.getWidth(), this.canvas.getHeight(),
				this.canvas.getBgColor(), this.canvas.getLineColor());
			const svgEl  = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGElement;
			const base64 = await svgToBase64Png(svgEl);
			const recognizer = getRecognizer(this.plugin.settings.geminiApiKey, this.plugin.settings.ocrLanguages);
			const rawText = await recognizer.recognize(base64);
			if (!rawText.trim()) throw new Error(t('error_no_text'));
			const markdown = parseHandwritingToMarkdown(rawText);
			await archiveSvgFile(this.svgPath, this.plugin);
			await replaceInMdFile(this.sourcePath, this.svgPath, this.embedId, '\n' + markdown + '\n', this.plugin);
			overlay.remove();
			this.canvas.destroy(); this.canvas = null;
			this.close();
			new Notice(t('notice_converted'));
		} catch (e: unknown) {
			// Errore: sostituisce lo spinner con messaggio + OK
			overlay.empty();
			const msg = e instanceof Error ? e.message : String(e);
			overlay.createEl('p', { text: msg, cls: 'hwm_convert-error-msg' });
			const okBtn = overlay.createEl('button', { text: 'OK', cls: 'hwm_convert-ok-btn mod-warning' });
			okBtn.addEventListener('click', () => overlay.remove(), { once: true });
		}
	}

	// Overlay di conferma inline: nessun Modal annidato → nessun furto di focus
	private showDeleteConfirm(): Promise<boolean> {
		return new Promise(resolve => {
			const overlay = this.contentEl.createDiv({ cls: 'hwm_confirm-overlay' });
			overlay.createEl('span', { text: t('confirm_delete'), cls: 'hwm_confirm-msg' });
			const okBtn = overlay.createEl('button', { text: t('confirm_ok'), cls: 'mod-warning' });
			const cancelBtn = overlay.createEl('button', { text: t('confirm_cancel') });
			okBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
			cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });
			okBtn.focus();
		});
	}

	private async doDelete() {
		if (!await this.showDeleteConfirm()) return;
		if (this.canvas) { this.canvas.destroy(); this.canvas = null; }

		const srcPath = this.sourcePath;
		const ws = this.app.workspace;
		let focusDone = false;

		// Funzione di focus: aspetta 300ms dopo che vault.modify ha sparato,
		// in modo da dare all'editor il tempo di completare il re-render del documento.
		const doFocus = () => {
			if (focusDone) return;
			focusDone = true;
			setTimeout(() => {
				let mdView = ws.getActiveViewOfType(MarkdownView);
				if (!mdView || mdView.file?.path !== srcPath) {
					const leaf = ws.getLeavesOfType('markdown')
						.find(l => (l.view as MarkdownView).file?.path === srcPath);
					if (leaf) ws.setActiveLeaf(leaf, { focus: true });
					mdView = ws.getActiveViewOfType(MarkdownView);
				}
				// Focus diretto sul contenteditable CM6
				const cm = mdView?.contentEl.querySelector<HTMLElement>('.cm-content');
				cm?.focus();
			}, 300);
		};

		// Registra il listener PRIMA di modificare il file, così non perdiamo l'evento.
		const ref = this.app.vault.on('modify', (file) => {
			if (file.path === srcPath) {
				this.app.vault.offref(ref);
				doFocus();
			}
		});

		await replaceInMdFile(srcPath, this.svgPath, this.embedId, '\n', this.plugin);
		const svgFile = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (svgFile instanceof TFile) await this.app.vault.delete(svgFile);

		// Fallback: se vault.modify non spara entro 3s (caso anomalo), forza comunque il focus
		setTimeout(() => { this.app.vault.offref(ref); doFocus(); }, 3000);

		this.close();
		new Notice(t('notice_deleted'));
	}
}
