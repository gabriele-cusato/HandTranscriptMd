/* =============================================
   Embed — Code block processor + Toolbar
   Gestisce il rendering dell'embed nel markdown.
   Il blocco si apre direttamente in modalità edit
   (disegno immediato, senza click extra).
   ============================================= */

import {
	MarkdownPostProcessorContext,
	MarkdownView,
	TFile,
	Notice,
	Platform
} from 'obsidian';

// Icone SVG inline (stile Lucide 24×24) — funzionano identicamente su Windows e Android,
// senza dipendere dalla versione di Lucide bundled in Obsidian.
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
};
import type HandwritingPlugin from './main';
import { DrawingCanvas, Stroke } from './drawing-canvas';
import { strokesToSvg, parseSvgStrokes, generateId } from './svg-utils';
import { getEffectiveBgColor, getEffectiveLineColor, remapStrokeColor } from './settings';
import { getRecognizer } from './recognizer';
import { parseMarkdown } from './md-parser';

// Dati JSON salvati dentro il code block ```handwriting
interface EmbedData {
	id: string;
	svg: string; // percorso relativo al file SVG nel vault
}

/* ---------- Registrazione ---------- */

export function registerEmbed(plugin: HandwritingPlugin) {
	plugin.registerMarkdownCodeBlockProcessor(
		'handwriting',
		async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			await renderEmbed(source, el, ctx, plugin);
		}
	);
}

/* ---------- Rendering dell'embed ---------- */

async function renderEmbed(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	plugin: HandwritingPlugin
) {
	// Parsa il JSON dal code block
	let data: EmbedData;
	try {
		data = JSON.parse(source.trim());
	} catch {
		el.createEl('p', { text: 'Handwriting: JSON non valido', cls: 'hwm_error' });
		return;
	}

	// Container principale
	const container = el.createDiv({ cls: 'hwm_container' });

	// Carica tratti esistenti dal file SVG
	const { strokes, canvasHeight } = await loadSvgData(data.svg, plugin);

	// Apre DIRETTAMENTE in modalità edit (disegno immediato)
	showEditor(container, strokes, canvasHeight, data, ctx, plugin);
}

/* ---------- Editor mode (default) ---------- */

