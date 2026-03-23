/* =============================================
   Embed — Processor per blocchi handwriting

   Supporta due formati:
   1. NUOVO: ![[_handwriting/hw_xxx.svg]]
      - Visibile anche senza plugin (immagine SVG nativa)
      - Gestito da registerMarkdownPostProcessor
   2. LEGACY: ```handwriting { "id": ..., "svg": ... } ```
      - Formato originale, mantenuto per compatibilità
      - Gestito da registerMarkdownCodeBlockProcessor
   ============================================= */

import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
	Modal,
	TFile,
	Notice,
	Platform,
} from 'obsidian';
import type HandwritingPlugin from './main';
import { DrawingCanvas, Stroke } from './drawing-canvas';
import { strokesToSvg, parseSvgStrokes, generateId } from './svg-utils';
import { getEffectiveBgColor, getEffectiveLineColor, remapStrokeColor } from './settings';
import { getRecognizer } from './recognizer';
import { parseMarkdown } from './md-parser';

// Icone SVG inline (stile Lucide 24×24)
const ICONS: Record<string, string> = {
	'file-text':   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
	'x':           `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
	'chevron-up':  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
	'pencil':      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
};
import type HandwritingPlugin from './main';
import { Stroke } from './drawing-canvas';
import { strokesToSvg, parseSvgStrokes, generateId } from './svg-utils';
import { getEffectiveBgColor, getEffectiveLineColor, remapStrokeColor, BgMode } from './settings';
import { getRecognizer } from './recognizer';
import { parseMarkdown } from './md-parser';
import { VIEW_TYPE_HANDWRITING, DrawingEditorView, DrawingModal } from './editor-view';

// Dati JSON salvati dentro il code block ```handwriting (formato legacy)
interface EmbedData {
	id: string;
	svg: string;
}

/* =============================================
   Registrazione di entrambi i processor
   ============================================= */

export function registerEmbed(plugin: HandwritingPlugin) {
	// --- Listener globale: remap automatico colori SVG al cambio bgMode ---
	// Quando l'utente cambia sfondo canvas nelle impostazioni, tutti gli SVG del plugin
	// attualmente tracciati in embedPaths vengono letti, rimappati e risalvati nel vault.
	// Identifica gli SVG del plugin tramite <desc class="hwm-strokes"> — gli SVG
	// dell'utente non hanno questo tag e vengono ignorati.
	const onBgModeRemap = async (bgMode: string) => {
		for (const [embedId, svgPath] of plugin.embedPaths) {
			const file = plugin.app.vault.getAbstractFileByPath(svgPath);
			if (!(file instanceof TFile)) continue;
			const content = await plugin.app.vault.read(file);
			// Salta SVG non creati dal plugin (assenza del tag hwm-strokes)
			if (!content.includes('hwm-strokes')) continue;
			const strokes = parseSvgStrokes(content);
			// Rimappa i colori dei tratti al nuovo tema
			const remapped = strokes.map(s => ({
				...s, color: remapStrokeColor(s.color, bgMode as BgMode)
			}));
			// Legge dimensioni reali dal viewBox per preservare l'altezza raggiunta con auto-expand.
			// Usare plugin.settings.canvasHeight causerebbe il "collasso" degli SVG cresciuti.
			const dimMatch = content.match(/viewBox="0 0 (\d+) (\d+)"/);
			const svgWidth  = dimMatch ? parseInt(dimMatch[1]!) : plugin.settings.canvasWidth;
			const svgHeight = dimMatch ? parseInt(dimMatch[2]!) : plugin.settings.canvasHeight;
			const newSvg = strokesToSvg(
				remapped,
				svgWidth,
				svgHeight,
				getEffectiveBgColor(plugin.settings),
				getEffectiveLineColor(plugin.settings)
			);
			await plugin.app.vault.modify(file, newSvg);
			// Aggiorna l'<img> nella preview inline con cache-bust
			plugin.refreshPreview(embedId, newSvg);
		}
	};
	plugin.bgModeListeners.add(onBgModeRemap);
	plugin.register(() => plugin.bgModeListeners.delete(onBgModeRemap));

	// --- NUOVO: MutationObserver su document.body ---
	// Intercetta gli span .internal-embed con src _handwriting/ non appena
	// appaiono nel DOM — funziona sia in reading view che in live preview
	// (dove il post-processor non viene chiamato sui widget CM6 delle immagini).
	setupMutationObserver(plugin);

	// --- LEGACY: code block processor per ```handwriting {...} ``` ---
	// Mantenuto per compatibilità con i blocchi esistenti nel vault.
	plugin.registerMarkdownCodeBlockProcessor(
		'handwriting',
		async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			await renderLegacyEmbed(source, el, ctx, plugin);
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

/* =============================================
   NUOVO FORMATO — MutationObserver per ![[svg]]
   ============================================= */

// Registra un MutationObserver su document.body che intercetta
// gli span .internal-embed con src _handwriting/ nel momento in cui
// appaiono nel DOM. Funziona sia in reading view che in live preview
// (in live preview il post-processor non viene chiamato sui widget CM6).
function setupMutationObserver(plugin: HandwritingPlugin) {
	const tryDecorate = (span: HTMLElement) => {
		// Salta se già decorato (flag data attribute — più affidabile del parent check)
		if (span.dataset.hwmDecorated === '1') return;

		const svgPath = span.getAttribute('src') ?? '';
		if (!svgPath.includes('_handwriting/') || !svgPath.endsWith('.svg')) return;

		const filename = svgPath.split('/').pop() ?? '';
		const embedId  = filename.replace('.svg', '');
		if (!embedId.startsWith('hw_')) return;

		// Se Obsidian non ha ancora caricato l'immagine (classe image-embed
		// assente), riprova tra 150 ms — il caricamento è asincrono.
		if (!span.classList.contains('image-embed')) {
			setTimeout(() => tryDecorate(span), 150);
			return;
		}

		// Marca subito come decorato per evitare doppia elaborazione
		span.dataset.hwmDecorated = '1';

		// TEST A: pointer-events: none sullo span.
		// Ipotesi: Chrome usa lo stesso hit-test dei pointer events per la
		// proximity detection dell'handwriting → con none, ignora lo span e
		// trova il cm-content[ce=true] sottostante → handwriting torna attivo.
		span.style.pointerEvents = 'none';

		// NESSUNA modifica allo span dentro cm-content.
		// Lo lasciamo identico a un'immagine normale: nessuna classe extra,
		// nessun figlio aggiunto. Questo evita di rompere l'handwriting Android
		// (il contenteditable="false" + figli extra confondono il hit-test di Chrome).
		// Tutti i bottoni vivono in document.body via pannello portale.

		const sourcePath = resolveSourcePath(span, plugin);

		// Callback refresh: aggiorna l'<img> dopo il salvataggio dalla tab editor.
		// Usa cache-bust URL (non data-URI) per non rompere l'handwriting Android.
		plugin.previewCallbacks.set(embedId, () => {
			if (!span.isConnected) return;
			const img = span.querySelector('img');
			if (!img) return;
			const base = img.src.split('?')[0]!;
			img.src = base + '?t=' + Date.now();
		});

		// Pannello portale con tutti i bottoni, in document.body (fuori da cm-content)
		createPortalPanel(span, embedId, svgPath, sourcePath, plugin);
	};

	const observer = new MutationObserver((mutations) => {
		for (const mut of mutations) {
			for (const node of mut.addedNodes) {
				if (!(node instanceof HTMLElement)) continue;
				// Il nodo stesso potrebbe essere l'embed, oppure contenerlo
				if (node.classList.contains('internal-embed') &&
					node.getAttribute('src')?.includes('_handwriting/')) {
					tryDecorate(node);
				} else {
					node.querySelectorAll<HTMLElement>('.internal-embed[src*="_handwriting/"]')
						.forEach(tryDecorate);
				}
			}
		}
	});

	observer.observe(document.body, { childList: true, subtree: true });
	// Disconnette l'observer quando il plugin viene disabilitato
	plugin.register(() => observer.disconnect());
}

// Risale il DOM per trovare il leaf markdown che contiene `el`,
// e restituisce il path del file aperto in quel leaf.
function resolveSourcePath(el: HTMLElement, plugin: HandwritingPlugin): string {
	const leaves = plugin.app.workspace.getLeavesOfType('markdown');
	for (const leaf of leaves) {
		const contentEl = (leaf.view as unknown as { contentEl: HTMLElement }).contentEl;
		if (contentEl?.contains(el)) {
			return (leaf.view as unknown as { file?: { path: string } }).file?.path ?? '';
		}
	}
	// Fallback: file attualmente attivo
	return plugin.app.workspace.getActiveFile()?.path ?? '';
}


/* =============================================
   LEGACY — Code block processor
   ============================================= */

// Gestisce il vecchio formato ```handwriting {...}```
// Parsa il JSON, mostra la preview SVG con bottoni.
async function renderLegacyEmbed(
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

	// Rimuove contenteditable="false" dai wrapper CM6 per ridurre
	// l'impatto sull'handwriting Android (non risolve il problema ma
	// è la mitigazione che avevamo già in precedenza).
	stripContentEditableFalse(el);

	// Container principale
	const container = el.createDiv({ cls: 'hwm_container' });

	// Carica SVG esistente
	const { strokes, svgContent } = await loadSvgData(data.svg, plugin);

	// Mostra la preview con i bottoni
	showLegacyPreview(container, strokes, svgContent, data, ctx, plugin);
}

// Renderizza la preview SVG (formato legacy) con i 3 bottoni inline.
function showLegacyPreview(
	container: HTMLElement,
	strokes: Stroke[],
	svgContent: string | null,
	data: EmbedData,
	ctx: MarkdownPostProcessorContext,
	plugin: HandwritingPlugin
) {
	container.empty();

	const isDark = plugin.settings.bgMode === 'dark';
	const bgColor = getEffectiveBgColor(plugin.settings);
	container.style.backgroundColor = bgColor;

	const collapsedHeight = plugin.settings.canvasHeight;

	// --- 3 bottoni inline ---
	const btnBar = container.createDiv({ cls: 'hwm_inline-buttons' });
	if (isDark) btnBar.classList.add('hwm_inline-buttons--dark');

	const deleteBtn = createBtn(btnBar, 'x', 'Elimina riquadro');
	deleteBtn.classList.add('hwm_delete-btn');

	const convertBtn = createBtn(btnBar, 'file-text', 'Converti in Markdown');
	convertBtn.classList.add('hwm_convert-btn');

	const collapseBtn = createBtn(btnBar, 'chevron-up', 'Comprimi');
	collapseBtn.classList.add('hwm_collapse-btn');

	// --- Preview SVG via CSS background-image (nessun <img> dentro cm-content) ---
	const preview = container.createDiv({ cls: 'hwm_inline-preview' });
	let isExpanded = true;

	let currentSvgContent = svgContent;
	let currentStrokes    = strokes;

	renderPreviewContent(preview, currentSvgContent);

	// Callback refresh dalla tab editor
	plugin.previewCallbacks.set(data.id, (newSvgContent) => {
		if (!preview.isConnected) return;
		currentSvgContent = newSvgContent;
		currentStrokes    = parseSvgStrokes(newSvgContent);
		renderPreviewContent(preview, newSvgContent);
	});

	// Collapse/Expand
	collapseBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		isExpanded = !isExpanded;
		if (isExpanded) {
			preview.classList.remove('hwm_collapsed');
			preview.style.maxHeight = '';
			collapseBtn.classList.remove('hwm_rotated');
			collapseBtn.title = 'Comprimi';
		} else {
			preview.classList.add('hwm_collapsed');
			preview.style.maxHeight = collapsedHeight + 'px';
			collapseBtn.classList.add('hwm_rotated');
			collapseBtn.title = 'Espandi';
		}
	});

	// Bottone matita portale (fuori da cm-content)
	createLegacyPortalButton(container, plugin.app, plugin, data.id, data.svg, ctx.sourcePath);

	// Converti
	convertBtn.addEventListener('click', async (e) => {
		e.stopPropagation();
		if (!currentSvgContent || currentStrokes.length === 0) {
			new Notice('Nessun tratto da convertire');
			return;
		}
		await doConvert(currentSvgContent, data, ctx, plugin);
	});

	// Elimina
	deleteBtn.addEventListener('click', async (e) => {
		e.stopPropagation();
		if (!confirm('Eliminare questo riquadro handwriting e il file SVG associato?')) return;
		await removeLegacyEmbed(ctx, data, plugin);
	});
}

// Renderizza l'SVG come CSS background-image su un <div> (legacy).
// Evita <img> dentro cm-content che possono influenzare l'handwriting Android.
function renderPreviewContent(preview: HTMLElement, svgContent: string | null) {
	preview.empty();
	if (svgContent) {
		const div = preview.createDiv({ cls: 'hwm_preview-bg' });
		div.style.backgroundImage = `url('data:image/svg+xml,${encodeURIComponent(svgContent)}')`;
		// Calcola aspect ratio dal viewBox
		const m = svgContent.match(/viewBox="0 0 (\d+) (\d+)"/);
		const svgW = m ? parseInt(m[1]!) : 800;
		const svgH = m ? parseInt(m[2]!) : 300;
		div.style.paddingBottom = (svgH / svgW * 100) + '%';
	} else {
		preview.createDiv({ cls: 'hwm_placeholder', text: 'Usa il bottone matita in alto a destra per disegnare' });
	}
}

/* =============================================
   Conversione OCR — Nuovo formato wiki
   ============================================= */

async function doConvertWiki(
	svgContent: string,
	svgPath: string,
	sourcePath: string,
	plugin: HandwritingPlugin
) {
	// Lancia eccezione in caso di errore (il chiamante decide se mostrare Notice o propagare)
	new Notice('Riconoscimento in corso…');
	const parser = new DOMParser();
	const svgEl  = parser.parseFromString(svgContent, 'image/svg+xml')
		.documentElement as unknown as SVGElement;
	const base64     = await svgToBase64Png(svgEl);
	const recognizer = getRecognizer(plugin.settings.geminiApiKey, plugin.settings.ocrLanguages);
	const rawText    = await recognizer.recognize(base64);
	if (!rawText.trim()) throw new Error('Nessun testo riconosciuto');
	const markdown = parseMarkdown(rawText);
	await archiveSvgByPath(svgPath, plugin);
	await replaceWikiEmbedWithMarkdown(svgPath, markdown, sourcePath, plugin);
	new Notice('Conversione completata!');
}

/* =============================================
   Conversione OCR — Legacy (code block)
   ============================================= */

async function doConvert(
	svgContent: string,
	data: EmbedData,
	ctx: MarkdownPostProcessorContext,
	plugin: HandwritingPlugin
) {
	try {
		new Notice('Riconoscimento in corso…');
		const parser = new DOMParser();
		const svgEl  = parser.parseFromString(svgContent, 'image/svg+xml')
			.documentElement as unknown as SVGElement;
		const base64     = await svgToBase64Png(svgEl);
		const recognizer = getRecognizer(plugin.settings.geminiApiKey, plugin.settings.ocrLanguages);
		const rawText    = await recognizer.recognize(base64);
		if (!rawText.trim()) { new Notice('Nessun testo riconosciuto'); return; }

		const markdown = parseMarkdown(rawText);
		await archiveSvg(data, plugin);
		await replaceEmbedWithMarkdown(ctx, data, markdown, plugin);
		new Notice('Conversione completata!');
	} catch (e: unknown) {
		new Notice('Errore OCR: ' + (e instanceof Error ? e.message : String(e)));
	}
}

/* =============================================
   File I/O
   ============================================= */

// Carica il file SVG e ne estrae tratti e contenuto grezzo
async function loadSvgData(
	svgPath: string,
	plugin: HandwritingPlugin
): Promise<{ strokes: Stroke[]; svgContent: string | null }> {
	const file = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (file instanceof TFile) {
		const content = await plugin.app.vault.read(file);
		const strokes = parseSvgStrokes(content);
		return { strokes, svgContent: content };
	}
	return { strokes: [], svgContent: null };
}

/* =============================================
   Regex per i due formati nel file .md
   ============================================= */

// Regex per trovare ![[svgPath]] nel file .md
function wikiEmbedRegex(svgPath: string): RegExp {
	const escaped = escapeRegex(svgPath);
	return new RegExp(`\\n?!\\[\\[${escaped}\\]\\]\\n?`);
}

// Regex per trovare il code block legacy con l'id specifico
function codeBlockRegex(embedId: string): RegExp {
	const escaped = escapeRegex(embedId);
	return new RegExp(
		'\\n?```handwriting\\n.*?"id"\\s*:\\s*"' + escaped + '".*?\\n```\\n?', 's'
	);
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* =============================================
   Elimina embed
   ============================================= */

// Rimuove ![[svgPath]] dal .md e cancella il file SVG
async function removeWikiEmbed(
	svgPath: string,
	sourcePath: string,
	plugin: HandwritingPlugin
) {
	const mdFile = plugin.app.vault.getAbstractFileByPath(sourcePath);
	if (!(mdFile instanceof TFile)) { new Notice('File markdown non trovato'); return; }

	const content = await plugin.app.vault.read(mdFile);
	const updated = content.replace(wikiEmbedRegex(svgPath), '\n');
	if (updated !== content) await plugin.app.vault.modify(mdFile, updated);

	// Cancella il file SVG
	const svgFile = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (svgFile instanceof TFile) await plugin.app.vault.delete(svgFile);

	new Notice('Riquadro eliminato');
}

// Rimuove il code block legacy dal .md e cancella il file SVG
async function removeLegacyEmbed(
	ctx: MarkdownPostProcessorContext,
	data: EmbedData,
	plugin: HandwritingPlugin
) {
	const mdFile = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(mdFile instanceof TFile)) { new Notice('File markdown non trovato'); return; }

	const content = await plugin.app.vault.read(mdFile);
	const updated = content.replace(codeBlockRegex(data.id), '\n');
	if (updated !== content) await plugin.app.vault.modify(mdFile, updated);

	const svgFile = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (svgFile instanceof TFile) await plugin.app.vault.delete(svgFile);

	new Notice('Riquadro eliminato');
}

/* =============================================
   Archivia SVG dopo conversione
   ============================================= */

async function archiveSvgByPath(svgPath: string, plugin: HandwritingPlugin) {
	const svgFile = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (!(svgFile instanceof TFile)) return;
	await _moveSvgToConverted(svgFile, plugin);
}

async function archiveSvg(data: EmbedData, plugin: HandwritingPlugin) {
	const svgFile = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (!(svgFile instanceof TFile)) return;
	await _moveSvgToConverted(svgFile, plugin);
}

// Sposta il file SVG nella cartella _converted con nome timestamp
async function _moveSvgToConverted(svgFile: TFile, plugin: HandwritingPlugin) {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const ts  = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

	const destFolder = `${plugin.settings.svgFolder}/_converted`;
	if (!plugin.app.vault.getAbstractFileByPath(destFolder)) {
		await plugin.app.vault.createFolder(destFolder);
	}
	await plugin.app.vault.rename(svgFile, `${destFolder}/${ts}.svg`);
}

/* =============================================
   Sostituisce embed con markdown (conversione OCR)
   ============================================= */

async function replaceWikiEmbedWithMarkdown(
	svgPath: string,
	markdown: string,
	sourcePath: string,
	plugin: HandwritingPlugin
) {
	const mdFile = plugin.app.vault.getAbstractFileByPath(sourcePath);
	if (!(mdFile instanceof TFile)) { new Notice('File markdown non trovato'); return; }

	const content = await plugin.app.vault.read(mdFile);
	const updated = content.replace(wikiEmbedRegex(svgPath), '\n' + markdown + '\n');
	if (updated !== content) await plugin.app.vault.modify(mdFile, updated);
}

async function replaceEmbedWithMarkdown(
	ctx: MarkdownPostProcessorContext,
	data: EmbedData,
	markdown: string,
	plugin: HandwritingPlugin
) {
	const mdFile = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(mdFile instanceof TFile)) { new Notice('File markdown non trovato'); return; }

// Sostituisce il wiki link ![[svg]] con il testo markdown convertito
async function replaceWikiEmbedWithMarkdown(svgPath: string, markdown: string, mdFile: TFile, plugin: HandwritingPlugin) {
	const filename = svgPath.split('/').pop()!;
	const content = await plugin.app.vault.read(mdFile);
	const updated = content.replace(codeBlockRegex(data.id), '\n' + markdown + '\n');
	if (updated !== content) await plugin.app.vault.modify(mdFile, updated);
}

/* =============================================
   Comando: inserisce un nuovo blocco handwriting
   Usa il NUOVO formato ![[svg]]
   ============================================= */

export async function insertHandwritingBlock(plugin: HandwritingPlugin) {
	const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) { new Notice('Apri un file markdown prima'); return; }

	const editor  = view.editor;
	const id      = generateId();
	const svgPath = `${plugin.settings.svgFolder}/${id}.svg`;

	// Crea il file SVG vuoto PRIMA di inserire il wikilink nel markdown.
	// Se il file non esiste quando Obsidian processa ![[svg]], mostra
	// "could not be found" e non renderizza image-embed → il post-processor
	// non trova nulla da decorare e i bottoni non appaiono.
	const bgColor   = getEffectiveBgColor(plugin.settings);
	const lineColor = getEffectiveLineColor(plugin.settings);
	const emptySvg  = strokesToSvg([], plugin.settings.canvasWidth, plugin.settings.canvasHeight, bgColor, lineColor);

	const folder = plugin.settings.svgFolder;
	if (!plugin.app.vault.getAbstractFileByPath(folder)) {
		await plugin.app.vault.createFolder(folder);
	}
	await plugin.app.vault.create(svgPath, emptySvg);

	// Inserisce il wikilink: Obsidian trova subito il file → lo renderizza come immagine
	editor.replaceSelection(`\n![[${svgPath}]]\n`);
}

