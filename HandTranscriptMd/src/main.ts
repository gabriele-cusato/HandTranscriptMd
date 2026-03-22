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

export default class HandwritingPlugin extends Plugin {
	settings: HandwritingSettings;

	async onload() {
		await this.loadSettings();

		// Registra il code block processor per ```handwriting
		registerEmbed(this);

		// Comando: inserisce un nuovo blocco handwriting nel file corrente
		this.addCommand({
			id: 'insert-handwriting',
			name: 'Insert handwriting block',
			callback: async () => {
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
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