function showEditor(
	container: HTMLElement,
	strokes: Stroke[],
	savedHeight: number | null,
	data: EmbedData,
	ctx: MarkdownPostProcessorContext,
	plugin: HandwritingPlugin
) {
	container.empty();
	container.classList.add('hwm_editing');

	const isMobile = Platform.isMobile;

	// Su mobile aggiunge classe per CSS dedicato (stile bottoni, icone)
	if (isMobile) container.classList.add('hwm_mobile');

	// Determina tema subito (usato sia per toolbar che per palette colori)
	const isDark = plugin.settings.bgMode === 'dark';

	// Toolbar (sempre visibile, in alto a destra)
	const toolbar = container.createDiv({ cls: 'hwm_toolbar' });
	// Tema scuro: sfondo e icone invertiti
	if (isDark) toolbar.classList.add('hwm_toolbar--dark');

	// Su mobile: parte compatta, toggle per espandere.
	// Il handler del toggle chiama updateColorBtnSizes, definita più in basso
	// ma già disponibile a runtime grazie alla chiusura (closure).
	let toggleBtn: HTMLElement | null = null;
	if (isMobile) {
		toolbar.classList.add('hwm_toolbar--compact');
		toggleBtn = createBtn(toolbar, 'chevron-down', 'Mostra tutti i controlli');
		toggleBtn.classList.add('hwm_toggle-btn');
		toggleBtn.addEventListener('click', () => {
			const isCompact = toolbar.classList.contains('hwm_toolbar--compact');
			if (isCompact) {
				toolbar.classList.remove('hwm_toolbar--compact');
				// Ripristina dimensioni di tutti i pallini colore
				updateColorBtnSizes(false);
				// Cambia icona a chevron-up (comprimi)
				toggleBtn!.innerHTML = ICONS['chevron-up'] ?? '';
				toggleBtn!.title = 'Comprimi toolbar';
			} else {
				toolbar.classList.add('hwm_toolbar--compact');
				// Collassa i pallini non attivi
				updateColorBtnSizes(true);
				// Ripristina icona chevron-down (espandi)
				toggleBtn!.innerHTML = ICONS['chevron-down'] ?? '';
				toggleBtn!.title = 'Mostra tutti i controlli';
			}
		});
	}

	// --- Tool: Penna ---
	const penBtn = createBtn(toolbar, 'pencil', 'Penna');
	penBtn.classList.add('hwm_active', 'hwm_pen-btn');

	// --- Tool: Gomma ---
	const eraserBtn = createBtn(toolbar, 'eraser', 'Gomma');
	eraserBtn.classList.add('hwm_eraser-btn');

	toolbar.createDiv({ cls: 'hwm_separator' });

	// --- Colori (palette adattata al tema: scuro=colori chiari, chiaro=colori scuri) ---
	const colors = isDark
		? ['#ffffff', '#60a5fa', '#f87171', '#4ade80']   // bianco, azzurro, rosso chiaro, verde chiaro
		: ['#000000', '#1e40af', '#dc2626', '#16a34a'];  // nero, blu, rosso, verde
	const colorWrap = toolbar.createDiv({ cls: 'hwm_colors' });
	const colorBtns: HTMLElement[] = [];
	for (const color of colors) {
		// Usiamo <div> invece di <button> per evitare che Obsidian Mobile
		// sovrascriva width/height con i propri stili globali sui button.
		const btn = colorWrap.createEl('div', {
			cls: 'hwm_color-btn',
			attr: { title: color, role: 'button', tabindex: '0' }
		});
		btn.style.backgroundColor = color;
		// Dimensioni circolari forzate via setProperty (bypass stili Obsidian)
		btn.style.setProperty('width', '22px', 'important');
		btn.style.setProperty('height', '22px', 'important');
		btn.style.setProperty('min-width', '22px', 'important');
		btn.style.setProperty('min-height', '22px', 'important');
		btn.style.setProperty('border-radius', '50%', 'important');
		btn.style.setProperty('box-sizing', 'border-box', 'important');
		btn.style.setProperty('flex-shrink', '0', 'important');
		if (color === colors[0]) btn.classList.add('hwm_active');
		colorBtns.push(btn);
	}

	toolbar.createDiv({ cls: 'hwm_separator' });

	// Helper: aggiorna min-width sui pallini colore in base alla modalità compatta.
	// Necessario perché min-width è impostato via JS con !important (per Android)
	// e non può essere sovrascritto da CSS — va gestito via JS.
	const updateColorBtnSizes = (compact: boolean) => {
		colorBtns.forEach(b => {
			// In compact: i pallini non attivi devono collassare a 0
			const isActive = b.classList.contains('hwm_active');
			const size = (!compact || isActive) ? '22px' : '0';
			b.style.setProperty('min-width', size, 'important');
			b.style.setProperty('min-height', size, 'important');
		});
	};

	// Stato iniziale min-width: se mobile (parte compatta), i pallini non attivi partono a 0
	if (isMobile) updateColorBtnSizes(true);

	// --- Undo / Redo / Clear ---
	// Stesse icone SVG inline su Windows e Android (nessuna dipendenza da Lucide bundled)
	const undoBtn = createBtn(toolbar, 'rotate-ccw', 'Annulla (Undo)');
	undoBtn.classList.add('hwm_undo-btn');
	const redoBtn = createBtn(toolbar, 'rotate-cw', 'Ripristina (Redo)');
	redoBtn.classList.add('hwm_redo-btn');
	const clearBtn = createBtn(toolbar, 'trash', 'Cancella tutto');
	clearBtn.classList.add('hwm_clear-btn');

	toolbar.createDiv({ cls: 'hwm_separator' });

	// --- Converti in Markdown ---
	const convertBtn = createBtn(toolbar, 'file-text', 'Converti in Markdown');
	convertBtn.classList.add('hwm_convert-btn');

	// --- Salva ---
	const saveBtn = createBtn(toolbar, 'save', 'Salva');
	saveBtn.classList.add('hwm_save-btn');

	// --- Elimina riquadro ---
	const deleteBtn = createBtn(toolbar, 'x', 'Elimina riquadro');
	deleteBtn.classList.add('hwm_delete-btn');

	// --- Canvas ---
	const canvasWrap = container.createDiv({ cls: 'hwm_canvas-wrap' });
	const { canvasWidth, canvasHeight } = plugin.settings;
	// Usa l'altezza salvata se disponibile (per canvas espansi)
	// canvasHeight = default settings, savedHeight = altezza dal SVG (può essere espanso)
	const height = savedHeight ?? canvasHeight;
	// Se debugMode è attivo, ogni evento IME/touch mostra una Notice in tempo reale
	const debugFn = plugin.settings.debugMode
		? (msg: string) => new Notice(msg, 3000)
		: null;
	const canvas = new DrawingCanvas(canvasWrap, canvasWidth, height, canvasHeight, isMobile, debugFn);

	// Imposta colori sfondo e righe dalle settings
	const bgColor = getEffectiveBgColor(plugin.settings);
	const lineColor = getEffectiveLineColor(plugin.settings);
	canvas.setBackground(bgColor, lineColor);
	// Colore penna di default adattato al tema
	canvas.setColor(colors[0]!);

	// Applica sfondo anche al container CSS
	container.style.backgroundColor = bgColor;

	// Carica tratti esistenti, rimappando i colori al tema corrente
	if (strokes.length > 0) {
		const remapped = strokes.map(s => ({
			...s,
			color: remapStrokeColor(s.color, plugin.settings.bgMode)
		}));
		canvas.loadStrokes(remapped);
		// Ri-salva l'SVG con colori e sfondo aggiornati
		saveToSvg(canvas, data, plugin);
	}

	// --- Handle di resize in basso (colori adattati al tema) ---
	const resizeHandle = container.createDiv({ cls: 'hwm_resize-handle' });
	resizeHandle.createEl('span', { text: '⋯' });
	if (isDark) {
		resizeHandle.style.background = '#2a2a2a';
		resizeHandle.style.borderTopColor = '#444';
		resizeHandle.style.color = '#888';
	}
	setupResizeHandle(resizeHandle, canvas);

	// --- Event handlers ---

	// Penna / Gomma
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

	// Colori
	for (let i = 0; i < colorBtns.length; i++) {
		const btn = colorBtns[i]!;
		const color = colors[i]!;
		btn.addEventListener('click', () => {
			colorBtns.forEach(b => b.classList.remove('hwm_active'));
			btn.classList.add('hwm_active');
			canvas.setColor(color);
			// Aggiorna min-width: il nuovo pallino attivo torna a 22px,
			// gli altri restano collassati se siamo in compact mode
			if (isMobile) {
				updateColorBtnSizes(toolbar.classList.contains('hwm_toolbar--compact'));
			}
		});
	}

	// Undo / Redo / Clear
	undoBtn.addEventListener('click', () => canvas.undo());
	redoBtn.addEventListener('click', () => canvas.redo());
	clearBtn.addEventListener('click', () => canvas.clear());

	// Converti in Markdown: SVG → PNG base64 → Gemini OCR → parser → sostituisce code block
	convertBtn.addEventListener('click', async () => {
		const strokes = canvas.getStrokes();
		if (strokes.length === 0) {
			new Notice('Nessun tratto da convertire');
			return;
		}

		try {
			new Notice('Riconoscimento in corso…');

			// 1. Genera la stringa SVG dai tratti correnti del canvas
			const svgString = strokesToSvg(
				strokes,
				canvas.getWidth(),
				canvas.getHeight(),
				canvas.getBgColor(),
				canvas.getLineColor()
			);

			// 2. Parsa la stringa SVG in un elemento DOM per la conversione
			const parser = new DOMParser();
			const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
			const svgEl = svgDoc.documentElement as unknown as SVGElement;

			// 3. Converte l'SVG in PNG base64 tramite un canvas HTML temporaneo
			const base64 = await svgToBase64Png(svgEl);

			// 4. Invia l'immagine a Gemini per il riconoscimento OCR
			const recognizer = getRecognizer(plugin.settings.geminiApiKey, plugin.settings.ocrLanguages);
			const rawText = await recognizer.recognize(base64);

			if (!rawText.trim()) {
				new Notice('Nessun testo riconosciuto');
				return;
			}

			// 5. Converte il testo grezzo in markdown strutturato
			const markdown = parseMarkdown(rawText);

			// 6. Sposta l'SVG nella cartella _converted con nome data-ora
			await archiveSvg(data, plugin);

			// 7. Sostituisce il code block handwriting con il testo markdown
			canvas.destroy();
			await replaceEmbedWithMarkdown(ctx, data, markdown, plugin);

			new Notice('Conversione completata!');
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice('Errore OCR: ' + msg);
		}
	});

	// Salva SVG su disco
	saveBtn.addEventListener('click', async () => {
		await saveToSvg(canvas, data, plugin);
	});

	// Elimina: rimuove il code block dal file markdown e cancella l'SVG
	deleteBtn.addEventListener('click', async () => {
		const confirmed = confirm('Eliminare questo riquadro handwriting e il file SVG associato?');
		if (!confirmed) return;
		canvas.destroy();
		await removeEmbed(ctx, data, plugin);
	});

	// Auto-save debounced: salva automaticamente 2 secondi dopo l'ultimo cambiamento
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	canvas.onChange(() => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			await saveToSvg(canvas, data, plugin);
		}, 2000);
	});
}

