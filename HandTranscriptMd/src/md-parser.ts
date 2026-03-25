/* =============================================
   md-parser — Parsing OCR → Markdown Obsidian

   Pipeline in due step:
     1. normalizeMarkdownSymbols — corregge simboli approssimativi
     2. expandKeywords           — espande _KEYWORD: in strutture markdown
   ============================================= */

// =============================================================================
// STEP 1 — normalizeMarkdownSymbols
// =============================================================================

/**
 * Corregge simboli markdown scritti a mano in modo approssimativo (output OCR).
 * Opera riga per riga, saltando completamente il contenuto dei blocchi codice.
 */
export function normalizeMarkdownSymbols(rawText: string): string {
	// Rimuove BOM e caratteri zero-width Unicode che Gemini inserisce all'inizio
	// del testo o all'inizio di righe (U+FEFF, U+200B, U+200C, U+200D, U+2060)
	const cleaned = rawText.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');

	const lines = cleaned.split('\n');
	const out: string[] = [];
	let inCodeBlock = false;

	for (const line of lines) {
		// Delimitatore blocco codice (``` opzionalmente seguito da linguaggio)
		if (line.trim().startsWith('```')) {
			inCodeBlock = !inCodeBlock;
			out.push(line);
			continue;
		}
		// Dentro un blocco codice: non toccare nulla
		if (inCodeBlock) {
			out.push(line);
			continue;
		}
		out.push(normalizeLine(line));
	}

	let result = out.join('\n');

	// Parola ripetuta consecutivamente: "ciao ciao" → "ciao"
	// \b(\w+)\s+\1\b cattura la stessa parola due volte separate da spazio
	result = result.replace(/\b(\w+)\s+\1\b/gi, '$1');

	// Massimo una riga vuota tra paragrafi
	result = result.replace(/\n{3,}/g, '\n\n');

	// Converti righe con separatori pipe (|) in tabelle markdown
	result = convertPipeTables(result);

	return result;
}

/**
 * Applica le correzioni su una singola riga (non dentro blocchi codice).
 */
function normalizeLine(line: string): string {
	// Righe keyword //KEYWORD — non modificare, le gestisce expandKeywords
	if (/^\/\/[A-Za-z0-9_]/i.test(line.trim())) return line;

	// Rimuove spazi finali (non iniziali: servono per le liste annidate)
	line = line.trimEnd();

	// Separatori alternativi: ===, ___, *** o già --- → normalizza a ---
	// Controlla PRIMA degli heading perché ___ potrebbe confondersi
	if (/^(={3,}|_{3,}|\*{3,}|-{3,})$/.test(line.trim())) return '---';

	// Heading senza spazio: #Ciao → # Ciao, ##titolo → ## Titolo
	// Cattura #{1,6} + qualsiasi carattere non-spazio/non-# come primo carattere
	line = line.replace(/^(#{1,6})([^\s#].*)$/, (_, hashes: string, content: string) => {
		const text = content.trim();
		// Prima lettera maiuscola per H1/H2/H3 (regola di stile)
		const cap = hashes.length <= 3
			? text.charAt(0).toUpperCase() + text.slice(1)
			: text;
		return `${hashes} ${cap}`;
	});

	// Bullet unicode → lista markdown: •, ·, ∙, ◦, ‣, ⁃, ➤, ●, ○, ▶, ►, ▸ ecc.
	line = line.replace(/^[•·∙◦‣⁃➤➢▶►▸▪▫●○]\s*(.+)$/, '- $1');

	// Lista non ordinata: -elemento (senza spazio) → - elemento
	// [^\s\-] assicura che non sia già "- " né "--"
	line = line.replace(/^-([^\s\-].+)$/, '- $1');

	// Lista numerata — tre varianti:
	// 1)elemento o 1.elemento (con o senza spazio) → 1. elemento
	line = line.replace(/^(\d+)[.)]\s*(\S.*)$/, '$1. $2');
	// 1elemento (numero attaccato a lettera) → 1. elemento
	line = line.replace(/^(\d+)([A-Za-zÀ-ÖØ-öø-ÿ].*)$/, '$1. $2');

	// Checkbox: varianti scritte a mano
	// [x], [X], [v], [V], [✓] → - [x] testo
	line = line.replace(/^\[\s*[xXvV✓]\s*\]\s*(.*)$/, '- [x] $1');
	// [], [ ] → - [ ] testo
	line = line.replace(/^\[\s*\]\s*(.*)$/, '- [ ] $1');

	// Blockquote senza spazio: >testo → > testo
	line = line.replace(/^>([^\s].*)$/, '> $1');

	// Spazi multipli → spazio singolo, preservando l'indentazione iniziale
	const leading = line.match(/^(\s*)/)?.[1] ?? '';
	const body    = line.slice(leading.length).replace(/  +/g, ' ');
	line = leading + body;

	return line;
}

