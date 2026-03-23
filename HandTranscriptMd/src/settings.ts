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

		// --- Riferimento keyword OCR (sezione espandibile) ---
		// NOTA SVILUPPATORI: se aggiungi una keyword in md-parser.ts, aggiornala anche qui!
		const details = containerEl.createEl('details', { cls: 'hwm_keyword-ref' });
		details.createEl('summary', {
			text: 'Keyword riconosciute dal parser OCR',
			cls: 'hwm_keyword-summary',
		});
		details.createEl('p', {
			text: 'Scrivi queste keyword nel disegno per generare la struttura markdown corrispondente. Tutte sono case-insensitive (//h1 = //H1). Il contenuto segue dopo la keyword separato da uno spazio.',
			cls: 'setting-item-description',
		});

		// Tabella keyword: [nome, sintassi, output]
		const KEYWORDS: [string, string, string][] = [
			['//H1',              '//H1 Titolo',              '# Titolo'],
			['//H2',              '//H2 Titolo',              '## Titolo'],
			['//H3',              '//H3 Titolo',              '### Titolo'],
			['//H4',              '//H4 Titolo',              '#### Titolo'],
			['//B / //BOLD',      '//B testo',                '**testo**'],
			['//I',               '//I testo',                '*testo*'],
			['//BI',              '//BI testo',               '***testo***'],
			['//S / //STRIKE',    '//S testo',                '~~testo~~'],
			['//HL',              '//HL testo',               '==testo=='],
			['//CODE',            '//CODE testo',             '`testo`'],
			['//CODEBLOCK',       '//CODEBLOCK js',           '```js\n...\n```'],
			['//LIST',            '//LIST a, b, c',           '- a\n- b\n- c'],
			['//NUMLIST',         '//NUMLIST a, b, c',        '1. a\n2. b\n3. c'],
			['//CHECK',           '//CHECK a, b, c',          '- [ ] a\n- [ ] b\n- [ ] c'],
			['//TABLE',           '//TABLE Col1, Col2',       '| Col1 | Col2 |\n|---|---|\n| ... |'],
			['//NOTE',            '//NOTE testo',             '> [!NOTE]\n> testo'],
			['//WARN',            '//WARN testo',             '> [!WARNING]\n> testo'],
			['//TIP',             '//TIP testo',              '> [!TIP]\n> testo'],
			['//INFO',            '//INFO testo',             '> [!INFO]\n> testo'],
			['//ERROR',           '//ERROR testo',            '> [!ERROR]\n> testo'],
			['//IMPORTANT',       '//IMPORTANT testo',        '> [!IMPORTANT]\n> testo'],
			['//QUOTE',           '//QUOTE testo',            '> testo'],
			['//LINK',            '//LINK testo, url',        '[testo](url)'],
			['//IMG',             '//IMG alt, url',           '![alt](url)'],
			['//HR / //SEP',      '//HR',                     '---'],
			['//FN',              '//FN nota a piè pagina',   '[^1]: nota a piè pagina'],
			['//MATH',            '//MATH formula',           '$formula$'],
			['//MATHBLOCK',       '//MATHBLOCK',              '$$\n...\n$$'],
			['//TAG',             '//TAG parola',             '#parola'],
			['//DATE',            '//DATE',                   'YYYY-MM-DD'],
			['//TIME',            '//TIME',                   'HH:mm'],
			['//DATETIME',        '//DATETIME',               'YYYY-MM-DD HH:mm'],
			['//INDENT',          '//INDENT testo',           '  testo'],
		];

		const table = details.createEl('table', { cls: 'hwm_keyword-table' });
		const thead = table.createEl('thead');
		const hrow  = thead.createEl('tr');
		['Keyword', 'Sintassi', 'Output'].forEach(h => hrow.createEl('th', { text: h }));
		const tbody = table.createEl('tbody');
		for (const [name, syntax, output] of KEYWORDS) {
			const row = tbody.createEl('tr');
			row.createEl('td', { text: name, cls: 'hwm_kw-name' });
			row.createEl('td').createEl('code', { text: syntax });
			// Mostra il testo dell'output su più righe se contiene \n
			const outTd = row.createEl('td');
			output.split('\n').forEach((ln, idx) => {
				if (idx > 0) outTd.createEl('br');
				outTd.createEl('code', { text: ln });
			});
		}
	}
}