/* ---------- Resize handle ---------- */

// Permette di trascinare il bordo inferiore per ridimensionare il canvas
function setupResizeHandle(handle: HTMLElement, canvas: DrawingCanvas) {
	let startY = 0;
	let startHeight = 0;

	const onPointerMove = (e: PointerEvent) => {
		e.preventDefault();
		const delta = e.clientY - startY;
		const newHeight = Math.max(100, startHeight + delta);
		canvas.resizeHeight(newHeight);
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

/* ---------- File I/O ---------- */

// Carica il file SVG e ne estrae i tratti + altezza canvas
async function loadSvgData(
	svgPath: string,
	plugin: HandwritingPlugin
): Promise<{ strokes: Stroke[]; canvasHeight: number | null }> {
	const file = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (file instanceof TFile) {
		const content = await plugin.app.vault.read(file);
		const strokes = parseSvgStrokes(content);
		// Estrai altezza dal viewBox dell'SVG per mantenere canvas espansi
		const heightMatch = content.match(/viewBox="0 0 \d+ (\d+)"/);
		const canvasHeight = heightMatch ? parseInt(heightMatch[1] ?? '0') : null;
		return { strokes, canvasHeight };
	}
	return { strokes: [], canvasHeight: null };
}

// Salva i tratti come file SVG nel vault
async function saveToSvg(
	canvas: DrawingCanvas,
	data: EmbedData,
	plugin: HandwritingPlugin
) {
	const strokes = canvas.getStrokes();
	const width = canvas.getWidth();
	const height = canvas.getHeight();
	const svg = strokesToSvg(strokes, width, height, canvas.getBgColor(), canvas.getLineColor());

	// Crea la cartella se non esiste
	const folderPath = data.svg.substring(0, data.svg.lastIndexOf('/'));
	if (folderPath) {
		const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) {
			await plugin.app.vault.createFolder(folderPath);
		}
	}

	// Scrivi o aggiorna il file SVG
	const existing = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (existing instanceof TFile) {
		await plugin.app.vault.modify(existing, svg);
	} else {
		await plugin.app.vault.create(data.svg, svg);
	}
}

/* ---------- Elimina embed ---------- */

// Rimuove il code block dal file markdown e cancella il file SVG
async function removeEmbed(
	ctx: MarkdownPostProcessorContext,
	data: EmbedData,
	plugin: HandwritingPlugin
) {
	// Trova il file markdown che contiene il code block
	const mdFile = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(mdFile instanceof TFile)) {
		new Notice('File markdown non trovato');
		return;
	}

	// Leggi il contenuto e trova il code block da rimuovere
	const content = await plugin.app.vault.read(mdFile);
	// Cerca il blocco ```handwriting con l'id corrispondente
	const pattern = new RegExp(
		'\\n?```handwriting\\n.*?"id"\\s*:\\s*"' + escapeRegex(data.id) + '".*?\\n```\\n?',
		's'
	);
	const newContent = content.replace(pattern, '\n');

	if (newContent !== content) {
		await plugin.app.vault.modify(mdFile, newContent);
	}

	// Cancella il file SVG associato
	const svgFile = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (svgFile instanceof TFile) {
		await plugin.app.vault.delete(svgFile);
	}

	new Notice('Riquadro eliminato');
}

