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
	MarkdownPostProcessorContext,
	MarkdownView,
	TFile,
	Notice,
	Platform,
} from 'obsidian';

// Icone SVG inline (stile Lucide 24×24)
const ICONS: Record<string, string> = {
	'file-text':   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
	'x':           `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
	'file-x':      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9.5" y1="12.5" x2="14.5" y2="17.5"/><line x1="14.5" y1="12.5" x2="9.5" y2="17.5"/></svg>`,
	'chevron-up':  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
	'pencil':      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
};
import type HandwritingPlugin from './main';
import { t } from './i18n';
import { Stroke } from './drawing-canvas';
import { strokesToSvg, parseSvgStrokes, generateId, svgToBase64Png, archiveSvgFile } from './svg-utils';
import { getEffectiveBgColor, getEffectiveLineColor, remapStrokeColor, BgMode, resolveIsDark } from './settings';
import { getRecognizer } from './recognizer';
import { parseHandwritingToMarkdown } from './md-parser';
import { VIEW_TYPE_HANDWRITING, DrawingEditorView, DrawingModal } from './editor-view';

// Dati JSON salvati dentro il code block ```handwriting (formato legacy)
interface EmbedData {
	id: string;
	svg: string; // percorso relativo al file SVG nel vault
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
			const svgWidth = dimMatch ? parseInt(dimMatch[1]!) : plugin.settings.canvasWidth;
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
		if (!embedId.startsWith('hw_') && !embedId.startsWith('HTMD_')) return;

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
	// Parsa il JSON dal code block
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

	const deleteBtn = createBtn(btnBar, 'file-x', 'Elimina riquadro');
	deleteBtn.classList.add('hwm_delete-btn');

	const convertBtn = createBtn(btnBar, 'file-text', 'Converti in Markdown');
	convertBtn.classList.add('hwm_convert-btn');

	const collapseBtn = createBtn(btnBar, 'chevron-up', 'btn_collapse');
	collapseBtn.classList.add('hwm_collapse-btn');

	// --- Preview SVG via CSS background-image (nessun <img> dentro cm-content) ---
	const preview = container.createDiv({ cls: 'hwm_inline-preview' });
	let isExpanded = true;

	let currentSvgContent = svgContent;
	let currentStrokes = strokes;

	renderPreviewContent(preview, currentSvgContent);

	// Callback refresh dalla tab editor
	plugin.previewCallbacks.set(data.id, (newSvgContent) => {
		if (!preview.isConnected) return;
		currentSvgContent = newSvgContent;
		currentStrokes = parseSvgStrokes(newSvgContent);
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
			collapseBtn.title = t('btn_collapse');
			collapseBtn.setAttribute('data-hwm-key', 'btn_collapse');
		} else {
			preview.classList.add('hwm_collapsed');
			preview.style.maxHeight = collapsedHeight + 'px';
			collapseBtn.classList.add('hwm_rotated');
			collapseBtn.title = t('btn_expand');
			collapseBtn.setAttribute('data-hwm-key', 'btn_expand');
		}
	});

	// Bottone matita portale (fuori da cm-content)
	createLegacyPortalButton(container, plugin.app, plugin, data.id, data.svg, ctx.sourcePath);

	// Converti
	convertBtn.addEventListener('click', async (e) => {
		e.stopPropagation();
		if (!currentSvgContent || currentStrokes.length === 0) {
			new Notice(t('error_no_strokes'));
			return;
		}
		await doConvert(currentSvgContent, data, ctx, plugin);
	});

	// Elimina
	deleteBtn.addEventListener('click', async (e) => {
		e.stopPropagation();
		if (!await showInlineConfirm(container, t('confirm_delete'))) return;
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
		preview.createDiv({ cls: 'hwm_placeholder', text: t('notice_placeholder_draw') });
	}
}

/* =============================================
   Pipeline OCR comune (wiki + legacy)
   ============================================= */