/* =============================================
   Helpers
   ============================================= */

// Risale il DOM da `el` fino a cm-content e rimuove contenteditable="false"
// dai wrapper CM6 (mitigazione parziale del bug handwriting Android).
function stripContentEditableFalse(el: HTMLElement) {
	let node: HTMLElement | null = el;
	while (node) {
		if (node.classList.contains('cm-content')) break;
		if (node.getAttribute('contenteditable') === 'false') {
			node.removeAttribute('contenteditable');
		}
		node.style.setProperty('pointer-events', 'none');
		node = node.parentElement;
	}
}

/* ---------- Pannello portale (fuori da cm-content) — Nuovo formato wiki ---------- */

// Crea un pannello floating in document.body con tutti i bottoni di controllo.
// Essendo fuori da cm-content, non interferisce con l'handwriting Android:
// lo span internal-embed rimane identico a un'immagine normale (nessun figlio aggiunto).
function createPortalPanel(
	container: HTMLElement,
	embedId: string,
	svgPath: string,
	sourcePath: string,
	plugin: HandwritingPlugin
) {
	// Risolve il tema effettivo tenendo conto di 'auto'
	const resolveIsDark = (bgMode: string) =>
		bgMode === 'auto' ? document.body.classList.contains('theme-dark') : bgMode === 'dark';

	const isDark = resolveIsDark(plugin.settings.bgMode);
	const collapsedHeight = plugin.settings.canvasHeight;
	let isExpanded = true;
	// Flag per nascondere il pannello quando il modal (Desktop) è aperto
	let modalOpen = false;

	// Lo span diventa position: relative per ancorarvi il pannello (position: absolute).
	container.style.position = 'relative';

	const panel = document.createElement('div');
	panel.className = 'hwm_portal-panel';
	if (isDark) panel.classList.add('hwm_portal-panel--dark');
	container.appendChild(panel);
	// Rimuove il pannello dal DOM quando il plugin viene disabilitato
	plugin.register(() => panel.remove());

	// Traccia embedId → svgPath per il remap automatico al cambio bgMode
	plugin.embedPaths.set(embedId, svgPath);

	// --- Bottone matita ---
	// Desktop: apre DrawingModal (overlay fullscreen, senza aprire nuova tab)
	// Mobile: apre DrawingEditorView in una nuova tab
	const pencilBtn = createPanelBtn(panel, 'pencil', 'Apri editor disegno');
	pencilBtn.addEventListener('click', async () => {
		if (Platform.isDesktop) {
			if (modalOpen) return;
			modalOpen = true;
			// Nasconde il pannello mentre il modal è aperto (altrimenti galleggerebbe sul canvas)
			panel.style.display = 'none';
			const modal = new DrawingModal(plugin.app, plugin, embedId, svgPath, sourcePath);
			modal.onClosed = () => {
				modalOpen = false;
				if (container.isConnected) panel.style.display = '';
			};
			modal.open();
		} else {
			// Mobile: nuova tab (DrawingEditorView è fuori da cm-content)
			const leaves   = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING);
			const existing = leaves.find(l => (l.view as DrawingEditorView).getEmbedId() === embedId);
			if (existing) {
				plugin.app.workspace.setActiveLeaf(existing, { focus: true });
				return;
			}
			const leaf = plugin.app.workspace.getLeaf('tab');
			await leaf.setViewState({
				type: VIEW_TYPE_HANDWRITING,
				state: { id: embedId, svg: svgPath, sourcePath },
				active: true,
			});
			plugin.app.workspace.revealLeaf(leaf);
		}
	});

	// Separatore visivo
	const sep = document.createElement('div');
	sep.className = 'hwm_separator';
	panel.appendChild(sep);

	// --- Bottone converti in Markdown ---
	const convertBtn = createPanelBtn(panel, 'file-text', 'Converti in Markdown');

	// --- Bottone comprimi/espandi ---
	// Usa height + overflow:hidden sul container (non max-height sull'<img>):
	// così l'immagine viene ritagliata verticalmente senza che la larghezza cambi.
	// Il pannello (position:absolute, top:6px) resta dentro l'area visibile
	// anche da compresso (collapsedHeight è sempre >> 6px + altezza pannello).
	const collapseBtn = createPanelBtn(panel, 'chevron-up', 'Comprimi');
	collapseBtn.classList.add('hwm_collapse-btn');

	// --- Bottone elimina ---
	const deleteBtn = createPanelBtn(panel, 'x', 'Elimina riquadro');
	deleteBtn.classList.add('hwm_delete-btn');
	deleteBtn.addEventListener('click', async () => {
		if (!confirm('Eliminare questo riquadro handwriting e il file SVG associato?')) return;
		await removeWikiEmbed(svgPath, sourcePath, plugin);
	});

	// --- Funzioni condivise: usate dai bottoni e dal menu globale (⋮ Obsidian) ---
	const doExpand = () => {
		isExpanded = true;
		container.style.height   = '';
		container.style.overflow = '';
		collapseBtn.classList.remove('hwm_rotated');
		collapseBtn.title = 'Comprimi';
	};
	const doCollapse = () => {
		isExpanded = false;
		container.style.height   = collapsedHeight + 'px';
		container.style.overflow = 'hidden';
		collapseBtn.classList.add('hwm_rotated');
		collapseBtn.title = 'Espandi';
	};
	// Carica SVG e chiama doConvertWiki (che lancia eccezione in caso di errore)
	const doConvertAction = async () => {
		const { strokes, svgContent } = await loadSvgData(svgPath, plugin);
		if (!svgContent || strokes.length === 0) throw new Error('Nessun tratto da convertire');
		await doConvertWiki(svgContent, svgPath, sourcePath, plugin);
	};

	collapseBtn.addEventListener('click', () => {
		if (isExpanded) doCollapse(); else doExpand();
	});
	convertBtn.addEventListener('click', async () => {
		// Bottone singolo: mostra Notice in caso di errore senza propagare
		try { await doConvertAction(); }
		catch (e: unknown) { new Notice('Errore OCR: ' + (e instanceof Error ? e.message : String(e))); }
	});

	// Registra le azioni nel plugin per il menu "⋮ Espandi/Collassa/Converti tutti"
	plugin.embedActions.set(embedId, { expand: doExpand, collapse: doCollapse, convert: doConvertAction, container, sourcePath });
	plugin.register(() => plugin.embedActions.delete(embedId));

	// Layout-change: su Mobile nasconde il pannello quando la tab editor è aperta
	const onLayoutChange = () => {
		if (!container.isConnected) {
			plugin.app.workspace.off('layout-change', onLayoutChange);
			plugin.embedPaths.delete(embedId);
			return;
		}
		if (Platform.isMobile) {
			const tabOpen = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING)
				.some(l => (l.view as DrawingEditorView).getEmbedId() === embedId);
			panel.style.display = tabOpen ? 'none' : '';
		}
	};
	plugin.app.workspace.on('layout-change', onLayoutChange);
	plugin.register(() => plugin.app.workspace.off('layout-change', onLayoutChange));

	// BgMode listener: aggiorna la classe dark sul pannello al cambio tema
	const onBgMode = (bgMode: string) => {
		if (!container.isConnected) {
			plugin.bgModeListeners.delete(onBgMode);
			return;
		}
		panel.classList.toggle('hwm_portal-panel--dark', resolveIsDark(bgMode));
	};
	plugin.bgModeListeners.add(onBgMode);
	plugin.register(() => plugin.bgModeListeners.delete(onBgMode));
}