// Escape caratteri speciali per regex
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------- Archivia SVG dopo conversione ---------- */

// Rinomina e sposta l'SVG in _handwriting/_converted/AAAA-MM-GG_HH-MM-SS.svg
async function archiveSvg(data: EmbedData, plugin: HandwritingPlugin) {
	const svgFile = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (!(svgFile instanceof TFile)) return;

	// Costruisce il timestamp nel formato 2026-03-08_14-30-00
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

	// Cartella destinazione: _handwriting/_converted/
	const destFolder = `${plugin.settings.svgFolder}/_converted`;
	if (!plugin.app.vault.getAbstractFileByPath(destFolder)) {
		await plugin.app.vault.createFolder(destFolder);
	}

	// Sposta il file con il nuovo nome
	await plugin.app.vault.rename(svgFile, `${destFolder}/${timestamp}.svg`);
}

/* ---------- Sostituisce il code block con il markdown convertito ---------- */

// Trova il blocco ```handwriting con l'id corrispondente e lo rimpiazza con il testo markdown
async function replaceEmbedWithMarkdown(
	ctx: MarkdownPostProcessorContext,
	data: EmbedData,
	markdown: string,
	plugin: HandwritingPlugin
) {
	const mdFile = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(mdFile instanceof TFile)) {
		new Notice('File markdown non trovato');
		return;
	}

	const content = await plugin.app.vault.read(mdFile);
	// Cerca il blocco ```handwriting con questo specifico id
	const pattern = new RegExp(
		'\\n?```handwriting\\n.*?"id"\\s*:\\s*"' + escapeRegex(data.id) + '".*?\\n```\\n?',
		's'
	);
	const newContent = content.replace(pattern, '\n' + markdown + '\n');

	if (newContent !== content) {
		await plugin.app.vault.modify(mdFile, newContent);
	}
}

