/* =============================================
   Settings — Configurazione del plugin
   ============================================= */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type HandwritingPlugin from './main';
import { t, setLocale, availableLocales, localeNames } from './i18n';

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
	uiLanguage: string;           // lingua dell'interfaccia impostazioni ('auto' = segue sistema)
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
// Esportati per essere usati da editor-view.ts senza ridefinirli.
export const LIGHT_COLORS = ['#000000', '#1e40af', '#dc2626', '#16a34a'];
export const DARK_COLORS  = ['#ffffff', '#60a5fa', '#f87171', '#4ade80'];

// Risolve se il tema è scuro tenendo conto di 'auto' (legge la classe Obsidian sul body)
export function resolveIsDark(bgMode: string): boolean {
	if (bgMode === 'auto') return document.body.classList.contains('theme-dark');
	return bgMode === 'dark';
}

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
	uiLanguage: 'auto',           // default: segue la lingua di sistema di Obsidian
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
		// Classe per scopare i CSS responsive delle impostazioni
		containerEl.addClass('hwm_settings');

		new Setting(containerEl).setName('Handwriting to Markdown').setHeading();

		// Riga versione
		containerEl.createEl('p', {
			text: `v${this.plugin.manifest.version}`,
			cls: 'setting-item-description',
		});

		// --- Lingua interfaccia ---
		new Setting(containerEl)
			.setName(t('ui_language_name'))
			.setDesc(t('ui_language_desc'))
			.addDropdown(drop => {
				// Prima voce: automatico
				drop.addOption('auto', t('ui_language_auto'));
				// Una voce per ogni lingua disponibile nel plugin, con nome nativo
				// eslint-disable-next-line @typescript-eslint/no-misused-promises
				availableLocales().forEach(code => drop.addOption(code, localeNames[code] ?? code));
				drop.setValue(this.plugin.settings.uiLanguage);
				drop.onChange((value) => { void (async () => {
					this.plugin.settings.uiLanguage = value;
					await this.plugin.saveSettings();
					// Aggiorna il dizionario attivo e ridisegna la pagina impostazioni
					setLocale(value);
					this.display();
				})(); });
			});

		// --- Cartella SVG ---
		new Setting(containerEl)
			.setName(t('svg_folder_name'))
			.setDesc(t('svg_folder_desc'))
			.addText(text => text
				.setPlaceholder('_handwriting')
				.setValue(this.plugin.settings.svgFolder)
				.onChange(async (value) => {
					this.plugin.settings.svgFolder = value || '_handwriting';
					await this.plugin.saveSettings();
				}));

		// --- Larghezza canvas ---
		new Setting(containerEl)
			.setName(t('canvas_width_name'))
			.setDesc(t('canvas_width_desc'))
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
			.setName(t('canvas_height_name'))
			.setDesc(t('canvas_height_desc'))
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
			.setName(t('bg_mode_name'))
			.setDesc(t('bg_mode_desc'))
			.addDropdown(drop => drop
				.addOption('auto', t('bg_mode_auto'))
				.addOption('light', t('bg_mode_light'))
				.addOption('dark', t('bg_mode_dark'))
				.setValue(this.plugin.settings.bgMode)
				.onChange(async (value) => {
					this.plugin.settings.bgMode = value as BgMode;
					await this.plugin.saveSettings();
					// Notifica pannelli (dark class) e SVG attivi (remap colori)
					this.plugin.notifyBgModeChange();
				}));

		// --- Chiave API Gemini ---
		new Setting(containerEl)
			.setName(t('gemini_key_name'))
			.setDesc(t('gemini_key_desc'))
			.addText(text => {
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
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
			.setName(t('ocr_langs_name'))
			.setDesc(t('ocr_langs_desc'))
			.addText(text => text
				// Mostra l'array come stringa "it, en"
				.setValue(this.plugin.settings.ocrLanguages.join(', '))
				// eslint-disable-next-line obsidianmd/ui/sentence-case
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

		// --- Modalità debug (nascosta dall'UI, funzionalità mantenuta) ---

		// --- Riferimento keyword OCR (sezione espandibile) ---
		// NOTA SVILUPPATORI: se aggiungi una keyword in md-parser.ts, aggiornala anche qui!
		const details = containerEl.createEl('details', { cls: 'hwm_keyword-ref' });
		details.createEl('summary', {
			text: t('keywords_summary'),
			cls: 'hwm_keyword-summary',
		});
		details.createEl('p', {
			text: t('keywords_desc'),
			cls: 'setting-item-description',
		});

		// Tabella keyword: [nome, sintassi, output]
		// Le parole segnaposto (titolo, testo, ecc.) vengono tradotte via t()
		const T = t('kw_title');   // es. "Titolo" / "Title"
		const X = t('kw_text');    // es. "testo"  / "text"
		const FN = t('kw_footnote'); // es. "nota a piè pagina" / "footnote"
		const W = t('kw_word');    // es. "parola" / "word"
		const KEYWORDS: [string, string, string][] = [
			['//H1',              `//H1 ${T}`,                `# ${T}`],
			['//H2',              `//H2 ${T}`,                `## ${T}`],
			['//H3',              `//H3 ${T}`,                `### ${T}`],
			['//H4',              `//H4 ${T}`,                `#### ${T}`],
			['//B / //BOLD',      `//B ${X}`,                 `**${X}**`],
			['//I',               `//I ${X}`,                 `*${X}*`],
			['//BI',              `//BI ${X}`,                `***${X}***`],
			['//S / //STRIKE',    `//S ${X}`,                 `~~${X}~~`],
			['//HL',              `//HL ${X}`,                `==${X}==`],
			['//CODE',            `//CODE ${X}`,              `\`${X}\``],
			['//CODEBLOCK',       '//CODEBLOCK js',           '```js\n...\n```'],
			['//LIST',            '//LIST a, b, c',           '- a\n- b\n- c'],
			['//NUMLIST',         '//NUMLIST a, b, c',        '1. a\n2. b\n3. c'],
			['//CHECK',           '//CHECK a, b, c',          '- [ ] a\n- [ ] b\n- [ ] c'],
			['//TABLE',           '//TABLE Col1, Col2',       '| Col1 | Col2 |\n|---|---|\n| ... |'],
			['//NOTE',            `//NOTE ${X}`,              `> [!NOTE]\n> ${X}`],
			['//WARN',            `//WARN ${X}`,              `> [!WARNING]\n> ${X}`],
			['//TIP',             `//TIP ${X}`,               `> [!TIP]\n> ${X}`],
			['//INFO',            `//INFO ${X}`,              `> [!INFO]\n> ${X}`],
			['//ERROR',           `//ERROR ${X}`,             `> [!ERROR]\n> ${X}`],
			['//IMPORTANT',       `//IMPORTANT ${X}`,         `> [!IMPORTANT]\n> ${X}`],
			['//QUOTE',           `//QUOTE ${X}`,             `> ${X}`],
			['//LINK',            `//LINK ${X}, url`,         `[${X}](url)`],
			['//IMG',             '//IMG alt, url',           '![alt](url)'],
			['//HR / //SEP',      '//HR',                     '---'],
			['//FN',              `//FN ${FN}`,               `[^1]: ${FN}`],
			['//MATH',            '//MATH formula',           '$formula$'],
			['//MATHBLOCK',       '//MATHBLOCK',              '$$\n...\n$$'],
			['//TAG',             `//TAG ${W}`,               `#${W}`],
			['//DATE',            '//DATE',                   'YYYY-MM-DD'],
			['//TIME',            '//TIME',                   'HH:mm'],
			['//DATETIME',        '//DATETIME',               'YYYY-MM-DD HH:mm'],
			['//INDENT',          `//INDENT ${X}`,            `  ${X}`],
		];

		const table = details.createEl('table', { cls: 'hwm_keyword-table' });
		const thead = table.createEl('thead');
		const hrow  = thead.createEl('tr');
		[t('keywords_col_keyword'), t('keywords_col_syntax'), t('keywords_col_output')].forEach(h => hrow.createEl('th', { text: h }));
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