// Esegue il riconoscimento OCR su un SVG e restituisce il testo markdown.
// Lancia eccezione in caso di errore — il chiamante decide se catturarla o propagarla.
async function runOcrPipeline(svgContent: string, plugin: HandwritingPlugin): Promise<string> {
	new Notice(t('notice_recognizing'));
	const svgEl = new DOMParser()
		.parseFromString(svgContent, 'image/svg+xml')
		.documentElement as unknown as SVGElement;
	const base64     = await svgToBase64Png(svgEl);
	const recognizer = getRecognizer(plugin.settings.geminiApiKey, plugin.settings.ocrLanguages);
	const rawText    = await recognizer.recognize(base64);
	if (!rawText.trim()) throw new Error(t('error_no_text'));
	// In modalità debug mostra il testo grezzo restituito da Gemini (prima del parsing)
	if (plugin.settings.debugMode) new Notice(`[DEBUG] Testo grezzo Gemini:\n${rawText}`, 30000);
	return parseHandwritingToMarkdown(rawText);
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
	const markdown = await runOcrPipeline(svgContent, plugin);
	await archiveSvgFile(svgPath, plugin);
	await replaceWikiEmbedWithMarkdown(svgPath, markdown, sourcePath, plugin);
	new Notice(t('notice_converted'));
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
		const markdown = await runOcrPipeline(svgContent, plugin);
		await archiveSvgFile(data.svg, plugin);
		await replaceEmbedWithMarkdown(ctx, data, markdown, plugin);
		new Notice(t('notice_converted'));
	} catch (e: unknown) {
		new Notice(t('error_ocr') + (e instanceof Error ? e.message : String(e)));
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
	if (!(mdFile instanceof TFile)) { new Notice(t('error_file_not_found')); return; }

	const content = await plugin.app.vault.read(mdFile);
	const updated = content.replace(wikiEmbedRegex(svgPath), '\n');
	if (updated !== content) await plugin.app.vault.modify(mdFile, updated);

	// Cancella il file SVG
	const svgFile = plugin.app.vault.getAbstractFileByPath(svgPath);
	if (svgFile instanceof TFile) await plugin.app.vault.delete(svgFile);

	new Notice(t('notice_deleted'));
}

