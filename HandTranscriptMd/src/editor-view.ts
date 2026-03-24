/* =============================================
   DrawingEditorView — Editor in tab Obsidian
   Apre il canvas in una tab dedicata, fuori dal
   DOM di CodeMirror → nessun conflitto
   handwriting Android.
   ============================================= */

import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, Modal, App, MarkdownView } from 'obsidian';
import type HandwritingPlugin from './main';
import { DrawingCanvas, Stroke } from './drawing-canvas';
import { strokesToSvg, parseSvgStrokes } from './svg-utils';
import { getEffectiveBgColor, getEffectiveLineColor, remapStrokeColor } from './settings';
import { getRecognizer } from './recognizer';
import { parseMarkdown } from './md-parser';
import { t } from './i18n';

export const VIEW_TYPE_HANDWRITING = 'handwriting-editor';

// Risolve se il tema è scuro tenendo conto di 'auto' (legge la classe Obsidian sul body)
function resolveIsDark(bgMode: string): boolean {
	if (bgMode === 'auto') return document.body.classList.contains('theme-dark');
	return bgMode === 'dark';
}

// Icone SVG inline (stile Lucide 24×24)
const ICONS: Record<string, string> = {
	'pencil':      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
	'eraser':      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`,
	'rotate-ccw':  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
	'rotate-cw':   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,
	'trash':       `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
	'file-text':   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
	'save':        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>`,
	'x':           `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
	'file-x':      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9.5" y1="12.5" x2="14.5" y2="17.5"/><line x1="14.5" y1="12.5" x2="9.5" y2="17.5"/></svg>`,
	'chevron-down':`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
	'chevron-up':  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
	'arrow-left':  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
};

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
	getDisplayText() { return 'Handwriting Editor'; }
	getIcon() { return 'pencil'; }
	getEmbedId() { return this.embedId; }

	async setState(state: any, result: any) {
		if (state?.id) this.embedId = state.id;
		if (state?.svg) this.svgPath = state.svg;
		if (state?.sourcePath) this.sourcePath = state.sourcePath;
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

	/* ---------- Costruisce la UI dell'editor ---------- */

	private async buildEditor() {
		const el = this.contentEl;
		el.empty();
		el.classList.add('hwm_editor-view');

		const isMobile = Platform.isMobile;
		const isDark = resolveIsDark(this.plugin.settings.bgMode);
		const bgColor = getEffectiveBgColor(this.plugin.settings);
		const lineColor = getEffectiveLineColor(this.plugin.settings);
		el.style.backgroundColor = bgColor;

		// --- Top bar: toolbar centrata ---
		const topbar = el.createDiv({ cls: 'hwm_editor-topbar hwm_editor-topbar--modal' });
		if (isDark) topbar.classList.add('hwm_editor-topbar--dark');

		// Toolbar centrata nel topbar
		const toolbar = topbar.createDiv({ cls: 'hwm_toolbar hwm_editor-toolbar' });
		if (isDark) toolbar.classList.add('hwm_toolbar--dark');

		// Penna / Gomma
		const penBtn = this.mkBtn(toolbar, 'pencil', 'btn_pen');
		penBtn.classList.add('hwm_active', 'hwm_pen-btn');
		const eraserBtn = this.mkBtn(toolbar, 'eraser', 'btn_eraser');
		eraserBtn.classList.add('hwm_eraser-btn');
		toolbar.createDiv({ cls: 'hwm_separator' });

		// Colori
		const colors = isDark
			? ['#ffffff', '#60a5fa', '#f87171', '#4ade80']
			: ['#000000', '#1e40af', '#dc2626', '#16a34a'];
		const colorWrap = toolbar.createDiv({ cls: 'hwm_colors' });
		const colorBtns: HTMLElement[] = [];
		for (const c of colors) {
			const btn = colorWrap.createEl('div', {
				cls: 'hwm_color-btn',
				attr: { title: c, role: 'button', tabindex: '0' }
			});
			btn.style.backgroundColor = c;
			// Dimensioni forzate (bypass stili Obsidian Mobile)
			for (const [k, v] of Object.entries({
				width: '22px', height: '22px', 'min-width': '22px',
				'min-height': '22px', 'border-radius': '50%',
				'box-sizing': 'border-box', 'flex-shrink': '0'
			})) btn.style.setProperty(k, v, 'important');
			if (c === colors[0]) btn.classList.add('hwm_active');
			colorBtns.push(btn);
		}
		toolbar.createDiv({ cls: 'hwm_separator' });

		// Listener bgMode: aggiorna toolbar, pallini colore e sfondo canvas al cambio tema.
		// Deve stare DOPO la dichiarazione di colorBtns per poterli aggiornare nel closure.
		const lightColors = ['#000000', '#1e40af', '#dc2626', '#16a34a'];
		const darkColors  = ['#ffffff', '#60a5fa', '#f87171', '#4ade80'];
		this.bgModeListener = (bgMode: string) => {
			const dark = resolveIsDark(bgMode);
			topbar.classList.toggle('hwm_editor-topbar--dark', dark);
			toolbar.classList.toggle('hwm_toolbar--dark', dark);
			handle.classList.toggle('hwm_resize-handle--dark', dark);
			el.style.backgroundColor = getEffectiveBgColor(this.plugin.settings);
			// Aggiorna i pallini colore palette (backgroundColor inline con !important)
			const newColors = dark ? darkColors : lightColors;
			colorBtns.forEach((btn, i) => {
				btn.style.backgroundColor = newColors[i] ?? '';
				btn.setAttribute('title', newColors[i] ?? '');
			});
			// Aggiorna sfondo e righe nel canvas
			if (this.canvas) {
				this.canvas.setBackground(
					getEffectiveBgColor(this.plugin.settings),
					getEffectiveLineColor(this.plugin.settings)
				);
			}
		};
		this.plugin.bgModeListeners.add(this.bgModeListener);

		// Undo / Redo / Clear
		const undoBtn = this.mkBtn(toolbar, 'rotate-ccw', 'btn_undo');
		undoBtn.classList.add('hwm_undo-btn');
		const redoBtn = this.mkBtn(toolbar, 'rotate-cw', 'btn_redo');
		redoBtn.classList.add('hwm_redo-btn');
		const clearBtn = this.mkBtn(toolbar, 'trash', 'btn_clear');
		clearBtn.classList.add('hwm_clear-btn');
		toolbar.createDiv({ cls: 'hwm_separator' });

		// Converti / Salva / Elimina
		const convertBtn = this.mkBtn(toolbar, 'file-text', 'btn_convert');
		convertBtn.classList.add('hwm_convert-btn');
		const saveBtn = this.mkBtn(toolbar, 'save', 'btn_save');
		saveBtn.classList.add('hwm_save-btn');
		const deleteBtn = this.mkBtn(toolbar, 'file-x', 'btn_delete');
		deleteBtn.classList.add('hwm_delete-btn');

		// Bottone chiudi (X): nel topbar, posizionata a destra via CSS absolute
		const closeBtn = this.mkBtn(topbar, 'x', 'btn_close');
		closeBtn.classList.add('hwm_close-btn');
		closeBtn.addEventListener('click', async () => {
			await this.saveSvg();
			this.leaf.detach();
		});

		// --- Scroll container ---
		const scrollWrap = el.createDiv({ cls: 'hwm_editor-scroll' });
		const canvasWrap = scrollWrap.createDiv({ cls: 'hwm_canvas-wrap' });

		// Carica tratti dal file SVG
		const { strokes, canvasWidth: savedW, canvasHeight: savedH } = await this.loadStrokes();
		const { canvasWidth, canvasHeight } = this.plugin.settings;
		// Usa la larghezza salvata nel viewBox SVG come worldWidth iniziale: garantisce che
		// setDisplayWidth() non tagli i tratti disegnati in sessioni precedenti più larghe.
		const w = savedW ?? canvasWidth;
		const h = savedH ?? canvasHeight;
		const debugFn = this.plugin.settings.debugMode
			? (msg: string) => new Notice(msg, 3000) : null;

		// Crea il canvas
		this.canvas = new DrawingCanvas(canvasWrap, w, h, canvasHeight, isMobile, debugFn);
		this.canvas.setBackground(bgColor, lineColor);
		this.canvas.setColor(colors[0]!);
		// Su mobile: dito = scroll, penna = disegno
		// Su mobile: dito = scroll manuale del container, penna = disegno
		if (isMobile) this.canvas.allowFingerScroll(scrollWrap);

		// Carica tratti con remapping colori
		if (strokes.length > 0) {
			const remapped = strokes.map(s => ({
				...s, color: remapStrokeColor(s.color, this.plugin.settings.bgMode)
			}));
			this.canvas.loadStrokes(remapped);
		}

		// Adatta il canvas alla larghezza reale del container e la mantiene sincronizzata
		// ad ogni cambio di orientamento (portrait ↔ landscape).
		// L'observer resta attivo per tutta la vita della tab; viene rimosso in onClose().
		// Se clientWidth è ancora 0 (tab non renderizzata), salta e riprova al prossimo evento.
		this.displayRo = new ResizeObserver(() => {
			const displayW = scrollWrap.clientWidth || el.clientWidth;
			if (displayW === 0) return;
			this.canvas?.setDisplayWidth(displayW);
		});
		this.displayRo.observe(scrollWrap);
		this.displayRo.observe(el);

		// Resize handle (visibile ma non interattivo)
		const handle = scrollWrap.createDiv({ cls: 'hwm_resize-handle hwm_resize-handle--disabled' });
		handle.createEl('span', { text: '⋯' });
		handle.classList.toggle('hwm_resize-handle--dark', isDark);

		// Auto-scroll quando il canvas si espande, ma solo se non si sta disegnando.
		// Durante il disegno, lo scroll sposterebbe il canvas nel viewport e le
		// coordinate del tratto salterebbero (getBoundingClientRect cambia).
		this.canvas.onResize(() => {
			if (!this.canvas?.isPointerDown()) scrollWrap.scrollTop = scrollWrap.scrollHeight;
		});

		// --- Event handlers ---
		const cv = this.canvas;

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
				if (isMobile) updateColorSizes(toolbar.classList.contains('hwm_toolbar--compact'));
			});
		}
		undoBtn.addEventListener('click', () => cv.undo());
		redoBtn.addEventListener('click', () => cv.redo());
		clearBtn.addEventListener('click', () => cv.clear());

		convertBtn.addEventListener('click', () => this.doConvert());
		saveBtn.addEventListener('click', async () => { await this.saveSvg(); new Notice('Salvato'); });
		deleteBtn.addEventListener('click', () => this.doDelete());

		// Auto-save debounced (2s dopo ultimo cambiamento)
		cv.onChange(() => {
			if (this.saveTimer) clearTimeout(this.saveTimer);
			this.saveTimer = setTimeout(() => this.saveSvg(), 2000);
		});

		// Bottone ← → salva e chiudi la tab
	}

	/* ---------- File I/O ---------- */

	private async loadStrokes(): Promise<{ strokes: Stroke[]; canvasWidth: number | null; canvasHeight: number | null }> {
		const file = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			const strokes = parseSvgStrokes(content);
			// Legge sia la larghezza che l'altezza dal viewBox per ripristinare
			// il worldWidth originale (evita il taglio dei tratti oltre settings.canvasWidth)
			const m = content.match(/viewBox="0 0 (\d+) (\d+)"/);
			return {
				strokes,
				canvasWidth:  m ? parseInt(m[1] ?? '0') : null,
				canvasHeight: m ? parseInt(m[2] ?? '0') : null,
			};
		}
		return { strokes: [], canvasWidth: null, canvasHeight: null };
	}

	private async saveSvg() {
		if (!this.canvas) return;
		const strokes = this.canvas.getStrokes();
		const svg = strokesToSvg(strokes, this.canvas.getWidth(), this.canvas.getHeight(),
			this.canvas.getBgColor(), this.canvas.getLineColor());

		// Crea cartella se necessario
		const folder = this.svgPath.substring(0, this.svgPath.lastIndexOf('/'));
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		const existing = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, svg);
		} else {
			await this.app.vault.create(this.svgPath, svg);
		}
		// Aggiorna preview inline se visibile
		this.plugin.refreshPreview(this.embedId, svg);
	}

	/* ---------- Converti OCR ---------- */

	private async doConvert() {
		if (!this.canvas || this.canvas.getStrokes().length === 0) {
			new Notice('Nessun tratto da convertire');
			return;
		}
		try {
			new Notice('Riconoscimento in corso…');
			const svg = strokesToSvg(this.canvas.getStrokes(), this.canvas.getWidth(),
				this.canvas.getHeight(), this.canvas.getBgColor(), this.canvas.getLineColor());
			// SVG → PNG base64
			const parser = new DOMParser();
			const svgEl = parser.parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGElement;
			const base64 = await this.svgToPng(svgEl);
			// OCR via Gemini
			const recognizer = getRecognizer(this.plugin.settings.geminiApiKey, this.plugin.settings.ocrLanguages);
			const rawText = await recognizer.recognize(base64);
			if (!rawText.trim()) { new Notice('Nessun testo riconosciuto'); return; }
			// Markdown + archivia + sostituisci
			const markdown = parseMarkdown(rawText);
			await this.archiveSvg();
			await this.replaceCodeBlock(markdown);
			this.canvas.destroy();
			this.canvas = null;
			this.leaf.detach();
			new Notice('Conversione completata!');
		} catch (e: unknown) {
			new Notice('Errore OCR: ' + (e instanceof Error ? e.message : String(e)));
		}
	}

	/* ---------- Elimina ---------- */

	private async doDelete() {
		if (!confirm(t('confirm_delete'))) return;
		if (this.canvas) { this.canvas.destroy(); this.canvas = null; }
		// Rimuovi code block dal .md
		await this.removeCodeBlock();
		// Cancella il file SVG
		const svgFile = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (svgFile instanceof TFile) await this.app.vault.delete(svgFile);
		this.leaf.detach();
		new Notice(t('btn_delete'));
	}

	/* ---------- Manipolazione file .md ---------- */

	private async archiveSvg() {
		const svgFile = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (!(svgFile instanceof TFile)) return;
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
			`_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
		const dest = `${this.plugin.settings.svgFolder}/_converted`;
		if (!this.app.vault.getAbstractFileByPath(dest)) await this.app.vault.createFolder(dest);
		await this.app.vault.rename(svgFile, `${dest}/${ts}.svg`);
	}

	// Regex per trovare ![[svgPath]] nel file .md (nuovo formato wiki)
	private wikiEmbedRegex(): RegExp {
		const escaped = this.svgPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp(`\\n?!\\[\\[${escaped}\\]\\]\\n?`);
	}

	// Regex per trovare il code block legacy con l'id specifico
	private codeBlockRegex(): RegExp {
		const escaped = this.embedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp(
			'\\n?```handwriting\\n.*?"id"\\s*:\\s*"' + escaped + '".*?\\n```\\n?', 's'
		);
	}

	// Applica una sostituzione sul file .md, tentando prima il formato
	// wiki ![[svg]] e poi il code block legacy come fallback.
	// markdown === null → rimozione; stringa → sostituzione con il testo.
	private async replaceInMd(markdown: string | null) {
		const mdFile = this.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(mdFile instanceof TFile)) { new Notice('File markdown non trovato'); return; }

		const content   = await this.app.vault.read(mdFile);
		const wikiRegex = this.wikiEmbedRegex();
		const cbRegex   = this.codeBlockRegex();
		const repl      = markdown === null ? '\n' : '\n' + markdown + '\n';

		// Prova prima il formato wiki; se non trova, prova il code block legacy
		let updated = content.replace(wikiRegex, repl);
		if (updated === content) updated = content.replace(cbRegex, repl);

		if (updated !== content) await this.app.vault.modify(mdFile, updated);
	}

	private async replaceCodeBlock(markdown: string) {
		await this.replaceInMd(markdown);
	}

	private async removeCodeBlock() {
		await this.replaceInMd(null);
	}

	/* ---------- Helpers ---------- */

	private mkBtn(parent: HTMLElement, icon: string, key: string): HTMLElement {
		const label = t(key as any);
		const btn = parent.createEl('button', { cls: 'hwm_btn', attr: { title: label } });
		btn.setAttribute('data-hwm-key', key);
		btn.innerHTML = ICONS[icon] ?? '';
		return btn;
	}

	// Converte SVGElement → PNG base64 via canvas HTML temporaneo
	private svgToPng(svgElement: SVGElement): Promise<string> {
		return new Promise((resolve, reject) => {
			const cvs = document.createElement('canvas');
			const ctx = cvs.getContext('2d')!;
			const img = new Image();
			const blob = new Blob(
				[new XMLSerializer().serializeToString(svgElement)],
				{ type: 'image/svg+xml' }
			);
			const url = URL.createObjectURL(blob);
			img.onload = () => {
				cvs.width = img.width; cvs.height = img.height;
				ctx.drawImage(img, 0, 0);
				URL.revokeObjectURL(url);
				resolve(cvs.toDataURL('image/png').split(',')[1]!);
			};
			img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG → PNG fallito')); };
			img.src = url;
		});
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
		const isMobile = Platform.isMobile;
		const isDark = resolveIsDark(this.plugin.settings.bgMode);
		const bgColor = getEffectiveBgColor(this.plugin.settings);
		const lineColor = getEffectiveLineColor(this.plugin.settings);
		el.style.backgroundColor = bgColor;

		// Top bar con toolbar centrata. La X nativa di Obsidian è nascosta via CSS
		// (hwm_modal .modal-close-button); la chiusura avviene dal bottone X in toolbar.
		const topbar = el.createDiv({ cls: 'hwm_editor-topbar hwm_editor-topbar--modal' });
		if (isDark) topbar.classList.add('hwm_editor-topbar--dark');

		const toolbar = topbar.createDiv({ cls: 'hwm_toolbar hwm_editor-toolbar' });
		if (isDark) toolbar.classList.add('hwm_toolbar--dark');

		const penBtn = this.mkBtn(toolbar, 'pencil', 'btn_pen');
		penBtn.classList.add('hwm_active', 'hwm_pen-btn');
		const eraserBtn = this.mkBtn(toolbar, 'eraser', 'btn_eraser');
		eraserBtn.classList.add('hwm_eraser-btn');
		toolbar.createDiv({ cls: 'hwm_separator' });

		const colors = isDark
			? ['#ffffff', '#60a5fa', '#f87171', '#4ade80']
			: ['#000000', '#1e40af', '#dc2626', '#16a34a'];
		const colorWrap = toolbar.createDiv({ cls: 'hwm_colors' });
		const colorBtns: HTMLElement[] = [];
		for (const c of colors) {
			const btn = colorWrap.createEl('div', { cls: 'hwm_color-btn', attr: { title: c, role: 'button', tabindex: '0' } });
			btn.style.backgroundColor = c;
			for (const [k, v] of Object.entries({
				width: '22px', height: '22px', 'min-width': '22px', 'min-height': '22px',
				'border-radius': '50%', 'box-sizing': 'border-box', 'flex-shrink': '0'
			})) btn.style.setProperty(k, v, 'important');
			if (c === colors[0]) btn.classList.add('hwm_active');
			colorBtns.push(btn);
		}
		toolbar.createDiv({ cls: 'hwm_separator' });

		// Listener bgMode: aggiorna toolbar, pallini colore e sfondo canvas al cambio tema.
		const lightColors = ['#000000', '#1e40af', '#dc2626', '#16a34a'];
		const darkColors  = ['#ffffff', '#60a5fa', '#f87171', '#4ade80'];
		this.bgModeListener = (bgMode: string) => {
			const dark = resolveIsDark(bgMode);
			topbar.classList.toggle('hwm_editor-topbar--dark', dark);
			toolbar.classList.toggle('hwm_toolbar--dark', dark);
			handle.classList.toggle('hwm_resize-handle--dark', dark);
			el.style.backgroundColor = getEffectiveBgColor(this.plugin.settings);
			// Aggiorna i pallini colore palette
			const newColors = dark ? darkColors : lightColors;
			colorBtns.forEach((btn, i) => {
				btn.style.backgroundColor = newColors[i] ?? '';
				btn.setAttribute('title', newColors[i] ?? '');
			});
			// Aggiorna sfondo e righe nel canvas
			if (this.canvas) {
				this.canvas.setBackground(
					getEffectiveBgColor(this.plugin.settings),
					getEffectiveLineColor(this.plugin.settings)
				);
			}
		};
		this.plugin.bgModeListeners.add(this.bgModeListener);

		const undoBtn = this.mkBtn(toolbar, 'rotate-ccw', 'btn_undo');
		undoBtn.classList.add('hwm_undo-btn');
		const redoBtn = this.mkBtn(toolbar, 'rotate-cw', 'btn_redo');
		redoBtn.classList.add('hwm_redo-btn');
		const clearBtn = this.mkBtn(toolbar, 'trash', 'btn_clear');
		clearBtn.classList.add('hwm_clear-btn');
		toolbar.createDiv({ cls: 'hwm_separator' });

		const convertBtn = this.mkBtn(toolbar, 'file-text', 'btn_convert');
		convertBtn.classList.add('hwm_convert-btn');
		const saveBtn = this.mkBtn(toolbar, 'save', 'btn_save');
		saveBtn.classList.add('hwm_save-btn');
		const deleteBtn = this.mkBtn(toolbar, 'file-x', 'btn_delete');
		deleteBtn.classList.add('hwm_delete-btn');

		// Bottone chiudi (X): nel topbar, posizionata a destra via CSS absolute
		const closeBtn = this.mkBtn(topbar, 'x', 'btn_close');
		closeBtn.classList.add('hwm_close-btn');
		closeBtn.addEventListener('click', () => this.close());

		const scrollWrap = el.createDiv({ cls: 'hwm_editor-scroll' });
		const canvasWrap = scrollWrap.createDiv({ cls: 'hwm_canvas-wrap' });

		const { strokes, canvasWidth: savedW, canvasHeight: savedH } = await this.loadStrokes();
		const { canvasWidth, canvasHeight } = this.plugin.settings;
		const w = savedW ?? canvasWidth;
		const h = savedH ?? canvasHeight;
		const debugFn = this.plugin.settings.debugMode ? (msg: string) => new Notice(msg, 3000) : null;

		this.canvas = new DrawingCanvas(canvasWrap, w, h, canvasHeight, isMobile, debugFn);
		this.canvas.setBackground(bgColor, lineColor);
		this.canvas.setColor(colors[0]!);
		if (isMobile) this.canvas.allowFingerScroll(scrollWrap);

		if (strokes.length > 0) {
			const remapped = strokes.map(s => ({ ...s, color: remapStrokeColor(s.color, this.plugin.settings.bgMode) }));
			this.canvas.loadStrokes(remapped);
		}

		// Espande il canvas a tutta la larghezza del modal (elimina le bande laterali).
		// requestAnimationFrame garantisce che il layout del modal sia pronto prima di misurarlo.
		requestAnimationFrame(() => {
			const displayW = scrollWrap.clientWidth;
			if (this.canvas && displayW > canvasWidth) {
				this.canvas.setDisplayWidth(displayW);
			}
		});

		const handle = scrollWrap.createDiv({ cls: 'hwm_resize-handle hwm_resize-handle--disabled' });
		handle.createEl('span', { text: '⋯' });
		handle.classList.toggle('hwm_resize-handle--dark', isDark);

		// Auto-scroll solo se non si sta disegnando (stesso motivo del DrawingEditorView)
		this.canvas.onResize(() => {
			if (!this.canvas?.isPointerDown()) scrollWrap.scrollTop = scrollWrap.scrollHeight;
		});

		const cv = this.canvas;
		penBtn.addEventListener('click', () => { cv.setMode('pen'); penBtn.classList.add('hwm_active'); eraserBtn.classList.remove('hwm_active'); });
		eraserBtn.addEventListener('click', () => { cv.setMode('eraser'); eraserBtn.classList.add('hwm_active'); penBtn.classList.remove('hwm_active'); });
		for (let i = 0; i < colorBtns.length; i++) {
			colorBtns[i]!.addEventListener('click', () => {
				colorBtns.forEach(b => b.classList.remove('hwm_active'));
				colorBtns[i]!.classList.add('hwm_active');
				cv.setColor(colors[i]!);
				if (isMobile) updateColorSizes(toolbar.classList.contains('hwm_toolbar--compact'));
			});
		}
		undoBtn.addEventListener('click', () => cv.undo());
		redoBtn.addEventListener('click', () => cv.redo());
		clearBtn.addEventListener('click', () => cv.clear());
		convertBtn.addEventListener('click', () => this.doConvert());
		saveBtn.addEventListener('click', async () => { await this.saveSvg(); new Notice('Salvato'); });
		deleteBtn.addEventListener('click', () => this.doDelete());

		cv.onChange(() => {
			if (this.saveTimer) clearTimeout(this.saveTimer);
			this.saveTimer = setTimeout(() => this.saveSvg(), 2000);
		});
	}

	private async loadStrokes(): Promise<{ strokes: Stroke[]; canvasWidth: number | null; canvasHeight: number | null }> {
		const file = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			const m = content.match(/viewBox="0 0 (\d+) (\d+)"/);
			return {
				strokes: parseSvgStrokes(content),
				canvasWidth:  m ? parseInt(m[1] ?? '0') : null,
				canvasHeight: m ? parseInt(m[2] ?? '0') : null,
			};
		}
		return { strokes: [], canvasWidth: null, canvasHeight: null };
	}

	private async saveSvg() {
		if (!this.canvas) return;
		const svg = strokesToSvg(this.canvas.getStrokes(), this.canvas.getWidth(), this.canvas.getHeight(),
			this.canvas.getBgColor(), this.canvas.getLineColor());
		const folder = this.svgPath.substring(0, this.svgPath.lastIndexOf('/'));
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		const existing = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (existing instanceof TFile) { await this.app.vault.modify(existing, svg); }
		else { await this.app.vault.create(this.svgPath, svg); }
		this.plugin.refreshPreview(this.embedId, svg);
	}

	private async doConvert() {
		if (!this.canvas || this.canvas.getStrokes().length === 0) { new Notice('Nessun tratto da convertire'); return; }
		try {
			new Notice('Riconoscimento in corso…');
			const svg = strokesToSvg(this.canvas.getStrokes(), this.canvas.getWidth(), this.canvas.getHeight(),
				this.canvas.getBgColor(), this.canvas.getLineColor());
			const svgEl = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGElement;
			const base64 = await this.svgToPng(svgEl);
			const recognizer = getRecognizer(this.plugin.settings.geminiApiKey, this.plugin.settings.ocrLanguages);
			const rawText = await recognizer.recognize(base64);
			if (!rawText.trim()) { new Notice('Nessun testo riconosciuto'); return; }
			const markdown = parseMarkdown(rawText);
			await this.archiveSvg();
			await this.replaceCodeBlock(markdown);
			this.canvas.destroy(); this.canvas = null;
			this.close();
			new Notice('Conversione completata!');
		} catch (e: unknown) { new Notice('Errore OCR: ' + (e instanceof Error ? e.message : String(e))); }
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
				const cm = mdView?.contentEl.querySelector('.cm-content') as HTMLElement;
				cm?.focus();
			}, 300);
		};

		// Registra il listener PRIMA di modificare il file, così non perdiamo l'evento.
		// vault.on('modify') scatta con certezza quando removeCodeBlock() scrive il file.
		const ref = this.app.vault.on('modify', (file) => {
			if (file.path === srcPath) {
				this.app.vault.offref(ref);
				doFocus();
			}
		});

		await this.removeCodeBlock();
		const svgFile = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (svgFile instanceof TFile) await this.app.vault.delete(svgFile);

		// Fallback: se vault.modify non spara entro 3s (caso anomalo), forza comunque il focus
		setTimeout(() => { this.app.vault.offref(ref); doFocus(); }, 3000);

		this.close();
		new Notice(t('btn_delete'));
	}

	private async archiveSvg() {
		const svgFile = this.app.vault.getAbstractFileByPath(this.svgPath);
		if (!(svgFile instanceof TFile)) return;
		const now = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
		const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
		const dest = `${this.plugin.settings.svgFolder}/_converted`;
		if (!this.app.vault.getAbstractFileByPath(dest)) await this.app.vault.createFolder(dest);
		await this.app.vault.rename(svgFile, `${dest}/${ts}.svg`);
	}

	// Regex per trovare ![[svgPath]] nel file .md (formato wiki)
	private wikiEmbedRegex(): RegExp {
		const esc = this.svgPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp(`\\n?!\\[\\[${esc}\\]\\]\\n?`);
	}

	// Regex per il code block legacy con l'id specifico
	private codeBlockRegex(): RegExp {
		const esc = this.embedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp('\\n?```handwriting\\n.*?"id"\\s*:\\s*"' + esc + '".*?\\n```\\n?', 's');
	}

	// Applica sostituzione sul .md: prova prima formato wiki, poi legacy come fallback
	private async replaceInMd(replacement: string) {
		const mdFile = this.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(mdFile instanceof TFile)) { new Notice('File markdown non trovato'); return; }
		const content = await this.app.vault.read(mdFile);
		let updated = content.replace(this.wikiEmbedRegex(), replacement);
		if (updated === content) updated = content.replace(this.codeBlockRegex(), replacement);
		if (updated !== content) await this.app.vault.modify(mdFile, updated);
	}

	private async replaceCodeBlock(markdown: string) {
		await this.replaceInMd('\n' + markdown + '\n');
	}

	private async removeCodeBlock() {
		await this.replaceInMd('\n');
	}

	private mkBtn(parent: HTMLElement, icon: string, key: string): HTMLElement {
		const label = t(key as any);
		const btn = parent.createEl('button', { cls: 'hwm_btn', attr: { title: label } });
		btn.setAttribute('data-hwm-key', key);
		btn.innerHTML = ICONS[icon] ?? '';
		return btn;
	}

	private svgToPng(svgElement: SVGElement): Promise<string> {
		return new Promise((resolve, reject) => {
			const cvs = document.createElement('canvas');
			const ctx = cvs.getContext('2d')!;
			const img = new Image();
			const blob = new Blob([new XMLSerializer().serializeToString(svgElement)], { type: 'image/svg+xml' });
			const url = URL.createObjectURL(blob);
			img.onload = () => { cvs.width = img.width; cvs.height = img.height; ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url); resolve(cvs.toDataURL('image/png').split(',')[1]!); };
			img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG → PNG fallito')); };
			img.src = url;
		});
	}
}

