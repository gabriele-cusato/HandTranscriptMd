/* =============================================
   Embed — Gestisce il rendering dei riquadri handwriting.

   Due formati supportati:
   - NUOVO: ![[_handwriting/hw_xxx.svg]]  → visibile anche senza plugin
   - LEGACY: ```handwriting {...}```       → backward compat

   Nuovo formato: MutationObserver intercetta gli span Obsidian e aggiunge
   un pannello portale (document.body, position:fixed) con 4 bottoni.
   Click matita → WikiDrawingModal (overlay fullscreen con canvas).
   ============================================= */

import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
	Modal,
	TFile,
	Notice,
	Platform
} from 'obsidian';
import type HandwritingPlugin from './main';
import { DrawingCanvas, Stroke } from './drawing-canvas';
import { strokesToSvg, parseSvgStrokes, generateId } from './svg-utils';
import { getEffectiveBgColor, getEffectiveLineColor, remapStrokeColor } from './settings';
import { getRecognizer } from './recognizer';
import { parseMarkdown } from './md-parser';

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
	'chevron-down':`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
	'chevron-up':  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
	'arrow-left':  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
};

// Dati JSON salvati dentro il code block ```handwriting (formato legacy)
interface EmbedData {
	id: string;
	svg: string;
}

/* =============================================
   REGISTRAZIONE
   ============================================= */

export function registerEmbed(plugin: HandwritingPlugin) {
	// 1. Formato legacy: code block ```handwriting
	plugin.registerMarkdownCodeBlockProcessor(
		'handwriting',
		async (source, el, ctx) => {
			await renderEmbed(source, el, ctx, plugin);
		}
	);

	// 2. Nuovo formato: ![[_handwriting/hw_xxx.svg]]
	registerWikiEmbed(plugin);
}

/* =============================================
   WIKI EMBED — nuovo formato ![[svg]]
   ============================================= */