// Rimuove il code block legacy dal .md e cancella il file SVG
async function removeLegacyEmbed(
	ctx: MarkdownPostProcessorContext,
	data: EmbedData,
	plugin: HandwritingPlugin
) {
	const mdFile = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(mdFile instanceof TFile)) { new Notice(t('error_file_not_found')); return; }

	const content = await plugin.app.vault.read(mdFile);
	const updated = content.replace(codeBlockRegex(data.id), '\n');
	if (updated !== content) await plugin.app.vault.modify(mdFile, updated);

	const svgFile = plugin.app.vault.getAbstractFileByPath(data.svg);
	if (svgFile instanceof TFile) await plugin.app.vault.delete(svgFile);

	new Notice(t('notice_deleted'));
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
	if (!(mdFile instanceof TFile)) { new Notice(t('error_file_not_found')); return; }

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
	if (!(mdFile instanceof TFile)) { new Notice(t('error_file_not_found')); return; }

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
	if (!view) {
		new Notice(t('notice_open_md_first'));
		return;
	}

	const editor = view.editor;
	const id = generateId();
	const svgPath = `${plugin.settings.svgFolder}/${id}.svg`;

	// Crea il file SVG vuoto PRIMA di inserire il wikilink nel markdown.
	// Se il file non esiste quando Obsidian processa ![[svg]], mostra
	// "could not be found" e non renderizza image-embed → il post-processor
	// non trova nulla da decorare e i bottoni non appaiono.
	const bgColor = getEffectiveBgColor(plugin.settings);
	const lineColor = getEffectiveLineColor(plugin.settings);
	const emptySvg = strokesToSvg([], plugin.settings.canvasWidth, plugin.settings.canvasHeight, bgColor, lineColor);

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
	const pencilBtn = createPanelBtn(panel, 'pencil', 'btn_open_editor');
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
			const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING);
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
	const convertBtn = createPanelBtn(panel, 'file-text', 'btn_convert');

	// --- Bottone comprimi/espandi ---
	// Usa height + overflow:hidden sul container (non max-height sull'<img>):
	// così l'immagine viene ritagliata verticalmente senza che la larghezza cambi.
	// Il pannello (position:absolute, top:6px) resta dentro l'area visibile
	// anche da compresso (collapsedHeight è sempre >> 6px + altezza pannello).
	const collapseBtn = createPanelBtn(panel, 'chevron-up', 'btn_collapse');
	collapseBtn.classList.add('hwm_collapse-btn');

	// --- Bottone elimina ---
	const deleteBtn = createPanelBtn(panel, 'file-x', 'btn_delete');
	deleteBtn.classList.add('hwm_delete-btn');
	deleteBtn.addEventListener('click', async () => {
		if (!await showInlineConfirm(container, t('confirm_delete'))) return;
		await removeWikiEmbed(svgPath, sourcePath, plugin);
	});

	// --- Funzioni condivise: usate dai bottoni e dal menu globale (⋮ Obsidian) ---
	// Assicura che l'<img> sia dentro un div.hwm_clip-wrapper.
	// Animiamo solo il wrapper (non il container span) così il ResizeObserver
	// di Obsidian Mobile sul container non si attiva e non re-imposta le dimensioni dell'img.
	// Usiamo img.parentElement come anchor per insertBefore: su Android l'img
	// potrebbe non essere figlia diretta del container span.
	const ensureWrapper = (): HTMLElement | null => {
		let wrapper = container.querySelector('.hwm_clip-wrapper') as HTMLElement | null;
		if (wrapper) return wrapper;
		const img = container.querySelector('img');
		if (!img || !img.parentElement) return null;
		wrapper = document.createElement('div');
		wrapper.className = 'hwm_clip-wrapper';
		img.parentElement.insertBefore(wrapper, img);
		wrapper.appendChild(img);
		return wrapper;
	};

	const doExpand = () => {
		isExpanded = true;
		const wrapper = container.querySelector('.hwm_clip-wrapper') as HTMLElement | null;
		if (wrapper) {
			// Anima da collapsedHeight verso l'altezza naturale (scrollHeight)
			wrapper.style.height = wrapper.scrollHeight + 'px';
			// A transizione finita rimuovi l'altezza esplicita: il wrapper torna flessibile
			wrapper.addEventListener('transitionend', () => {
				wrapper.style.height   = '';
				wrapper.style.overflow = '';
			}, { once: true });
		}
		container.classList.remove('hwm_is-collapsed');
		collapseBtn.classList.remove('hwm_rotated');
		collapseBtn.title = t('btn_collapse');
		collapseBtn.setAttribute('data-hwm-key', 'btn_collapse');
	};
	const doCollapse = () => {
		isExpanded = false;
		const wrapper = ensureWrapper();
		if (wrapper) {
			wrapper.style.overflow = 'hidden';
			// Prima forza un'altezza esplicita pari all'altezza attuale (altrimenti
			// la transizione partirebbe da 'auto' e non si animarebbe)
			wrapper.style.height = wrapper.scrollHeight + 'px';
			// Nel frame successivo imposta l'altezza target: la transizione CSS scatta
			requestAnimationFrame(() => {
				wrapper.style.height = collapsedHeight + 'px';
			});
		}
		container.classList.add('hwm_is-collapsed');
		collapseBtn.classList.add('hwm_rotated');
		collapseBtn.title = t('btn_expand');
		collapseBtn.setAttribute('data-hwm-key', 'btn_expand');
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

// Overlay di conferma inline su un elemento position:relative.
// Evita window.confirm() che in Electron ruba il focus dalla finestra.
function showInlineConfirm(anchorEl: HTMLElement, msg: string): Promise<boolean> {
	return new Promise(resolve => {
		const overlay = anchorEl.createDiv({ cls: 'hwm_confirm-overlay' });
		overlay.createEl('span', { text: msg, cls: 'hwm_confirm-msg' });
		const okBtn = overlay.createEl('button', { text: t('confirm_ok'), cls: 'mod-warning' });
		const cancelBtn = overlay.createEl('button', { text: t('confirm_cancel') });
		okBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
		cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });
		okBtn.focus();
	});
}

// Crea un bottone div nel pannello portale.
// key: chiave i18n — usata sia per il title che per data-hwm-key (aggiornamento live al cambio lingua)
function createPanelBtn(parent: HTMLElement, icon: string, key: string): HTMLElement {
	const btn = document.createElement('div');
	btn.className = 'hwm_btn';
	btn.setAttribute('title', t(key as any));
	btn.setAttribute('data-hwm-key', key);
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
	btn.title = t('btn_open_editor');
	document.body.appendChild(btn);

	// Apre la tab editor al click
	btn.addEventListener('click', async () => {
		const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING);
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
		btn.style.top = (rect.top + 6) + 'px';
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
// key: chiave i18n — usata sia per il title che per data-hwm-key (aggiornamento live al cambio lingua)
function createBtn(parent: HTMLElement, icon: string, key: string): HTMLElement {
	const btn = parent.createDiv({ cls: 'hwm_btn', attr: { title: t(key as any), role: 'button', tabindex: '0' } });
	btn.setAttribute('data-hwm-key', key);
	btn.innerHTML = ICONS[icon] ?? '';
	return btn;
}

