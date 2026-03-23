/* =============================================
   Settings — Configurazione del plugin
   ============================================= */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type HandwritingPlugin from './main';

// Modalità sfondo: chiaro, scuro o automatico (segue il tema di Obsidian)
export type BgMode = 'light' | 'dark' | 'auto';

export interface HandwritingSettings {
	svgFolder: string;            // cartella dove salvare i file SVG
	canvasWidth: number;          // larghezza interna del canvas (px)
	canvasHeight: number;         // altezza interna del canvas (px)
	bgMode: BgMode;               // modalità sfondo
	ocrLanguages: string[];       // lingue per il riconoscimento OCR (codici BCP-47, es. 'it', 'en')
	geminiApiKey: string;         // chiave API Google Gemini per l'OCR
	debugMode: boolean;           // mostra Notice di debug per eventi IME/touch
}

// Colori predefiniti per le modalità light e dark
export const BG_COLORS: Record<'light' | 'dark', string> = {
	light: '#ffffff',
	dark: '#1e1e1e',
};

// Colore righe adattato allo sfondo
export const LINE_COLORS: Record<'light' | 'dark', string> = {
	light: '#e0e0e0',
	dark: '#3a3a3a',
};

// Risolve 'auto' al tema effettivo leggendo la classe Obsidian sul body
function resolveAutoMode(): 'light' | 'dark' {
	return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
}

// Ritorna il colore sfondo effettivo in base alle impostazioni
export function getEffectiveBgColor(settings: HandwritingSettings): string {
	const mode = settings.bgMode === 'auto' ? resolveAutoMode() : settings.bgMode;
	return BG_COLORS[mode];
}

// Ritorna il colore righe effettivo in base alle impostazioni
export function getEffectiveLineColor(settings: HandwritingSettings): string {
	const mode = settings.bgMode === 'auto' ? resolveAutoMode() : settings.bgMode;
	return LINE_COLORS[mode];
}

// Mappa colori chiari ↔ scuri per adattare i tratti al cambio tema.
// Quando l'utente cambia tema, i tratti con colori della palette opposta
// vengono rimappati ai corrispondenti colori leggibili.
const LIGHT_COLORS = ['#000000', '#1e40af', '#dc2626', '#16a34a'];
const DARK_COLORS  = ['#ffffff', '#60a5fa', '#f87171', '#4ade80'];

// Rimappa il colore di un tratto in base al tema corrente
export function remapStrokeColor(color: string, bgMode: BgMode): string {
	// 'auto' viene risolto al tema Obsidian attuale al momento della chiamata
	const mode = bgMode === 'auto' ? resolveAutoMode() : bgMode;
	const c = color.toLowerCase();
	if (mode === 'dark') {
		// Se il tratto ha un colore "chiaro" (della palette light), mappalo al corrispondente dark
		const idx = LIGHT_COLORS.indexOf(c);
		if (idx >= 0) return DARK_COLORS[idx]!;
	} else {
		// Viceversa: colori dark → light
		const idx = DARK_COLORS.indexOf(c);
		if (idx >= 0) return LIGHT_COLORS[idx]!;
	}
	// Colori non in palette: lascia invariato
	return color;
}

export const DEFAULT_SETTINGS: HandwritingSettings = {
	svgFolder: '_handwriting',
	canvasWidth: 800,
	canvasHeight: 300,
	bgMode: 'auto',               // default: segue automaticamente il tema di Obsidian
	ocrLanguages: ['it', 'en'],   // italiano e inglese di default
	geminiApiKey: '',
	debugMode: false,
};

// Nome del branch corrente — aggiornare manualmente ad ogni cambio di branch
const PLUGIN_BRANCH = 'overlay';

export class HandwritingSettingTab extends PluginSettingTab {
	plugin: HandwritingPlugin;

	constructor(app: App, plugin: HandwritingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Handwriting to Markdown' });

		// Riga versione + branch
		containerEl.createEl('p', {
			text: `v${this.plugin.manifest.version} — branch: ${PLUGIN_BRANCH}`,
			cls: 'setting-item-description',
		});

		// --- Cartella SVG ---
		new Setting(containerEl)
			.setName('Cartella SVG')
			.setDesc('Cartella nel vault dove vengono salvati i file SVG dei disegni')
			.addText(text => text
				.setPlaceholder('_handwriting')
				.setValue(this.plugin.settings.svgFolder)
				.onChange(async (value) => {
					this.plugin.settings.svgFolder = value || '_handwriting';
					await this.plugin.saveSettings();
				}));

		// --- Larghezza canvas ---
		new Setting(containerEl)
			.setName('Larghezza canvas')
			.setDesc('Risoluzione orizzontale del canvas in pixel')
			.addText(text => text
				.setValue(String(this.plugin.settings.canvasWidth))
				.onChange(async (value) => {
					const n = parseInt(value);
					if (!isNaN(n) && n > 100) {
						this.plugin.settings.canvasWidth = n;
						await this.plugin.saveSettings();
					}
				}));

		// --- Altezza canvas ---
		new Setting(containerEl)
			.setName('Altezza canvas')
			.setDesc('Risoluzione verticale del canvas in pixel')
			.addText(text => text
				.setValue(String(this.plugin.settings.canvasHeight))
				.onChange(async (value) => {
					const n = parseInt(value);
					if (!isNaN(n) && n > 50) {
						this.plugin.settings.canvasHeight = n;
						await this.plugin.saveSettings();
					}
				}));

		// --- Sfondo canvas ---
		new Setting(containerEl)
			.setName('Sfondo canvas')
			.setDesc('Colore di sfondo del riquadro di disegno. "Automatico" segue il tema di Obsidian.')
			.addDropdown(drop => drop
				.addOption('auto', 'Automatico (segue tema Obsidian)')
				.addOption('light', 'Chiaro (bianco)')
				.addOption('dark', 'Scuro (grigio scuro)')
				.setValue(this.plugin.settings.bgMode)
				.onChange(async (value) => {
					this.plugin.settings.bgMode = value as BgMode;
					await this.plugin.saveSettings();
					// Notifica pannelli (dark class) e SVG attivi (remap colori)
					this.plugin.notifyBgModeChange();
				}));

		// --- Chiave API Gemini ---
		new Setting(containerEl)
			.setName('Chiave API Gemini')
			.setDesc('Necessaria per il riconoscimento OCR della scrittura a mano. Ottienila da Google AI Studio (aistudio.google.com).')
			.addText(text => {
				text
					.setPlaceholder('AIza...')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				// Maschera il testo come password per nascondere la chiave
				text.inputEl.type = 'password';
			});

		// --- Lingue OCR ---
		new Setting(containerEl)
			.setName('Lingue OCR')
			.setDesc(
				'Codici lingua BCP-47 separati da virgola (es. "it, en, fr"). ' +
				'Usati dal riconoscitore di scrittura su Android.'
			)
			.addText(text => text
				// Mostra l'array come stringa "it, en"
				.setValue(this.plugin.settings.ocrLanguages.join(', '))
				.setPlaceholder('it, en')
				.onChange(async (value) => {
					// Parsa la stringa in array, rimuovendo spazi e voci vuote
					const langs = value
						.split(',')
						.map(l => l.trim())
						.filter(l => l.length > 0);
					this.plugin.settings.ocrLanguages = langs.length > 0 ? langs : ['it', 'en'];
					await this.plugin.saveSettings();
				}));

		// --- Modalità debug ---
		new Setting(containerEl)
			.setName('Modalità debug')
			.setDesc('Mostra notifiche in tempo reale per eventi IME/touch (utile per diagnosticare problemi su Android).')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));
	}
}