function registerWikiEmbed(plugin: HandwritingPlugin) {
	// MutationObserver: intercetta i nuovi span internal-embed appena appaiono nel DOM
	const observer = new MutationObserver(mutations => {
		for (const m of mutations) {
			for (const node of Array.from(m.addedNodes)) {
				if (!(node instanceof HTMLElement)) continue;
				// Lo span stesso
				if (node.matches('span.internal-embed[src*="_handwriting/"]')) {
					tryDecorate(node, plugin);
				}
				// Discendenti (es. quando Obsidian inserisce un intero blocco)
				node.querySelectorAll('span.internal-embed[src*="_handwriting/"]').forEach(el => {
					tryDecorate(el as HTMLElement, plugin);
				});
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
	plugin.register(() => observer.disconnect());

	// Decora gli span già presenti nel DOM al caricamento del plugin
	document.querySelectorAll('span.internal-embed[src*="_handwriting/"]').forEach(el => {
		tryDecorate(el as HTMLElement, plugin);
	});
}

// Prova a decorare uno span; ritenta dopo 150ms se image-embed non è ancora pronto
function tryDecorate(span: HTMLElement, plugin: HandwritingPlugin) {
	if (span.dataset.hwmDecorated) return;
	span.dataset.hwmDecorated = '1';

	// Obsidian aggiunge 'image-embed' in modo asincrono; aspettiamo
	if (!span.classList.contains('image-embed')) {
		setTimeout(() => {
			delete span.dataset.hwmDecorated;
			tryDecorate(span, plugin);
		}, 150);
		return;
	}

	decorateSpan(span, plugin);
}

// Aggiunge il pannello portale floating sopra lo span
function decorateSpan(span: HTMLElement, plugin: HandwritingPlugin) {
	// Normalizza il percorso SVG (l'attributo src può avere uno slash iniziale)
	const rawSrc = span.getAttribute('src') ?? '';
	const svgPath = rawSrc.startsWith('/') ? rawSrc.slice(1) : rawSrc;

	// Pannello portale in document.body: position: fixed, z-index alto
	const panel = document.body.createDiv({ cls: 'hwm_portal-panel' });

	const pencilBtn  = createPortalBtn(panel, 'pencil',    'Modifica disegno');
	const convertBtn = createPortalBtn(panel, 'file-text', 'Converti in Markdown');
	const collapseBtn = createPortalBtn(panel, 'chevron-up', 'Comprimi');
	const deleteBtn  = createPortalBtn(panel, 'x',         'Elimina riquadro');

	// --- Comprimi / Espandi ---
	let collapsed = false;
	collapseBtn.addEventListener('click', () => {
		collapsed = !collapsed;
		span.classList.toggle('hwm-collapsed', collapsed);
		collapseBtn.innerHTML = ICONS[collapsed ? 'chevron-down' : 'chevron-up'] ?? '';
		collapseBtn.title = collapsed ? 'Espandi' : 'Comprimi';
	});

	// --- Matita: apre il modal editor ---
	pencilBtn.addEventListener('click', () => {
		loadSvgData(svgPath, plugin).then(({ strokes, canvasHeight }) => {
			const modal = new WikiDrawingModal(
				plugin.app, svgPath, strokes, canvasHeight, plugin,
				() => refreshImg(span, svgPath, plugin)
			);
			modal.open();
		});
	});

	// --- Converti in Markdown (OCR) ---
	convertBtn.addEventListener('click', async () => {
		const { strokes } = await loadSvgData(svgPath, plugin);
		if (strokes.length === 0) { new Notice('Nessun tratto da convertire'); return; }
		try {
			new Notice('Riconoscimento in corso…');
			const svgFile = plugin.app.vault.getAbstractFileByPath(svgPath);
			if (!(svgFile instanceof TFile)) { new Notice('File SVG non trovato'); return; }
			const svgContent = await plugin.app.vault.read(svgFile);
			const svgEl = new DOMParser().parseFromString(svgContent, 'image/svg+xml').documentElement as unknown as SVGElement;
			const base64 = await svgToBase64Png(svgEl);
			const recognizer = getRecognizer(plugin.settings.geminiApiKey, plugin.settings.ocrLanguages);
			const rawText = await recognizer.recognize(base64);
			if (!rawText.trim()) { new Notice('Nessun testo riconosciuto'); return; }
			const markdown = parseMarkdown(rawText);
			await archiveSvg({ id: '', svg: svgPath }, plugin);
			const mdFile = await findMdFileForSvg(svgPath, plugin);
			if (!mdFile) { new Notice('File markdown non trovato'); return; }
			await replaceWikiEmbedWithMarkdown(svgPath, markdown, mdFile, plugin);
			panel.remove();
			new Notice('Conversione completata!');
		} catch (e: unknown) {
			new Notice('Errore OCR: ' + (e instanceof Error ? e.message : String(e)));
		}
	});

	// --- Elimina riquadro ---
	deleteBtn.addEventListener('click', async () => {
		if (!confirm('Eliminare questo riquadro handwriting e il file SVG associato?')) return;
		const mdFile = await findMdFileForSvg(svgPath, plugin);
		if (!mdFile) { new Notice('File markdown non trovato'); return; }
		const filename = svgPath.split('/').pop()!;
		const content = await plugin.app.vault.read(mdFile);
		const newContent = content.replace(
			new RegExp(`\\n?!\\[\\[${escapeRegex(filename)}\\]\\]\\n?`, 'g'), '\n'
		);
		if (newContent !== content) await plugin.app.vault.modify(mdFile, newContent);
		const svgFile = plugin.app.vault.getAbstractFileByPath(svgPath);
		if (svgFile instanceof TFile) await plugin.app.vault.delete(svgFile);
		panel.remove();
		new Notice('Riquadro eliminato');
	});

	// Scroll fix per-pannello: nasconde il pannello durante lo scroll
	// (evita che rimanga in posizione sbagliata tra un frame RAF e l'altro).
	// Usa visibility invece di display per non interferire con il RAF loop.
	let scrollTimer: ReturnType<typeof setTimeout> | null = null;
	const onScroll = () => {
		panel.style.visibility = 'hidden';
		if (scrollTimer) clearTimeout(scrollTimer);
		scrollTimer = setTimeout(() => { panel.style.visibility = ''; }, 150);
	};
	// Cerca il contenitore scrollabile: .cm-scroller (live preview) o .markdown-reading-view (reading view)
	const scrollEl = span.closest('.cm-scroller') as HTMLElement | null
		?? span.closest('.markdown-reading-view') as HTMLElement | null;
	if (scrollEl) {
		scrollEl.addEventListener('scroll', onScroll, { passive: true });
	}

	// --- RAF loop: mantiene il pannello posizionato sopra lo span ---
	const tick = () => {
		// Se lo span è stato rimosso dal DOM, elimina il pannello e stoppa
		if (!span.isConnected) { panel.remove(); return; }
		const rect = span.getBoundingClientRect();
		// rect.width > 0 verifica che il span sia effettivamente renderizzato
		const inViewport = rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
		// Nasconde se: fuori viewport, o se un modal Obsidian è aperto
		// (impostazioni, drawing modal, ecc. — tutti aggiungono .modal-bg al body)
		const anyModalOpen = !!document.querySelector('.modal-bg');
		if (!inViewport || anyModalOpen) {
			panel.style.display = 'none';
		} else {
			panel.style.display = 'flex';
			panel.style.top   = (rect.top + 6) + 'px';
			panel.style.right = (window.innerWidth - rect.right + 6) + 'px';
			panel.style.left  = 'auto';
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

// Aggiorna il src dell'<img> con cache-bust dopo il salvataggio del SVG
function refreshImg(span: HTMLElement, svgPath: string, plugin: HandwritingPlugin) {
	const img = span.querySelector('img');
	if (!img) return;
	const file = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (file instanceof TFile) {
		img.src = plugin.app.vault.getResourcePath(file) + '?t=' + Date.now();
	}
}

/* =============================================
   WIKI DRAWING MODAL
   Modal fullscreen con canvas editor per il nuovo formato ![[svg]]
   ============================================= */

class WikiDrawingModal extends Modal {
	private svgPath: string;
	private initialStrokes: Stroke[];
	private savedHeight: number | null;
	private plugin: HandwritingPlugin;
	private onSaved: () => void;
	private canvas: DrawingCanvas | null = null;

	constructor(
		app: App,
		svgPath: string,
		strokes: Stroke[],
		savedHeight: number | null,
		plugin: HandwritingPlugin,
		onSaved: () => void
	) {
		super(app);
		this.svgPath     = svgPath;
		this.initialStrokes = strokes;
		this.savedHeight = savedHeight;
		this.plugin      = plugin;
		this.onSaved     = onSaved;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('hwm_wiki-modal-content');

		// Container con lo stesso stile del canvas inline
		const container = contentEl.createDiv({ cls: 'hwm_container hwm_editing' });
		const isMobile = Platform.isMobile;
		if (isMobile) container.classList.add('hwm_mobile');

		const isDark = document.body.classList.contains('theme-dark');

		// Dichiarata prima della toolbar per permettere al bottone ← di usarla
		let canvas: DrawingCanvas;

		// --- Toolbar ---
		const toolbar = container.createDiv({ cls: 'hwm_toolbar' });
		if (isDark)    toolbar.classList.add('hwm_toolbar--dark');
		if (isMobile)  toolbar.classList.add('hwm_toolbar--compact');

		// Bottone ← per chiudere il modal
		const backBtn = createBtn(toolbar, 'arrow-left', 'Chiudi editor');
		backBtn.classList.add('hwm_back-btn');
		backBtn.addEventListener('click', () => { canvas?.destroy(); this.close(); });
		toolbar.createDiv({ cls: 'hwm_separator' });

		// Toggle toolbar compatta su mobile
		let toggleBtn: HTMLElement | null = null;
		if (isMobile) {
			toggleBtn = createBtn(toolbar, 'chevron-down', 'Mostra tutti i controlli');
			toggleBtn.classList.add('hwm_toggle-btn');
			toggleBtn.addEventListener('click', () => {
				const compact = toolbar.classList.contains('hwm_toolbar--compact');
				toolbar.classList.toggle('hwm_toolbar--compact', !compact);
				updateColorBtnSizes(!compact);
				toggleBtn!.innerHTML = ICONS[compact ? 'chevron-up' : 'chevron-down'] ?? '';
				toggleBtn!.title = compact ? 'Comprimi toolbar' : 'Mostra tutti i controlli';
			});
		}

		// Penna / Gomma
		const penBtn = createBtn(toolbar, 'pencil', 'Penna');
		penBtn.classList.add('hwm_active', 'hwm_pen-btn');
		const eraserBtn = createBtn(toolbar, 'eraser', 'Gomma');
		eraserBtn.classList.add('hwm_eraser-btn');
		toolbar.createDiv({ cls: 'hwm_separator' });

		// Palette colori adattata al tema
		const colors = isDark
			? ['#ffffff', '#60a5fa', '#f87171', '#4ade80']
			: ['#000000', '#1e40af', '#dc2626', '#16a34a'];
		const colorWrap = toolbar.createDiv({ cls: 'hwm_colors' });
		const colorBtns: HTMLElement[] = [];
		for (const color of colors) {
			const btn = colorWrap.createEl('div', {
				cls: 'hwm_color-btn',
				attr: { title: color, role: 'button', tabindex: '0' }
			});
			btn.style.backgroundColor = color;
			btn.style.setProperty('width',        '22px', 'important');
			btn.style.setProperty('height',       '22px', 'important');
			btn.style.setProperty('min-width',    '22px', 'important');
			btn.style.setProperty('min-height',   '22px', 'important');
			btn.style.setProperty('border-radius','50%',  'important');
			btn.style.setProperty('box-sizing',   'border-box', 'important');
			btn.style.setProperty('flex-shrink',  '0',    'important');
			if (color === colors[0]) btn.classList.add('hwm_active');
			colorBtns.push(btn);
		}
		toolbar.createDiv({ cls: 'hwm_separator' });

		// Helper: aggiorna min-width pallini in base alla modalità compatta (gestito via JS per !important)
		const updateColorBtnSizes = (compact: boolean) => {
			colorBtns.forEach(b => {
				const size = (!compact || b.classList.contains('hwm_active')) ? '22px' : '0';
				b.style.setProperty('min-width',  size, 'important');
				b.style.setProperty('min-height', size, 'important');
			});
		};
		if (isMobile) updateColorBtnSizes(true);

		// Undo / Redo / Clear
		const undoBtn = createBtn(toolbar, 'rotate-ccw', 'Annulla');
		undoBtn.classList.add('hwm_undo-btn');
		const redoBtn = createBtn(toolbar, 'rotate-cw', 'Ripristina');
		redoBtn.classList.add('hwm_redo-btn');
		const clearBtn = createBtn(toolbar, 'trash', 'Cancella tutto');
		clearBtn.classList.add('hwm_clear-btn');
		toolbar.createDiv({ cls: 'hwm_separator' });

		// Converti / Salva / Elimina
		const convertBtn = createBtn(toolbar, 'file-text', 'Converti in Markdown');
		convertBtn.classList.add('hwm_convert-btn');
		const saveBtn = createBtn(toolbar, 'save', 'Salva');
		saveBtn.classList.add('hwm_save-btn');
		const deleteBtn = createBtn(toolbar, 'x', 'Elimina riquadro');
		deleteBtn.classList.add('hwm_delete-btn');

		// --- Canvas ---
		const canvasWrap = container.createDiv({ cls: 'hwm_canvas-wrap' });
		const { canvasWidth, canvasHeight } = this.plugin.settings;
		const height = this.savedHeight ?? canvasHeight;
		const debugFn = this.plugin.settings.debugMode
			? (msg: string) => new Notice(msg, 3000) : null;
		canvas = new DrawingCanvas(canvasWrap, canvasWidth, height, canvasHeight, isMobile, debugFn);
		this.canvas = canvas;

		// Sfondo canvas
		const bgColor   = getEffectiveBgColor(this.plugin.settings);
		const lineColor = getEffectiveLineColor(this.plugin.settings);
		canvas.setBackground(bgColor, lineColor);
		canvas.setColor(colors[0]!);
		container.style.backgroundColor = bgColor;

		// Carica i tratti esistenti rimappando i colori al tema corrente
		if (this.initialStrokes.length > 0) {
			const remapped = this.initialStrokes.map(s => ({
				...s, color: remapStrokeColor(s.color, this.plugin.settings.bgMode)
			}));
			canvas.loadStrokes(remapped);
		}

		// Handle di resize in basso
		const resizeHandle = container.createDiv({ cls: 'hwm_resize-handle' });
		resizeHandle.createEl('span', { text: '⋯' });
		if (isDark) {
			resizeHandle.style.background     = '#2a2a2a';
			resizeHandle.style.borderTopColor = '#444';
			resizeHandle.style.color          = '#888';
		}
		setupResizeHandle(resizeHandle, canvas);

		// --- Event handlers ---

		penBtn.addEventListener('click', () => {
			canvas.setMode('pen');
			penBtn.classList.add('hwm_active');
			eraserBtn.classList.remove('hwm_active');
		});
		eraserBtn.addEventListener('click', () => {
			canvas.setMode('eraser');
			eraserBtn.classList.add('hwm_active');
			penBtn.classList.remove('hwm_active');
		});

		for (let i = 0; i < colorBtns.length; i++) {
			const btn   = colorBtns[i]!;
			const color = colors[i]!;
			btn.addEventListener('click', () => {
				colorBtns.forEach(b => b.classList.remove('hwm_active'));
				btn.classList.add('hwm_active');
				canvas.setColor(color);
				if (isMobile) updateColorBtnSizes(toolbar.classList.contains('hwm_toolbar--compact'));
			});
		}

		undoBtn.addEventListener('click',  () => canvas.undo());
		redoBtn.addEventListener('click',  () => canvas.redo());
		clearBtn.addEventListener('click', () => canvas.clear());

		// Salva SVG su disco e aggiorna la preview
		saveBtn.addEventListener('click', async () => {
			await this.saveSvg(canvas);
			this.onSaved();
		});

		// Elimina riquadro e file SVG
		deleteBtn.addEventListener('click', async () => {
			if (!confirm('Eliminare questo riquadro handwriting e il file SVG associato?')) return;
			canvas.destroy();
			const mdFile = await findMdFileForSvg(this.svgPath, this.plugin);
			if (!mdFile) { new Notice('File markdown non trovato'); return; }
			const filename = this.svgPath.split('/').pop()!;
			const content  = await this.plugin.app.vault.read(mdFile);
			const newContent = content.replace(
				new RegExp(`\\n?!\\[\\[${escapeRegex(filename)}\\]\\]\\n?`, 'g'), '\n'
			);
			if (newContent !== content) await this.plugin.app.vault.modify(mdFile, newContent);
			const svgFile = this.plugin.app.vault.getAbstractFileByPath(this.svgPath);
			if (svgFile instanceof TFile) await this.plugin.app.vault.delete(svgFile);
			this.close();
			new Notice('Riquadro eliminato');
		});

		// Converti in Markdown via OCR Gemini
		convertBtn.addEventListener('click', async () => {
			const strokes = canvas.getStrokes();
			if (strokes.length === 0) { new Notice('Nessun tratto da convertire'); return; }
			try {
				new Notice('Riconoscimento in corso…');
				const svgStr = strokesToSvg(strokes, canvas.getWidth(), canvas.getHeight(), canvas.getBgColor(), canvas.getLineColor());
				const svgEl  = new DOMParser().parseFromString(svgStr, 'image/svg+xml').documentElement as unknown as SVGElement;
				const base64 = await svgToBase64Png(svgEl);
				const recognizer = getRecognizer(this.plugin.settings.geminiApiKey, this.plugin.settings.ocrLanguages);
				const rawText = await recognizer.recognize(base64);
				if (!rawText.trim()) { new Notice('Nessun testo riconosciuto'); return; }
				const markdown = parseMarkdown(rawText);
				await archiveSvg({ id: '', svg: this.svgPath }, this.plugin);
				const mdFile = await findMdFileForSvg(this.svgPath, this.plugin);
				if (!mdFile) { new Notice('File markdown non trovato'); return; }
				canvas.destroy();
				await replaceWikiEmbedWithMarkdown(this.svgPath, markdown, mdFile, this.plugin);
				this.close();
				new Notice('Conversione completata!');
			} catch (e: unknown) {
				new Notice('Errore OCR: ' + (e instanceof Error ? e.message : String(e)));
			}
		});

		// Auto-save debounced 2s
		let saveTimer: ReturnType<typeof setTimeout> | null = null;
		canvas.onChange(() => {
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(async () => {
				await this.saveSvg(canvas);
				this.onSaved();
			}, 2000);
		});
	}

	onClose() {
		// Cleanup canvas WebGL/context al chiusura del modal
		this.canvas?.destroy();
		this.contentEl.empty();
	}

	// Salva i tratti come SVG su disco
	private async saveSvg(canvas: DrawingCanvas) {
		const strokes = canvas.getStrokes();
		const svg = strokesToSvg(
			strokes, canvas.getWidth(), canvas.getHeight(),
			canvas.getBgColor(), canvas.getLineColor()
		);
		const folderPath = this.svgPath.substring(0, this.svgPath.lastIndexOf('/'));
		if (folderPath) {
			const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) await this.plugin.app.vault.createFolder(folderPath);
		}
		const existing = this.plugin.app.vault.getAbstractFileByPath(this.svgPath);
		if (existing instanceof TFile) {
			await this.plugin.app.vault.modify(existing, svg);
		} else {
			await this.plugin.app.vault.create(this.svgPath, svg);
		}
	}
}

/* =============================================
   CODE BLOCK EMBED — formato legacy ```handwriting
   ============================================= */

async function renderEmbed(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	plugin: HandwritingPlugin
) {
	let data: EmbedData;
	try {
		data = JSON.parse(source.trim());
	} catch {
		el.createEl('p', { text: 'Handwriting: JSON non valido', cls: 'hwm_error' });
		return;
	}

	const container = el.createDiv({ cls: 'hwm_container' });
	const { strokes, canvasHeight } = await loadSvgData(data.svg, plugin);

	// Mostra la preview SVG (non apre subito il canvas)
	showPreview(container, strokes, canvasHeight, data, ctx, plugin);
}

/* ---------- Preview mode ---------- */

// Mostra l'SVG come immagine statica con bottone matita per aprire l'editor
function showPreview(
	container: HTMLElement,
	strokes: Stroke[],
	savedHeight: number | null,
	data: EmbedData,
	ctx: MarkdownPostProcessorContext,
	plugin: HandwritingPlugin
) {
	container.empty();
	container.classList.remove('hwm_editing');

	const wrap = container.createDiv({ cls: 'hwm_preview-wrap' });

	// Mostra SVG come <img> se esistono tratti, altrimenti placeholder
	const svgFile = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (svgFile instanceof TFile && strokes.length > 0) {
		const src = plugin.app.vault.getResourcePath(svgFile);
		wrap.createEl('img', { cls: 'hwm_preview-img', attr: { src } });
	} else {
		wrap.createEl('p', { text: 'Usa il bottone matita per disegnare.', cls: 'hwm_placeholder' });
	}

	// Bottone matita sovrapposto in alto a destra
	const pencilBtn = wrap.createEl('button', {
		cls: 'hwm_btn hwm_pencil-btn',
		attr: { title: 'Modifica disegno' }
	});
	pencilBtn.innerHTML = ICONS['pencil'] ?? '';
	pencilBtn.addEventListener('click', () => {
		// Ricarica i tratti aggiornati prima di aprire l'editor
		loadSvgData(data.svg, plugin).then(({ strokes: s, canvasHeight: h }) => {
			showEditor(container, s, h, data, ctx, plugin, () => {
				// Callback ← : torna al preview ricaricando i dati dal disco
				loadSvgData(data.svg, plugin).then(({ strokes: s2, canvasHeight: h2 }) => {
					showPreview(container, s2, h2, data, ctx, plugin);
				});
			});
		});
	});
}

/* ---------- Editor mode ---------- */

function showEditor(
	container: HTMLElement,
	strokes: Stroke[],
	savedHeight: number | null,
	data: EmbedData,
	ctx: MarkdownPostProcessorContext,
	plugin: HandwritingPlugin,
	onBack?: () => void
) {
	container.empty();
	container.classList.add('hwm_editing');

	const isMobile = Platform.isMobile;
	if (isMobile) container.classList.add('hwm_mobile');

	// Tema UI: segue il tema Obsidian corrente (non solo il bgMode del canvas)
	const isDark = document.body.classList.contains('theme-dark');

	// Dichiarata prima della toolbar: il bottone ← la referenzia via closure
	let canvas: DrawingCanvas;

	// --- Toolbar ---
	const toolbar = container.createDiv({ cls: 'hwm_toolbar' });
	if (isDark) toolbar.classList.add('hwm_toolbar--dark');

	// Bottone ← per tornare al preview
	if (onBack) {
		const backBtn = createBtn(toolbar, 'arrow-left', 'Torna al preview');
		backBtn.classList.add('hwm_back-btn');
		backBtn.addEventListener('click', () => { canvas.destroy(); onBack(); });
		toolbar.createDiv({ cls: 'hwm_separator' });
	}

	// Toggle compatta su mobile
	let toggleBtn: HTMLElement | null = null;
	if (isMobile) {
		toolbar.classList.add('hwm_toolbar--compact');
		toggleBtn = createBtn(toolbar, 'chevron-down', 'Mostra tutti i controlli');
		toggleBtn.classList.add('hwm_toggle-btn');
		toggleBtn.addEventListener('click', () => {
			const isCompact = toolbar.classList.contains('hwm_toolbar--compact');
			if (isCompact) {
				toolbar.classList.remove('hwm_toolbar--compact');
				updateColorBtnSizes(false);
				toggleBtn!.innerHTML = ICONS['chevron-up'] ?? '';
				toggleBtn!.title = 'Comprimi toolbar';
			} else {
				toolbar.classList.add('hwm_toolbar--compact');
				updateColorBtnSizes(true);
				toggleBtn!.innerHTML = ICONS['chevron-down'] ?? '';
				toggleBtn!.title = 'Mostra tutti i controlli';
			}
		});
	}

	// Penna / Gomma
	const penBtn = createBtn(toolbar, 'pencil', 'Penna');
	penBtn.classList.add('hwm_active', 'hwm_pen-btn');
	const eraserBtn = createBtn(toolbar, 'eraser', 'Gomma');
	eraserBtn.classList.add('hwm_eraser-btn');
	toolbar.createDiv({ cls: 'hwm_separator' });

	// Palette colori adattata al tema
	const colors = isDark
		? ['#ffffff', '#60a5fa', '#f87171', '#4ade80']
		: ['#000000', '#1e40af', '#dc2626', '#16a34a'];
	const colorWrap = toolbar.createDiv({ cls: 'hwm_colors' });
	const colorBtns: HTMLElement[] = [];
	for (const color of colors) {
		const btn = colorWrap.createEl('div', {
			cls: 'hwm_color-btn',
			attr: { title: color, role: 'button', tabindex: '0' }
		});
		btn.style.backgroundColor = color;
		btn.style.setProperty('width',        '22px', 'important');
		btn.style.setProperty('height',       '22px', 'important');
		btn.style.setProperty('min-width',    '22px', 'important');
		btn.style.setProperty('min-height',   '22px', 'important');
		btn.style.setProperty('border-radius','50%',  'important');
		btn.style.setProperty('box-sizing',   'border-box', 'important');
		btn.style.setProperty('flex-shrink',  '0',    'important');
		if (color === colors[0]) btn.classList.add('hwm_active');
		colorBtns.push(btn);
	}
	toolbar.createDiv({ cls: 'hwm_separator' });

	const updateColorBtnSizes = (compact: boolean) => {
		colorBtns.forEach(b => {
			const size = (!compact || b.classList.contains('hwm_active')) ? '22px' : '0';
			b.style.setProperty('min-width',  size, 'important');
			b.style.setProperty('min-height', size, 'important');
		});
	};
	if (isMobile) updateColorBtnSizes(true);

	// Undo / Redo / Clear
	const undoBtn = createBtn(toolbar, 'rotate-ccw', 'Annulla (Undo)');
	undoBtn.classList.add('hwm_undo-btn');
	const redoBtn = createBtn(toolbar, 'rotate-cw', 'Ripristina (Redo)');
	redoBtn.classList.add('hwm_redo-btn');
	const clearBtn = createBtn(toolbar, 'trash', 'Cancella tutto');
	clearBtn.classList.add('hwm_clear-btn');
	toolbar.createDiv({ cls: 'hwm_separator' });

	// Converti / Salva / Elimina
	const convertBtn = createBtn(toolbar, 'file-text', 'Converti in Markdown');
	convertBtn.classList.add('hwm_convert-btn');
	const saveBtn = createBtn(toolbar, 'save', 'Salva');
	saveBtn.classList.add('hwm_save-btn');
	const deleteBtn = createBtn(toolbar, 'x', 'Elimina riquadro');
	deleteBtn.classList.add('hwm_delete-btn');

	// --- Canvas ---
	const canvasWrap = container.createDiv({ cls: 'hwm_canvas-wrap' });
	const { canvasWidth, canvasHeight } = plugin.settings;
	const height = savedHeight ?? canvasHeight;
	const debugFn = plugin.settings.debugMode
		? (msg: string) => new Notice(msg, 3000) : null;
	canvas = new DrawingCanvas(canvasWrap, canvasWidth, height, canvasHeight, isMobile, debugFn);

	const bgColor   = getEffectiveBgColor(plugin.settings);
	const lineColor = getEffectiveLineColor(plugin.settings);
	canvas.setBackground(bgColor, lineColor);
	canvas.setColor(colors[0]!);
	container.style.backgroundColor = bgColor;

	if (strokes.length > 0) {
		const remapped = strokes.map(s => ({
			...s, color: remapStrokeColor(s.color, plugin.settings.bgMode)
		}));
		canvas.loadStrokes(remapped);
		saveToSvg(canvas, data, plugin);
	}

	// Handle di resize
	const resizeHandle = container.createDiv({ cls: 'hwm_resize-handle' });
	resizeHandle.createEl('span', { text: '⋯' });
	if (isDark) {
		resizeHandle.style.background     = '#2a2a2a';
		resizeHandle.style.borderTopColor = '#444';
		resizeHandle.style.color          = '#888';
	}
	setupResizeHandle(resizeHandle, canvas);

	// --- Event handlers ---
	penBtn.addEventListener('click', () => {
		canvas.setMode('pen');
		penBtn.classList.add('hwm_active');
		eraserBtn.classList.remove('hwm_active');
	});
	eraserBtn.addEventListener('click', () => {
		canvas.setMode('eraser');
		eraserBtn.classList.add('hwm_active');
		penBtn.classList.remove('hwm_active');
	});

	for (let i = 0; i < colorBtns.length; i++) {
		const btn   = colorBtns[i]!;
		const color = colors[i]!;
		btn.addEventListener('click', () => {
			colorBtns.forEach(b => b.classList.remove('hwm_active'));
			btn.classList.add('hwm_active');
			canvas.setColor(color);
			if (isMobile) updateColorBtnSizes(toolbar.classList.contains('hwm_toolbar--compact'));
		});
	}

	undoBtn.addEventListener('click',  () => canvas.undo());
	redoBtn.addEventListener('click',  () => canvas.redo());
	clearBtn.addEventListener('click', () => canvas.clear());

	convertBtn.addEventListener('click', async () => {
		const strokes = canvas.getStrokes();
		if (strokes.length === 0) { new Notice('Nessun tratto da convertire'); return; }
		try {
			new Notice('Riconoscimento in corso…');
			const svgString = strokesToSvg(strokes, canvas.getWidth(), canvas.getHeight(), canvas.getBgColor(), canvas.getLineColor());
			const svgEl = new DOMParser().parseFromString(svgString, 'image/svg+xml').documentElement as unknown as SVGElement;
			const base64 = await svgToBase64Png(svgEl);
			const recognizer = getRecognizer(plugin.settings.geminiApiKey, plugin.settings.ocrLanguages);
			const rawText = await recognizer.recognize(base64);
			if (!rawText.trim()) { new Notice('Nessun testo riconosciuto'); return; }
			const markdown = parseMarkdown(rawText);
			await archiveSvg(data, plugin);
			canvas.destroy();
			await replaceEmbedWithMarkdown(ctx, data, markdown, plugin);
			new Notice('Conversione completata!');
		} catch (e: unknown) {
			new Notice('Errore OCR: ' + (e instanceof Error ? e.message : String(e)));
		}
	});

	saveBtn.addEventListener('click', async () => { await saveToSvg(canvas, data, plugin); });

	deleteBtn.addEventListener('click', async () => {
		if (!confirm('Eliminare questo riquadro handwriting e il file SVG associato?')) return;
		canvas.destroy();
		await removeEmbed(ctx, data, plugin);
	});

	// Auto-save debounced 2s
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	canvas.onChange(() => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => { await saveToSvg(canvas, data, plugin); }, 2000);
	});
}

/* ---------- Resize handle ---------- */

function setupResizeHandle(handle: HTMLElement, canvas: DrawingCanvas) {
	let startY = 0;
	let startHeight = 0;

	const onPointerMove = (e: PointerEvent) => {
		e.preventDefault();
		const delta = e.clientY - startY;
		canvas.resizeHeight(Math.max(100, startHeight + delta));
	};
	const onPointerUp = () => {
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
	};
	handle.addEventListener('pointerdown', (e: PointerEvent) => {
		e.preventDefault();
		startY = e.clientY;
		startHeight = canvas.getHeight();
		document.addEventListener('pointermove', onPointerMove);
		document.addEventListener('pointerup', onPointerUp);
	});
}

/* =============================================
   FILE I/O — condiviso tra entrambi i formati
   ============================================= */

// Carica il file SVG e ne estrae tratti + altezza canvas
async function loadSvgData(svgPath: string, plugin: HandwritingPlugin): Promise<{ strokes: Stroke[]; canvasHeight: number | null }> {
	const file = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (file instanceof TFile) {
		const content = await plugin.app.vault.read(file);
		const strokes = parseSvgStrokes(content);
		const heightMatch = content.match(/viewBox="0 0 \d+ (\d+)"/);
		const canvasHeight = heightMatch ? parseInt(heightMatch[1] ?? '0') : null;
		return { strokes, canvasHeight };
	}
	return { strokes: [], canvasHeight: null };
}

// Salva i tratti come file SVG (formato legacy)
async function saveToSvg(canvas: DrawingCanvas, data: EmbedData, plugin: HandwritingPlugin) {
	const svg = strokesToSvg(canvas.getStrokes(), canvas.getWidth(), canvas.getHeight(), canvas.getBgColor(), canvas.getLineColor());
	const folderPath = data.svg.substring(0, data.svg.lastIndexOf('/'));
	if (folderPath) {
		const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) await plugin.app.vault.createFolder(folderPath);
	}
	const existing = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (existing instanceof TFile) {
		await plugin.app.vault.modify(existing, svg);
	} else {
		await plugin.app.vault.create(data.svg, svg);
	}
}

// Cerca il file markdown che contiene il link ![[filename]] al SVG
async function findMdFileForSvg(svgPath: string, plugin: HandwritingPlugin): Promise<TFile | null> {
	const filename = svgPath.split('/').pop()!;
	for (const file of plugin.app.vault.getMarkdownFiles()) {
		const content = await plugin.app.vault.read(file);
		if (content.includes(filename)) return file;
	}
	return null;
}

// Rimuove il code block legacy dal markdown e cancella il file SVG
async function removeEmbed(ctx: MarkdownPostProcessorContext, data: EmbedData, plugin: HandwritingPlugin) {
	const mdFile = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(mdFile instanceof TFile)) { new Notice('File markdown non trovato'); return; }
	const content = await plugin.app.vault.read(mdFile);
	const pattern = new RegExp('\\n?```handwriting\\n.*?"id"\\s*:\\s*"' + escapeRegex(data.id) + '".*?\\n```\\n?', 's');
	const newContent = content.replace(pattern, '\n');
	if (newContent !== content) await plugin.app.vault.modify(mdFile, newContent);
	const svgFile = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (svgFile instanceof TFile) await plugin.app.vault.delete(svgFile);
	new Notice('Riquadro eliminato');
}

// Archivia il file SVG in _converted/ con nome timestamp dopo la conversione OCR
async function archiveSvg(data: EmbedData, plugin: HandwritingPlugin) {
	const svgFile = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (!(svgFile instanceof TFile)) return;
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
	const destFolder = `${plugin.settings.svgFolder}/_converted`;
	if (!plugin.app.vault.getAbstractFileByPath(destFolder)) {
		await plugin.app.vault.createFolder(destFolder);
	}
	await plugin.app.vault.rename(svgFile, `${destFolder}/${timestamp}.svg`);
}

// Sostituisce il code block legacy con il testo markdown convertito
async function replaceEmbedWithMarkdown(ctx: MarkdownPostProcessorContext, data: EmbedData, markdown: string, plugin: HandwritingPlugin) {
	const mdFile = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(mdFile instanceof TFile)) { new Notice('File markdown non trovato'); return; }
	const content = await plugin.app.vault.read(mdFile);
	const pattern = new RegExp('\\n?```handwriting\\n.*?"id"\\s*:\\s*"' + escapeRegex(data.id) + '".*?\\n```\\n?', 's');
	const newContent = content.replace(pattern, '\n' + markdown + '\n');
	if (newContent !== content) await plugin.app.vault.modify(mdFile, newContent);
}

// Sostituisce il wiki link ![[svg]] con il testo markdown convertito
async function replaceWikiEmbedWithMarkdown(svgPath: string, markdown: string, mdFile: TFile, plugin: HandwritingPlugin) {
	const filename = svgPath.split('/').pop()!;
	const content = await plugin.app.vault.read(mdFile);
	const newContent = content.replace(
		new RegExp(`\\n?!\\[\\[${escapeRegex(filename)}\\]\\]\\n?`, 'g'),
		'\n' + markdown + '\n'
	);
	if (newContent !== content) await plugin.app.vault.modify(mdFile, newContent);
}

/* =============================================
   INSERISCI NUOVO BLOCCO
   ============================================= */

// Crea un nuovo SVG vuoto e inserisce ![[svg]] nel documento corrente
export async function insertHandwritingBlock(plugin: HandwritingPlugin) {
	const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) { new Notice('Apri un file markdown prima'); return; }

	const id      = generateId();
	const svgPath = `${plugin.settings.svgFolder}/${id}.svg`;

	// Crea la cartella _handwriting se non esiste
	const folder = plugin.app.vault.getAbstractFileByPath(plugin.settings.svgFolder);
	if (!folder) await plugin.app.vault.createFolder(plugin.settings.svgFolder);

	// Crea SVG vuoto con le dimensioni default: Obsidian mostra "not found" se il file non esiste
	const { canvasWidth, canvasHeight } = plugin.settings;
	const emptySvg = strokesToSvg([], canvasWidth, canvasHeight, getEffectiveBgColor(plugin.settings), getEffectiveLineColor(plugin.settings));
	await plugin.app.vault.create(svgPath, emptySvg);

	// Inserisce il wiki link nel cursore corrente
	view.editor.replaceSelection(`\n![[${svgPath}]]\n`);
}

