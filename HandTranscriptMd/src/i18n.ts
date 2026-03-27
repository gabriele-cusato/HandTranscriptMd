/* =============================================
   i18n — Localizzazione del plugin
   ============================================= */

import it    from './locales/it.json';
import en    from './locales/en.json';
import de    from './locales/de.json';
import fr    from './locales/fr.json';
import es    from './locales/es.json';
import ru    from './locales/ru.json';
import ja    from './locales/ja.json';
import zhCn  from './locales/zh-cn.json';
import ptBr  from './locales/pt-br.json';
import pl    from './locales/pl.json';

// Mappa codice lingua → dizionario traduzioni.
// I codici corrispondono ai valori restituiti da moment.locale() in Obsidian.
const locales: Record<string, typeof en> = {
	it, en, de, fr, es, ru, ja, pl,
	'zh-cn': zhCn,
	'pt-br': ptBr,
};

// Nome nativo di ogni lingua — usato nel dropdown impostazioni
export const localeNames: Record<string, string> = {
	it:      'Italiano',
	en:      'English',
	de:      'Deutsch',
	fr:      'Français',
	es:      'Español',
	ru:      'Русский',
	ja:      '日本語',
	'zh-cn': '中文（简体）',
	'pt-br': 'Português (Brasil)',
	pl:      'Polski',
};

// Dizionario attivo — aggiornato da setLocale()
let dict: typeof en = en;

// Imposta la lingua attiva.
// 'auto' rileva la lingua di Obsidian via moment.locale() con fallback a 'en'.
// Dopo aver aggiornato il dizionario, aggiorna tutti i tooltip live nel DOM
// che hanno l'attributo data-hwm-key (impostato da mkBtn/createBtn/createPanelBtn).
export function setLocale(lang: string): void {
	const resolved = lang === 'auto'
		? ((window as Window & { moment?: { locale?: () => string } }).moment?.locale?.() ?? 'en')
		: lang;
	dict = locales[resolved] ?? en;
	// Aggiorna i tooltip già presenti nel DOM
	document.querySelectorAll<HTMLElement>('[data-hwm-key]').forEach(el => {
		const key = el.getAttribute('data-hwm-key') as keyof typeof en;
		if (key) el.title = t(key);
	});
}

// Funzione di traduzione: ritorna la stringa per la chiave data.
// Se la chiave non esiste nel dizionario attivo usa il fallback inglese.
export function t(key: keyof typeof en): string {
	return (dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
}

// Tipo per le chiavi i18n — usato nei parametri di funzione al posto di `string`
// per evitare cast `as any` e avere type-safety sul dizionario.
export type I18nKey = keyof typeof en;

// Ritorna i codici lingua disponibili (escluso 'auto')
export function availableLocales(): string[] {
	return Object.keys(locales);
}