/* ---------- Comando: inserisci nuovo blocco ---------- */

export function insertHandwritingBlock(plugin: HandwritingPlugin) {
	const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		new Notice('Apri un file markdown prima');
		return;
	}

	const editor = view.editor;
	const id = generateId();
	const svgPath = `${plugin.settings.svgFolder}/${id}.svg`;

	const block = `\n\`\`\`handwriting\n{"id":"${id}","svg":"${svgPath}"}\n\`\`\`\n`;
	editor.replaceSelection(block);
}

/* ---------- Helpers ---------- */

function createBtn(parent: HTMLElement, icon: string, title: string): HTMLElement {
	const btn = parent.createEl('button', {
		cls: 'hwm_btn',
		attr: { title }
	});
	// Usa SVG inline dalla mappa ICONS — identico su Windows e Android,
	// nessuna dipendenza da setIcon/Lucide bundled
	btn.innerHTML = ICONS[icon] ?? '';
	return btn;
}

// Converte un SVGElement in immagine PNG base64 tramite un canvas HTML temporaneo.
// Serializza l'SVG in un Blob → URL oggetto → disegna su canvas → estrae base64.
function svgToBase64Png(svgElement: SVGElement): Promise<string> {
	return new Promise((resolve, reject) => {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		const img = new Image();

		// Serializza l'SVGElement in testo e crea un URL temporaneo
		const svgBlob = new Blob(
			[new XMLSerializer().serializeToString(svgElement)],
			{ type: 'image/svg+xml' }
		);
		const url = URL.createObjectURL(svgBlob);

		img.onload = () => {
			canvas.width = img.width;
			canvas.height = img.height;
			ctx.drawImage(img, 0, 0);
			// Libera l'URL temporaneo e restituisce solo la parte base64 (senza prefisso "data:...")
			URL.revokeObjectURL(url);
			resolve(canvas.toDataURL('image/png').split(',')[1]!);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Errore conversione SVG → PNG'));
		};
		img.src = url;
	});
}
