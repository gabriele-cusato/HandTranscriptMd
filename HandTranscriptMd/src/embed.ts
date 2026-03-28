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
	setIcon,
} from 'obsidian';
import type HandwritingPlugin from './main';
import { t, type I18nKey } from './i18n';
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
	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	plugin.bgModeListeners.add(onBgModeRemap);
	// eslint-disable-next-line @typescript-eslint/no-misused-promises
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

		// pointer-events: none sullo span: gestito dalla regola CSS
		// .internal-embed[data-hwm-decorated="1"] — non serve inline style.

		// NESSUNA modifica allo span dentro cm-content.
		// Lo lasciamo identico a un'immagine normale: nessuna classe extra,
		// nessun figlio aggiunto. Questo evita di rompere l'handwriting Android
		// (il contenteditable="false" + figli extra confondono il hit-test di Chrome).
		// Tutti i bottoni vivono in document.body via pannello portale.

		const sourcePath = resolveSourcePath(span, plugin);

		// Callback refresh: aggiorna l'<img> dopo il salvataggio dalla tab editor.
		// Strategia: tenta il Blob URL (zero flash, istantaneo su Desktop).
		// Se fallisce (CSP Android WebView blocca blob:), ricade su cache-bust URL.
		// In entrambi i casi, dopo il caricamento aggiorna l'altezza del wrapper
		// per notificare CodeMirror Live Preview del nuovo scrollHeight (Android).
		plugin.previewCallbacks.set(embedId, (svgContent: string) => {
			if (!span.isConnected) return;
			const img = span.querySelector('img');
			if (!img) return;

			// Aggiorna l'altezza del wrapper (se espanso) dopo ogni refresh dell'img.
			// Su Android, CM6 Live Preview non rileva i cambi organici di altezza.
			const syncWrapperHeight = () => {
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
				const wrapper = span.querySelector('.hwm_clip-wrapper') as HTMLElement | null;
				if (!wrapper || wrapper.classList.contains('hwm_overflow-hidden')) return;
				const newH = wrapper.scrollHeight;
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				wrapper.style.transition = 'none';
				wrapper.style.height = newH + 'px';
				requestAnimationFrame(() => {
					// eslint-disable-next-line obsidianmd/no-static-styles-assignment
					wrapper.style.height = '';
					// eslint-disable-next-line obsidianmd/no-static-styles-assignment
					wrapper.style.transition = '';
				});
			};

			// Tentativo 1: Blob URL (istantaneo, nessun flash di caricamento)
			const blob = new Blob([svgContent], { type: 'image/svg+xml' });
			const blobUrl = URL.createObjectURL(blob);
			img.src = blobUrl;

			img.addEventListener('load', () => {
				URL.revokeObjectURL(blobUrl);
				syncWrapperHeight();
			}, { once: true });

			img.addEventListener('error', () => {
				// Tentativo 2: cache-bust URL vault (Android WebView se CSP blocca blob:)
				URL.revokeObjectURL(blobUrl);
				const svgFile = plugin.app.vault.getAbstractFileByPath(svgPath);
				if (!(svgFile instanceof TFile)) return;
				const vaultUrl = plugin.app.vault.getResourcePath(svgFile);
				img.src = vaultUrl + '?t=' + Date.now();
				img.addEventListener('load', syncWrapperHeight, { once: true });
			}, { once: true });
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
		// MarkdownView è già importato — cast diretto senza as unknown
		const view = leaf.view as MarkdownView;
		if (view.contentEl?.contains(el)) {
			return view.file?.path ?? '';
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
	// Sfondo via CSS var: background-color: var(--hwm-bg) in .hwm_container
	container.setCssProps({ '--hwm-bg': bgColor });

	const collapsedHeight = plugin.settings.canvasHeight;

	// --- 3 bottoni inline ---
	const btnBar = container.createDiv({ cls: 'hwm_inline-buttons' });
	if (isDark) btnBar.classList.add('hwm_inline-buttons--dark');

	const deleteBtn = createBtn(btnBar, 'file-x', 'btn_delete');
	deleteBtn.classList.add('hwm_delete-btn');

	const convertBtn = createBtn(btnBar, 'file-text', 'btn_convert');
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

	// Collapse/Expand: max-height via CSS var --hwm-max-h su .hwm_collapsed
	collapseBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		isExpanded = !isExpanded;
		if (isExpanded) {
			preview.classList.remove('hwm_collapsed');
			collapseBtn.classList.remove('hwm_rotated');
			collapseBtn.title = t('btn_collapse');
			collapseBtn.setAttribute('data-hwm-key', 'btn_collapse');
		} else {
			preview.setCssProps({ '--hwm-max-h': collapsedHeight + 'px' });
			preview.classList.add('hwm_collapsed');
			collapseBtn.classList.add('hwm_rotated');
			collapseBtn.title = t('btn_expand');
			collapseBtn.setAttribute('data-hwm-key', 'btn_expand');
		}
	});

	// Bottone matita portale (fuori da cm-content)
	createLegacyPortalButton(container, plugin.app, plugin, data.id, data.svg, ctx.sourcePath);

	// Converti
	convertBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void (async () => {
			if (!currentSvgContent || currentStrokes.length === 0) {
				new Notice(t('error_no_strokes'));
				return;
			}
			await doConvert(currentSvgContent, data, ctx, plugin);
		})();
	});

	// Elimina
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void (async () => {
			if (!await showInlineConfirm(container, t('confirm_delete'))) return;
			await removeLegacyEmbed(ctx, data, plugin);
		})();
	});
}

