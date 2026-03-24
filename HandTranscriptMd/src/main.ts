/* =============================================
   Handwriting to Markdown — Plugin Entry Point

   Registra:
   - Code block processor "handwriting" (embed inline)
   - Comando per inserire un nuovo blocco handwriting
   - Tab impostazioni
   ============================================= */

import { Plugin, TFile, TFolder, Notice, FuzzySuggestModal, FuzzyMatch, MarkdownView, Editor } from 'obsidian';
import { t, setLocale } from './i18n';
import { DEFAULT_SETTINGS, HandwritingSettings, HandwritingSettingTab } from './settings';
import { registerEmbed, insertHandwritingBlock } from './embed';
import { VIEW_TYPE_HANDWRITING, DrawingEditorView } from './editor-view';

export default class HandwritingPlugin extends Plugin {
	settings: HandwritingSettings;

	// Mappa di callback per aggiornare le preview inline quando l'editor tab salva
	public previewCallbacks = new Map<string, (svgContent: string) => void>();

	// Mappa embedId → svgPath: permette di trovare i file SVG da rimappare al cambio bgMode
	public embedPaths = new Map<string, string>();

	// Callback notificate quando l'utente cambia bgMode nelle impostazioni
	public bgModeListeners = new Set<(bgMode: string) => void>();

	// Mappa embedId → azioni (expand/collapse/convert): usata dal menu "⋮" di Obsidian
	public embedActions = new Map<string, {
		expand:     () => void;
		collapse:   () => void;
		convert:    () => Promise<void>;
		container:  HTMLElement;
		sourcePath: string;
	}>();

	// Invocato dall'editor tab dopo ogni salvataggio per aggiornare la preview inline
	refreshPreview(id: string, svgContent: string) {
		this.previewCallbacks.get(id)?.(svgContent);
	}

	// Chiamato da settings quando l'utente cambia bgMode:
	// notifica pannelli (aggiornamento classe dark) e SVG attivi (remap colori)
	notifyBgModeChange() {
		this.bgModeListeners.forEach(cb => cb(this.settings.bgMode));
	}