// Crea un bottone div nel pannello portale
function createPanelBtn(parent: HTMLElement, icon: string, title: string): HTMLElement {
	const btn = document.createElement('div');
	btn.className = 'hwm_btn';
	btn.setAttribute('title', title);
	btn.setAttribute('role', 'button');
	btn.setAttribute('tabindex', '0');
	btn.innerHTML = ICONS[icon] ?? '';
	parent.appendChild(btn);
	return btn;
}

/* ---------- Bottone portale (fuori da cm-content) — Formato legacy ---------- */

// Crea un singolo <button> in document.body per aprire la tab editor.
// Solo per il vecchio formato ```handwriting``` (il container legacy non è in cm-content,
// quindi i bottoni inline sono già sicuri; questo aggiunge solo la matita portale).
function createLegacyPortalButton(
	container: HTMLElement,
	app: import('obsidian').App,
	plugin: HandwritingPlugin,
	embedId: string,
	svgPath: string,
	sourcePath: string
) {
	const btn = document.createElement('button');
	btn.className = 'hwm_portal-btn';
	btn.innerHTML = ICONS['pencil'] ?? '';
	btn.title = 'Apri editor disegno';
	document.body.appendChild(btn);

	// Apre la tab editor al click
	btn.addEventListener('click', async () => {
		const leaves   = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING);
		const existing = leaves.find(l => (l.view as DrawingEditorView).getEmbedId() === embedId);
		if (existing) {
			plugin.app.workspace.setActiveLeaf(existing, { focus: true });
			return;
		}
		const leaf = plugin.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: VIEW_TYPE_HANDWRITING,
			state: { id: embedId, svg: svgPath, sourcePath },
			active: true,
		});
		plugin.app.workspace.revealLeaf(leaf);
	});

	// RAF loop: aggiorna posizione e visibilità
	const update = () => {
		if (!container.isConnected) {
			btn.remove();
			return;
		}
		const rect = container.getBoundingClientRect();
		btn.style.top  = (rect.top  + 6) + 'px';
		btn.style.left = (rect.right - 44) + 'px';
		const editorOpen = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING)
			.some(l => (l.view as DrawingEditorView).getEmbedId() === embedId);
		const inViewport = rect.width > 0 && rect.top < window.innerHeight && rect.bottom > 0;
		btn.style.display = (inViewport && !editorOpen) ? 'flex' : 'none';
		requestAnimationFrame(update);
	};
	requestAnimationFrame(update);
}

// Usa <div> invece di <button> per i bottoni dentro cm-content.
// I <button> su Android Mobile possono interferire con l'handwriting.
function createBtn(parent: HTMLElement, icon: string, title: string): HTMLElement {
	const btn = parent.createDiv({ cls: 'hwm_btn', attr: { title, role: 'button', tabindex: '0' } });
	btn.innerHTML = ICONS[icon] ?? '';
	return btn;
}

function svgToBase64Png(svgElement: SVGElement): Promise<string> {
	return new Promise((resolve, reject) => {
		const canvas = document.createElement('canvas');
		const ctx    = canvas.getContext('2d')!;
		const img    = new Image();
		const svgBlob = new Blob(
			[new XMLSerializer().serializeToString(svgElement)],
			{ type: 'image/svg+xml' }
		);
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
