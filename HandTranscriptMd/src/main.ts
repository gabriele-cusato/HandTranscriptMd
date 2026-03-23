/* =============================================
   Handwriting to Markdown — Plugin Entry Point

   Registra:
   - Code block processor "handwriting" (embed inline)
   - Comando per inserire un nuovo blocco handwriting
   - Tab impostazioni
   ============================================= */

import { Plugin, TFile, Notice } from 'obsidian';
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
			editorCallback: async () => {
				await insertHandwritingBlock(this);
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
					.setTitle('Espandi tutti i disegni')
					.setIcon('chevrons-down')
					.setSection('danger')
					.onClick(() => {
						this.getActiveEmbeds(file.path).forEach(a => a.expand());
					})
				);
				menu.addItem(item => item
					.setTitle('Collassa tutti i disegni')
					.setIcon('chevrons-up')
					.setSection('danger')
					.onClick(() => {
						this.getActiveEmbeds(file.path).forEach(a => a.collapse());
					})
				);
				menu.addItem(item => item
					.setTitle('Converti tutti i disegni in testo')
					.setIcon('file-text')
					.setSection('danger')
					.onClick(async () => {
						try {
							// Sequenziale: si ferma al primo errore
							for (const actions of this.getActiveEmbeds(file.path)) {
								await actions.convert();
							}
						} catch (e: unknown) {
							new Notice('Errore nella conversione: ' + (e instanceof Error ? e.message : String(e)));
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