/**
 * Converte gruppi di 2+ righe consecutive separate da pipe (|) in tabelle markdown.
 * Evita righe già formattate come tabella (con riga separatore |---|).
 */
function convertPipeTables(text: string): string {
	const lines = text.split('\n');
	const out: string[] = [];
	let i = 0;
	let inCodeBlock = false;

	while (i < lines.length) {
		const line = lines[i];

		// Rispetta i blocchi codice anche in questa fase
		if (line.trim().startsWith('```')) {
			inCodeBlock = !inCodeBlock;
			out.push(line); i++; continue;
		}
		if (inCodeBlock) { out.push(line); i++; continue; }

		// Una riga con | potrebbe essere l'inizio di una tabella grezza
		const hasPipe = line.includes('|');
		// Salta intestazioni, blockquote e righe separatore già in formato markdown
		const isSep = /^\|?\s*:?-+:?\s*\|/.test(line);
		const isSpecial = line.trim().startsWith('#') || line.trim().startsWith('>');

		if (hasPipe && !isSep && !isSpecial) {
			// Raccoglie righe consecutive con pipe, saltando eventuali separatori già presenti
			const block: string[] = [line];
			let j = i + 1;
			while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
				if (!/^\|?\s*:?-+:?\s*\|/.test(lines[j])) block.push(lines[j]);
				j++;
			}

			// Converte solo se ci sono almeno 2 righe (intestazione + almeno 1 dati)
			if (block.length >= 2) {
				// Divide le celle: rimuove celle vuote iniziali/finali create da | ai bordi
				const rows = block.map(r => {
					const parts = r.split('|').map(c => c.trim());
					const start = parts[0] === '' ? 1 : 0;
					const end   = parts[parts.length - 1] === '' ? parts.length - 1 : parts.length;
					return parts.slice(start, end);
				});
				const cols      = Math.max(...rows.map(r => r.length));
				const headerRow = '| ' + rows[0].join(' | ') + ' |';
				// Riga separatore compatta: |---|---|
				const sepRow    = '|' + rows[0].map(() => '---|').join('');
				const dataRows  = rows.slice(1).map(row => {
					const cells = Array.from({ length: cols }, (_, k) => row[k] ?? '');
					return '| ' + cells.join(' | ') + ' |';
				});
				out.push(headerRow, sepRow, ...dataRows);
				i = j;
				continue;
			}
		}

		out.push(line);
		i++;
	}

	return out.join('\n');
}

// =============================================================================
// STEP 2 — expandKeywords
// =============================================================================

/**
 * Espande le keyword _KEYWORD: in strutture markdown complete.
 * Tutte le keyword sono case-insensitive. Lo spazio dopo ':' è opzionale.
 *
 * @param text     - testo già normalizzato
 * @param fnStart  - numero di partenza per le footnote _FN: (default 1)
 */