/* =============================================
   HELPERS
   ============================================= */

function createBtn(parent: HTMLElement, icon: string, title: string): HTMLElement {
	const btn = parent.createEl('button', { cls: 'hwm_btn', attr: { title } });
	btn.innerHTML = ICONS[icon] ?? '';
	return btn;
}

// Crea un bottone per il pannello portale (document.body).
// Usa <div role="button" class="hwm_btn"> invece di <button> perché Obsidian
// sovrascrive width/height dei <button> con i propri stili globali.
function createPortalBtn(parent: HTMLElement, icon: string, title: string): HTMLElement {
	const btn = parent.createEl('div', { cls: 'hwm_btn', attr: { role: 'button', title } });
	btn.innerHTML = ICONS[icon] ?? '';
	return btn;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Converte SVGElement → PNG base64 tramite canvas HTML temporaneo
function svgToBase64Png(svgElement: SVGElement): Promise<string> {
	return new Promise((resolve, reject) => {
		const canvas = document.createElement('canvas');
		const ctx    = canvas.getContext('2d')!;
		const img    = new Image();
		const svgBlob = new Blob([new XMLSerializer().serializeToString(svgElement)], { type: 'image/svg+xml' });
		const url = URL.createObjectURL(svgBlob);
		img.onload = () => {
			canvas.width  = img.width;
			canvas.height = img.height;
			ctx.drawImage(img, 0, 0);
			URL.revokeObjectURL(url);
			resolve(canvas.toDataURL('image/png').split(',')[1]!);
		};
		img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Errore conversione SVG → PNG')); };
		img.src = url;
	});
}