// Renderizza l'SVG come CSS background-image su un <div> (legacy).
// Evita <img> dentro cm-content che possono influenzare l'handwriting Android.
function renderPreviewContent(preview: HTMLElement, svgContent: string | null) {
	preview.empty();
	if (svgContent) {
		const div = preview.createDiv({ cls: 'hwm_preview-bg' });
		// Immagine e aspect-ratio via CSS var: background-image e padding-bottom
		// sono definiti in .hwm_preview-bg come var(--hwm-bg-img) e var(--hwm-ratio)
		const m = svgContent.match(/viewBox="0 0 (\d+) (\d+)"/);
		const svgW = m ? parseInt(m[1]!) : 800;
		const svgH = m ? parseInt(m[2]!) : 300;
		div.setCssProps({
			'--hwm-bg-img': `url('data:image/svg+xml,${encodeURIComponent(svgContent)}')`,
			'--hwm-ratio':  `${svgH / svgW * 100}%`,
		});
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
		// pointer-events: none tramite classe CSS (evita stili inline)
		node.classList.add('hwm_no-pointer');
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
	// Altezza del riquadro compresso: calcolata dinamicamente in updateCollapseBtn()
	let isExpanded = true;
	// Flag per nascondere il pannello quando il modal (Desktop) è aperto
	let modalOpen = false;
	let isConverting = false; // true mentre OCR e' in corso (o errore non ancora confermato)

	// position: relative sullo span è gestita dalla regola CSS
	// .internal-embed[data-hwm-decorated="1"] — non serve inline style.

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
	pencilBtn.addEventListener('click', () => { void (async () => {
		if (Platform.isDesktop) {
			if (modalOpen) return;
			modalOpen = true;
			// Nasconde il pannello mentre il modal è aperto (altrimenti galleggerebbe sul canvas)
			panel.classList.add('hwm_hidden');
			const modal = new DrawingModal(plugin.app, plugin, embedId, svgPath, sourcePath);
			modal.onClosed = () => {
				modalOpen = false;
				if (container.isConnected) panel.classList.remove('hwm_hidden');
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
			void plugin.app.workspace.revealLeaf(leaf);
		}
	})(); });

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
	deleteBtn.addEventListener('click', () => { void (async () => {
		if (!await showInlineConfirm(container, t('confirm_delete'))) return;
		await removeWikiEmbed(svgPath, sourcePath, plugin);
	})(); });

	// --- Funzioni condivise: usate dai bottoni e dal menu globale (⋮ Obsidian) ---
	// Assicura che l'<img> sia dentro un div.hwm_clip-wrapper.
	// Animiamo il wrapper (non il container span) così il ResizeObserver
	// di Obsidian Mobile non si attiva sul container e non re-imposta le dimensioni dell'img.
	const ensureWrapper = (): HTMLElement | null => {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		let wrapper = container.querySelector('.hwm_clip-wrapper') as HTMLElement | null;
		if (wrapper) return wrapper;
		const img = container.querySelector('img');
		if (!img || !img.parentElement) return null;
		// Crea il wrapper e sposta l'img dentro: nessuna classe/altezza iniziale.
		// La transizione CSS (height 0.3s ease) è già definita in styles.css su .hwm_clip-wrapper.
		wrapper = document.createElement('div');
		wrapper.className = 'hwm_clip-wrapper';
		img.parentElement.insertBefore(wrapper, img);
		wrapper.appendChild(img);
		return wrapper;
	};

	const doExpand = () => {
		isExpanded = true;
		const wrapper = ensureWrapper();
		if (wrapper) {
			// Anima da altezza corrente (px) → altezza piena (scrollHeight).
			wrapper.style.height = wrapper.scrollHeight + 'px';
			// Cleanup: rimuove altezza fissa e overflow al termine dell'animazione.
			// Su Android WebView transitionend non è affidabile → setTimeout fallback.
			let done = false;
			const cleanup = () => {
				if (done) return;
				done = true;
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				wrapper.style.height = '';
				wrapper.classList.remove('hwm_overflow-hidden');
			};
			wrapper.addEventListener('transitionend', cleanup, { once: true });
			setTimeout(cleanup, 400); // 300ms transizione + 100ms buffer
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
			const img = container.querySelector('img');
			// Guard: controlla se il viewBox SVG è stato espanso rispetto alle impostazioni.
			// img.naturalHeight = altezza intrinseca del viewBox (in unità SVG), indipendente
			// dalla larghezza del pannello. È > settings.canvasHeight solo se il canvas
			// è stato auto-espanso durante il disegno.
			// Target collapse: altezza che l'img avrebbe se il viewBox fosse alto canvasHeight.
			// Usa img.naturalWidth (larghezza reale del SVG) invece di settings.canvasWidth
			// perché il canvas può auto-allargarsi aprendo il modal su schermi larghi.
			const naturalH = img && img.naturalWidth > 0
				? Math.round(plugin.settings.canvasHeight * img.clientWidth / img.naturalWidth)
				: plugin.settings.canvasHeight;
			const startH = wrapper.scrollHeight;
			wrapper.classList.add('hwm_overflow-hidden');
			if (startH <= naturalH) {
				// SVG non espanso: altezza già nella norma, nessuna area vuota da tagliare.
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				wrapper.style.height = startH + 'px';
			} else {
				// SVG auto-espanso: anima da startH → naturalH per nascondere l'area vuota.
				// WAAPI garantisce keyframe px→px senza dipendere da height:auto come "from".
				const anim = wrapper.animate(
					[{ height: startH + 'px' }, { height: naturalH + 'px' }],
					{ duration: 300, easing: 'ease', fill: 'forwards' }
				);
				anim.onfinish = () => {
					// eslint-disable-next-line obsidianmd/no-static-styles-assignment
					wrapper.style.height = naturalH + 'px';
					anim.cancel(); // cede il controllo all'inline style
				};
			}
		}
		container.classList.add('hwm_is-collapsed');
		collapseBtn.classList.add('hwm_rotated');
		collapseBtn.title = t('btn_expand');
		collapseBtn.setAttribute('data-hwm-key', 'btn_expand');
	};
	// Overlay di conversione: spinner mentre OCR e' in corso,
	// poi errore + OK se Gemini fallisce.
	// Nasconde il pannello portale (come modalOpen) per bloccare tutti i click.
	const showConvertOverlay = (): HTMLElement => {
		// Nasconde il pannello durante OCR: evita click sui bottoni
		panel.classList.add('hwm_hidden');
		const overlay = document.createElement('div');
		overlay.className = 'hwm_convert-overlay';
		const spinner = document.createElement('div');
		spinner.className = 'hwm_spinner';
		overlay.appendChild(spinner);
		container.appendChild(overlay);
		return overlay;
	};

	// Rimuove overlay e ripristina la visibilità del pannello portale
	const removeConvertOverlay = (overlay: HTMLElement) => {
		overlay.remove();
		if (container.isConnected) panel.classList.remove('hwm_hidden');
		isConverting = false;
	};

	// Avvia la conversione OCR con overlay. Non lancia eccezioni:
	// gli errori vengono mostrati nell'overlay stesso con pulsante OK.
	const doConvertAction = async () => {
		if (isConverting) return; // skip se gia' in corso (usato anche da 'converti tutti')
		isConverting = true;
		const overlay = showConvertOverlay();
		try {
			const { strokes, svgContent } = await loadSvgData(svgPath, plugin);
			if (!svgContent || strokes.length === 0) throw new Error(t('error_no_strokes'));
			await doConvertWiki(svgContent, svgPath, sourcePath, plugin);
			// Successo: rimuove overlay e ripristina pannello
			removeConvertOverlay(overlay);
		} catch (e: unknown) {
			// Errore: sostituisce lo spinner con messaggio + OK
			overlay.empty();
			const msg = e instanceof Error ? e.message : String(e);
			overlay.createEl('p', { text: msg, cls: 'hwm_convert-error-msg' });
			const okBtn = overlay.createEl('button', { text: 'OK', cls: 'hwm_convert-ok-btn mod-warning' });
			// L'overlay resta visibile finche' l'utente non clicca OK
			okBtn.addEventListener('click', () => removeConvertOverlay(overlay), { once: true });
		}
	};

	collapseBtn.addEventListener('click', () => {
		if (isExpanded) doCollapse(); else doExpand();
	});
	convertBtn.addEventListener('click', () => { void doConvertAction(); });

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
			panel.classList.toggle('hwm_hidden', tabOpen);
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
function createPanelBtn(parent: HTMLElement, icon: string, key: I18nKey): HTMLElement {
	const btn = document.createElement('div');
	btn.className = 'hwm_btn';
	btn.setAttribute('title', t(key));
	btn.setAttribute('data-hwm-key', key);
	btn.setAttribute('role', 'button');
	btn.setAttribute('tabindex', '0');
	// setIcon: inserisce l'SVG Lucide in modo sicuro (no innerHTML)
	setIcon(btn, icon);
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
	// setIcon: inserisce l'SVG Lucide in modo sicuro (no innerHTML)
	setIcon(btn, 'pencil');
	btn.title = t('btn_open_editor');
	document.body.appendChild(btn);

	// Apre la tab editor al click
	btn.addEventListener('click', () => { void (async () => {
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
		void plugin.app.workspace.revealLeaf(leaf);
	})(); });

	// RAF loop: aggiorna posizione e visibilità via CSS var (--hwm-top, --hwm-left)
	// e classe .hwm_hidden per nascondere quando fuori viewport o editor aperto.
	const update = () => {
		if (!container.isConnected) {
			btn.remove();
			return;
		}
		const rect = container.getBoundingClientRect();
		// Posizione via CSS var: top e left definiti in .hwm_portal-btn come var(--hwm-top/left)
		btn.setCssProps({
			'--hwm-top':  `${rect.top + 6}px`,
			'--hwm-left': `${rect.right - 44}px`,
		});
		const editorOpen = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING)
			.some(l => (l.view as DrawingEditorView).getEmbedId() === embedId);
		const inViewport = rect.width > 0 && rect.top < window.innerHeight && rect.bottom > 0;
		btn.classList.toggle('hwm_hidden', !(inViewport && !editorOpen));
		requestAnimationFrame(update);
	};
	requestAnimationFrame(update);
}

// Usa <div> invece di <button> per i bottoni dentro cm-content.
// I <button> su Android Mobile possono interferire con l'handwriting.
// key: chiave i18n — usata sia per il title che per data-hwm-key (aggiornamento live al cambio lingua)
function createBtn(parent: HTMLElement, icon: string, key: I18nKey): HTMLElement {
	const btn = parent.createDiv({ cls: 'hwm_btn', attr: { title: t(key), role: 'button', tabindex: '0' } });
	btn.setAttribute('data-hwm-key', key);
	// setIcon: inserisce l'SVG Lucide in modo sicuro (no innerHTML)
	setIcon(btn, icon);
	return btn;
}

