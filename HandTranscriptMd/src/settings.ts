/* =============================================
   Settings — Configurazione del plugin
   ============================================= */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type HandwritingPlugin from './main';

// Modalità sfondo: chiaro, scuro o colore personalizzato
export type BgMode = 'light' | 'dark' | 'custom';

export interface HandwritingSettings {
	svgFolder: string;       // cartella dove salvare i file SVG
	canvasWidth: number;     // larghezza interna del canvas (px)
	canvasHeight: number;    // altezza interna del canvas (px)
	bgMode: BgMode;          // modalità sfondo
	bgCustomColor: string;   // colore hex se bgMode === 'custom'
	ocrLanguages: string[];  // lingue per il riconoscimento OCR (codici BCP-47, es. 'it', 'en')
	geminiApiKey: string;    // chiave API Google Gemini per l'OCR
	debugMode: boolean;      // mostra Notice di debug per eventi IME/touch
}

// Colori predefiniti per le modalità
export const BG_COLORS: Record<BgMode, string> = {
	light: '#ffffff',
	dark: '#1e1e1e',
	custom: '#ffffff',
};

// Colore righe adattato allo sfondo
export const LINE_COLORS: Record<BgMode, string> = {
	light: '#e0e0e0',
	dark: '#3a3a3a',
	custom: '#cccccc',
};

// Ritorna il colore sfondo effettivo in base alle impostazioni
export function getEffectiveBgColor(settings: HandwritingSettings): string {
	if (settings.bgMode === 'custom') return settings.bgCustomColor;
	return BG_COLORS[settings.bgMode];
}

// Ritorna il colore righe effettivo in base alle impostazioni
export function getEffectiveLineColor(settings: HandwritingSettings): string {
	if (settings.bgMode === 'custom') {
		// Per colore custom, calcola righe leggermente più scure/chiare
		return adjustLineColor(settings.bgCustomColor);
	}
	return LINE_COLORS[settings.bgMode];
}

// Calcola un colore righe adatto allo sfondo custom
// Se lo sfondo è chiaro → righe più scure, se scuro → righe più chiare
function adjustLineColor(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	// Luminosità percepita (formula sRGB)
	const lum = (r * 0.299 + g * 0.587 + b * 0.114);
	const shift = lum > 128 ? -30 : 30; // scurisci o schiarisci
	const clamp = (v: number) => Math.max(0, Math.min(255, v + shift));
	return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

// Mappa colori chiari ↔ scuri per adattare i tratti al cambio tema.
// Quando l'utente cambia tema, i tratti con colori della palette opposta
// vengono rimappati ai corrispondenti colori leggibili.
const LIGHT_COLORS = ['#000000', '#1e40af', '#dc2626', '#16a34a'];
const DARK_COLORS  = ['#ffffff', '#60a5fa', '#f87171', '#4ade80'];

// Rimappa il colore di un tratto in base al tema corrente
export function remapStrokeColor(color: string, bgMode: BgMode): string {
	const c = color.toLowerCase();
	if (bgMode === 'dark') {
		// Se il tratto ha un colore "chiaro" (della palette light), mappalo al corrispondente dark
		const idx = LIGHT_COLORS.indexOf(c);
		if (idx >= 0) return DARK_COLORS[idx]!;
	} else if (bgMode === 'light') {
		// Viceversa: colori dark → light
		const idx = DARK_COLORS.indexOf(c);
		if (idx >= 0) return LIGHT_COLORS[idx]!;
	}
	// Per custom o colori non in palette, lascia invariato
	return color;
}

export const DEFAULT_SETTINGS: HandwritingSettings = {
	svgFolder: '_handwriting',
	canvasWidth: 800,
	canvasHeight: 300,
	bgMode: 'light',
	bgCustomColor: '#ffffff',
	ocrLanguages: ['it', 'en'],   // italiano e inglese di default
	geminiApiKey: '',
	debugMode: false,
};

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
			.setDesc('Colore di sfondo del riquadro di disegno')
			.addDropdown(drop => drop
				.addOption('light', 'Chiaro (bianco)')
				.addOption('dark', 'Scuro (grigio scuro)')
				.addOption('custom', 'Personalizzato')
				.setValue(this.plugin.settings.bgMode)
				.onChange(async (value) => {
					this.plugin.settings.bgMode = value as BgMode;
					await this.plugin.saveSettings();
					// Aggiorna la UI per mostrare/nascondere il color picker
					this.display();
				}));

		// --- Colore personalizzato (visibile solo se bgMode === 'custom') ---
		if (this.plugin.settings.bgMode === 'custom') {
			new Setting(containerEl)
				.setName('Colore sfondo personalizzato')
				.setDesc('Scegli il colore hex dello sfondo')
				.addColorPicker(picker => picker
					.setValue(this.plugin.settings.bgCustomColor)
					.onChange(async (value) => {
						this.plugin.settings.bgCustomColor = value;
						await this.plugin.saveSettings();
					}));
		}

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