export function expandKeywords(text: string, fnStart = 1): string {
	const lines = text.split('\n');
	const out: string[] = [];
	let fn = fnStart;  // contatore footnote corrente
	let i  = 0;

	while (i < lines.length) {
		const line    = lines[i];
		const trimmed = line.trim();

		// Pattern: //KEYWORD contenuto  oppure  //KEYWORD: contenuto  (colon opzionale)
		// Es: //H1 CIAO, //LIST a, b, c, //CODEBLOCK js, //HR
		// Il contenuto segue il nome keyword separato da spazio e/o ':'
		const kw = trimmed.match(/^\/\/([A-Za-z0-9_]+)\s*:?\s*(.*)/i);

		if (!kw) {
			out.push(line);
			i++;
			continue;
		}

		const keyword = kw[1].toUpperCase();       // nome keyword normalizzato
		const content = (kw[2] ?? '').trim();      // contenuto dopo la keyword

		switch (keyword) {

			// --- Titoli ---
			case 'H1': out.push(`# ${capitalize(content)}`);   break;
			case 'H2': out.push(`## ${capitalize(content)}`);  break;
			case 'H3': out.push(`### ${capitalize(content)}`); break;
			case 'H4': out.push(`#### ${content}`);            break;

			// --- Inline style ---
			case 'B':
			case 'BOLD':   out.push(`**${content}**`);   break;
			case 'I':      out.push(`*${content}*`);     break;
			case 'BI':     out.push(`***${content}***`); break;
			case 'S':
			case 'STRIKE': out.push(`~~${content}~~`);   break;
			case 'HL':     out.push(`==${content}==`);   break;
			case 'CODE':   out.push(`\`${content}\``);   break;

			// --- Liste ---
			// Tutte e tre supportano continuazione multi-riga (virgola finale)
			case 'LIST': {
				const [fullContent, newI] = collectContinuation(lines, i + 1, content);
				i = newI;
				out.push(buildBulletList(fullContent));
				continue; // i gia' avanzato
			}
			case 'NUMLIST': {
				// Offset opzionale: //NUMLIST 3 item1, item2 -> parte da 3
				let offset = 1;
				let items = content;
				const offsetMatch = content.match(/^(\d+)\s+(.*)/s);
				if (offsetMatch) { offset = parseInt(offsetMatch[1]); items = offsetMatch[2]; }
				const [fullItems, newI] = collectContinuation(lines, i + 1, items);
				i = newI;
				out.push(buildNumList(fullItems, offset));
				continue;
			}
			case 'CHECK': {
				const [fullContent, newI] = collectContinuation(lines, i + 1, content);
				i = newI;
				out.push(buildChecklist(fullContent));
				continue;
			}

			// --- Callout Obsidian ---
			// Tutti i callout: content = titolo inline, righe successive = corpo (fino a riga vuota)
			case 'NOTE':
			case 'WARN':
			case 'TIP':
			case 'INFO':
			case 'ERROR':
			case 'IMPORTANT': {
				const typeMap: Record<string, string> = { WARN: 'WARNING' };
				const calloutType = typeMap[keyword] ?? keyword;
				i++;
				const bodyLines: string[] = [];
				// Raccoglie righe del corpo fino alla prima vuota o nuova keyword
				while (i < lines.length) {
					const bl = lines[i].trim();
					if (!bl || bl.startsWith('//')) break;
					bodyLines.push(bl);
					i++;
				}
				out.push(buildCallout(calloutType, content, bodyLines));
				continue;
			}
			case 'QUOTE':     out.push(`> ${content}`);                     break;

			// --- Link e immagini ---
			case 'LINK': {
				const [label, url] = splitTwo(content);
				out.push(`[${label}](${url})`);
				break;
			}
			case 'IMG': {
				const [alt, url] = splitTwo(content);
				out.push(`![${alt}](${url})`);
				break;
			}

			// --- Separatori ---
			case 'HR':
			case 'SEP': out.push('---'); break;

			// --- Footnote auto-numerata ---
			case 'FN': out.push(`[^${fn++}]: ${content}`); break;

			// --- Math ---
			case 'MATH': out.push(`$${content}$`); break;

			// --- Tag Obsidian (sostituisce spazi con underscore) ---
			case 'TAG': out.push(`#${content.replace(/\s+/g, '_')}`); break;

			// --- Data / Ora (usa ora di sistema) ---
			case 'DATE': {
				const d = new Date();
				out.push(d.toISOString().slice(0, 10));
				break;
			}
			case 'TIME': {
				const d = new Date();
				out.push(d.toTimeString().slice(0, 5));
				break;
			}
			case 'DATETIME': {
				const d = new Date();
				out.push(`${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`);
				break;
			}

			// --- Indent (aggiunge 2 spazi) ---
			case 'INDENT': out.push(`  ${content}`); break;

			// --- CODEBLOCK multi-riga (termina con riga vuota) ---
			// Sintassi: //CODEBLOCK js  (linguaggio dopo il nome keyword)
			case 'CODEBLOCK': {
				const lang = content;  // es. "js", "python", ""
				i++;
				const codeLines: string[] = [];
				// Raccoglie righe fino alla prima riga vuota o fine testo
				while (i < lines.length && lines[i].trim() !== '') {
					codeLines.push(lines[i]);
					i++;
				}
				out.push(`\`\`\`${lang}\n${codeLines.join('\n')}\n\`\`\``);
				continue; // i già avanzato, salta l'i++ finale
			}

			// --- MATHBLOCK multi-riga (termina con riga vuota) ---
			case 'MATHBLOCK': {
				i++;
				const mathLines: string[] = [];
				while (i < lines.length && lines[i].trim() !== '') {
					mathLines.push(lines[i]);
					i++;
				}
				out.push(`$$\n${mathLines.join('\n')}\n$$`);
				continue;
			}

			// --- TABLE multi-riga ---
			// Header: //TABLE Col1, Col2, Col3
			// Righe:  val1, val2, val3  (una per riga, virgola come separatore)
			// Fine:   //TABLE  (tag di chiusura) oppure riga vuota
			case 'TABLE': {
				// Continuazione header se //TABLE Col1, Col2, finisce con virgola -> prosegue sulla riga successiva
				const [fullHeader, startI] = collectContinuation(lines, i + 1, content);
				const headers = fullHeader.split(',').map(h => h.trim()).filter(h => h);
				const rows: string[][] = [];
				i = startI;
				while (i < lines.length) {
					let rowLine = lines[i].trim();
					// Chiusura esplicita //TABLE
					if (/^\/\/TABLE/i.test(rowLine)) { i++; break; }
					// Qualsiasi altra keyword chiude implicitamente senza consumarla
					if (/^\/\//.test(rowLine)) break;
					// Fine implicita: riga vuota
					if (!rowLine) break;
					// Continuazione riga: se finisce con virgola, leggi la riga successiva
					while (rowLine.trimEnd().endsWith(',') && i + 1 < lines.length) {
						const nextRow = lines[i + 1].trim();
						if (!nextRow || nextRow.startsWith('//')) break;
						rowLine = rowLine.trimEnd() + ' ' + nextRow;
						i++;
					}
					rows.push(rowLine.split(',').map(c => c.trim()).filter(c => c));
					i++;
				}
				out.push(buildTable(headers, rows));
				continue;
			}

			default:
				// Keyword non riconosciuta: lascia la riga invariata
				out.push(line);
		}

		i++;
	}

	return out.join('\n');
}

// =============================================================================
// PIPELINE COMPLETA
// =============================================================================

/**
 * Pipeline completa: normalizzazione simboli → espansione keyword.
 * Questa è la funzione principale da usare per l'output OCR grezzo.
 */
export function parseHandwritingToMarkdown(rawOcrText: string): string {
	return expandKeywords(normalizeMarkdownSymbols(rawOcrText));
}


// =============================================================================
// HELPER PRIVATI
// =============================================================================

/** Prima lettera maiuscola, resto invariato */
function capitalize(s: string): string {
	if (!s) return s;
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Divide "testo, resto" in ["testo", "resto"] usando la PRIMA virgola.
 * Usato da _LINK: e _IMG: per separare label/alt da url.
 */
function splitTwo(content: string): [string, string] {
	const idx = content.indexOf(',');
	if (idx === -1) return [content.trim(), ''];
	return [content.slice(0, idx).trim(), content.slice(idx + 1).trim()];
}

/**
 * Se content finisce con ',', raccoglie le righe successive come prosecuzione.
 * Restituisce [contenuto_completo, nuovo_indice].
 * nuovo_indice punta già oltre le righe consumate → usare continue nel loop, non break.
 */
function collectContinuation(lines: string[], nextI: number, content: string): [string, number] {
	let full = content;
	let i = nextI;
	// Finché l'ultima riga raccolta finisce con virgola, aggiungi la riga successiva
	while (full.trimEnd().endsWith(',') && i < lines.length) {
		const next = lines[i].trim();
		// Riga vuota o nuova keyword → stop
		if (!next || next.startsWith('//')) break;
		full = full.trimEnd() + ' ' + next;
		i++;
	}
	return [full, i];
}

/** Costruisce lista puntata da "a, b, c" → "- a\n- b\n- c" */
function buildBulletList(content: string): string {
	return content.split(',')
		.map(item => item.trim()).filter(item => item)
		.map(item => `- ${item}`).join('\n');
}

/** Costruisce lista numerata da "a, b, c" → "1. a\n2. b\n3. c"; start: numero iniziale */
function buildNumList(content: string, start = 1): string {
	return content.split(',')
		.map(item => item.trim()).filter(item => item)
		.map((item, idx) => `${start + idx}. ${item}`).join('\n');
}

/**
 * Costruisce checklist da "a, b, c".
 * Prefisso "x", "X", "[x]", "[X]" → spuntato; tutto il resto → vuoto.
 * Es: "x fatto, da fare, [x] altro" → "- [x] fatto\n- [ ] da fare\n- [x] altro"
 */
function buildChecklist(content: string): string {
	return content.split(',')
		.map(item => item.trim()).filter(item => item)
		.map(item => {
			// Prefisso checked: x o [x] (con o senza parentesi quadre) seguito da spazio
			if (/^(?:[xX]|\[[xX]\])\s+/.test(item)) {
				return `- [x] ${item.replace(/^(?:[xX]|\[[xX]\])\s+/, '')}`;
			}
			// Prefisso unchecked esplicito: [ ] seguito da spazio
			if (/^\[\s*\]\s+/.test(item)) {
				return `- [ ] ${item.replace(/^\[\s*\]\s+/, '')}`;
			}
			// Nessun prefisso → vuoto di default
			return `- [ ] ${item}`;
		}).join('\n');
}

/**
 * Costruisce un callout Obsidian.
 * title: testo opzionale sulla stessa riga di [!TYPE]
 * bodyLines: righe successive del corpo
 */
function buildCallout(type: string, title: string, bodyLines: string[] = []): string {
	// Il titolo va inline: > [!NOTE] Titolo  (sintassi Obsidian standard)
	const header = title ? `> [!${type}] ${title}` : `> [!${type}]`;
	if (!bodyLines.length) return header;
	return header + '\n' + bodyLines.map(l => `> ${l}`).join('\n');
}

/**
 * Costruisce una tabella markdown con intestazioni e righe opzionali.
 * Il separatore usa il formato compatto |---|---| (senza spazi interni).
 */
function buildTable(headers: string[], rows: string[][]): string {
	const headerRow = '| ' + headers.join(' | ') + ' |';
	// Separatore compatto: |---|---|---| (necessario per toContain nei test)
	const sepRow    = '|' + headers.map(() => '---|').join('');
	// Righe dati: padda al numero di colonne dell'intestazione
	const dataRows  = rows.map(row => {
		const cells = Array.from({ length: headers.length }, (_, k) => row[k] ?? '');
		return '| ' + cells.join(' | ') + ' |';
	});
	return [headerRow, sepRow, ...dataRows].join('\n');
}