	async onload() {
		await this.loadSettings();

		// Applica la lingua interfaccia salvata (o la lingua di sistema se 'auto')
		setLocale(this.settings.uiLanguage);

		// Rileva cambio tema Obsidian (aggiunta/rimozione classe 'theme-dark' sul body).
		// Se bgMode è 'auto', notifica tutti i listener per aggiornare colori e SVG.
		const themeObserver = new MutationObserver(() => {
			if (this.settings.bgMode === 'auto') this.notifyBgModeChange();
		});
		themeObserver.observe(document.body, { attributeFilter: ['class'] });
		this.register(() => themeObserver.disconnect());

		// Registra la vista editor (tab dedicata per il disegno)
		this.registerView(VIEW_TYPE_HANDWRITING, (leaf) => new DrawingEditorView(leaf, this));

		// Registra il code block processor per ```handwriting
		registerEmbed(this);

		// Comando: inserisce un nuovo blocco handwriting nel file corrente
		this.addCommand({
			id: 'insert-handwriting',
			name: 'Insert handwriting block',
			icon: 'pencil',
			editorCallback: async () => {
				await insertHandwritingBlock(this);
			}
		});

		// Comando: inserisce un riferimento a un SVG esistente nella cartella handwriting
		this.addCommand({
			id: 'insert-svg-reference',
			name: 'Insert SVG reference',
			icon: 'file-plus',
			editorCallback: (editor: Editor) => {
				new SvgReferenceSuggest(this.app, this, editor).open();
			}
		});

		// Icona nella ribbon (sidebar sinistra)
		this.addRibbonIcon('pencil', 'Insert handwriting', async () => {
			await insertHandwritingBlock(this);
		});

		// Tab impostazioni
		this.addSettingTab(new HandwritingSettingTab(this.app, this));

		// Voci nel menu "⋮" (tre puntini) di Obsidian per operazioni su tutti i disegni.
		// Vengono aggiunte con setSection('danger') e poi spostate prima di "Elimina file"
		// tramite (menu as any).items — l'unico modo per posizionarle nell'ultima sezione
		// sopra Delete senza usare API private più instabili.
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				menu.addItem(item => item
					.setTitle(t('menu_expand_all'))
					.setIcon('chevrons-down')
					.setSection('danger')
					.onClick(() => {
						this.getActiveEmbeds(file.path).forEach(a => a.expand());
					})
				);
				menu.addItem(item => item
					.setTitle(t('menu_collapse_all'))
					.setIcon('chevrons-up')
					.setSection('danger')
					.onClick(() => {
						this.getActiveEmbeds(file.path).forEach(a => a.collapse());
					})
				);
				menu.addItem(item => item
					.setTitle(t('menu_convert_all'))
					.setIcon('file-text')
					.setSection('danger')
					.onClick(async () => {
						try {
							// Sequenziale: si ferma al primo errore
							for (const actions of this.getActiveEmbeds(file.path)) {
								await actions.convert();
							}
						} catch (e: unknown) {
							new Notice(t('error_conversion') + (e instanceof Error ? e.message : String(e)));
						}
					})
				);
				// Sposta le 3 voci appena aggiunte prima del primo item 'danger' esistente
				// (cioè prima di "Elimina file"), in modo che compaiano sopra di esso.
				const items: Array<{ section: string }> = (menu as any).items;
				const added = items.splice(items.length - 3, 3);
				const firstDangerIdx = items.findIndex(i => i.section === 'danger');
				items.splice(firstDangerIdx >= 0 ? firstDangerIdx : items.length, 0, ...added);
			})
		);
	}

	// Restituisce gli embed attivi (container nel DOM) appartenenti al file indicato.
	// Rimuove dalla mappa gli embed il cui container non è più nel DOM.
	private getActiveEmbeds(filePath: string) {
		const result: Array<{ expand: () => void; collapse: () => void; convert: () => Promise<void> }> = [];
		for (const [id, actions] of this.embedActions) {
			if (!actions.container.isConnected) {
				this.embedActions.delete(id);
				continue;
			}
			if (actions.sourcePath === filePath) result.push(actions);
		}
		return result;
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<HandwritingSettings>
		);
		// Migrazione: 'custom' non esiste più → 'auto'
		if ((this.settings.bgMode as string) === 'custom') {
			this.settings.bgMode = 'auto';
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// Modal fuzzy-search per selezionare un SVG esistente nella cartella handwriting
// e inserire il riferimento ![[path]] nel cursore dell'editor attivo.
class SvgReferenceSuggest extends FuzzySuggestModal<TFile> {
	constructor(
		app: import('obsidian').App,
		private plugin: HandwritingPlugin,
		private editor: Editor
	) {
		super(app);
		this.setPlaceholder('Cerca SVG...');
	}

	// Restituisce tutti gli SVG nella cartella impostata (esclusa _converted)
	getItems(): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(this.plugin.settings.svgFolder);
		if (!(folder instanceof TFolder)) return [];
		return folder.children.filter(
			(f): f is TFile =>
				f instanceof TFile &&
				f.extension === 'svg' &&
				!f.path.includes('/_converted/')
		);
	}

	// Testo usato per il fuzzy-match (nome file)
	getItemText(file: TFile): string {
		return file.name;
	}

	// Mostra thumbnail SVG + nome file invece del solo testo
	renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		const file = match.item;
		el.addClass('hwm_svg-suggest-item');
		// Thumbnail SVG tramite resource URL del vault
		const img = el.createEl('img', { cls: 'hwm_svg-thumb' });
		img.src = this.app.vault.getResourcePath(file);
		el.createEl('span', { text: file.name, cls: 'hwm_svg-suggest-name' });
	}

	// Inserisce ![[path]] al cursore quando l'utente seleziona un file
	onChooseItem(file: TFile): void {
		this.editor.replaceSelection(`![[${file.path}]]`);
	}
}
