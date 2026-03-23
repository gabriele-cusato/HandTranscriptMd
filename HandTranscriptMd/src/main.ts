/* =============================================
   Handwriting to Markdown — Plugin Entry Point

   Registra:
   - Code block processor "handwriting" (embed inline)
   - Comando per inserire un nuovo blocco handwriting
   - Tab impostazioni
   ============================================= */

import { Plugin } from 'obsidian';
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
