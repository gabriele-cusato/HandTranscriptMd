/* =============================================
   parser.test.ts — Test autonomo per md-parser

   Eseguibile senza framework:
     npx tsx src/parser.test.ts

   Non richiede dipendenze esterne: usa solo
   un helper expect/toBe inline.
   ============================================= */

import { normalizeMarkdownSymbols as normalize, expandKeywords as expand, parseHandwritingToMarkdown as parse } from './md-parser.js';

// --- Mini test runner ---

let passed = 0;
let failed = 0;

function expect(actual: string) {
	return {
		toBe(expected: string) {
			if (actual === expected) {
				passed++;
			} else {
				failed++;
				console.error(`❌ FAIL (toBe)\n   actual:   ${JSON.stringify(actual)}\n   expected: ${JSON.stringify(expected)}`);
			}
		},
		toContain(substr: string) {
			if (actual.includes(substr)) {
				passed++;
			} else {
				failed++;
				console.error(`❌ FAIL (toContain)\n   actual:   ${JSON.stringify(actual)}\n   expected to contain: ${JSON.stringify(substr)}`);
			}
		},
	};
}

function describe(name: string, fn: () => void) {
	console.debug(`\n📋 ${name}`);
	fn();
}

// =============================================================================
// normalizeMarkdownSymbols
// =============================================================================

describe('normalizeMarkdownSymbols — heading', () => {
	expect(normalize('#Ciao')).toBe('# Ciao');
	expect(normalize('##titolo')).toBe('## Titolo');
	expect(normalize('###sub')).toBe('### Sub');
	expect(normalize('# Già corretto')).toBe('# Già corretto');
	expect(normalize('####senza cap')).toBe('#### senza cap'); // H4 non capitalizza
});

describe('normalizeMarkdownSymbols — liste', () => {
	expect(normalize('-elemento')).toBe('- elemento');
	expect(normalize('- già ok')).toBe('- già ok');
	expect(normalize('• item')).toBe('- item');
	expect(normalize('· item')).toBe('- item');
	expect(normalize('● item')).toBe('- item');
});

describe('normalizeMarkdownSymbols — liste numerate', () => {
	expect(normalize('1.elemento')).toBe('1. elemento');
	expect(normalize('1. elemento')).toBe('1. elemento');   // già corretto
	expect(normalize('2)elemento')).toBe('2. elemento');
	expect(normalize('3elemento')).toBe('3. elemento');
});

describe('normalizeMarkdownSymbols — checkbox', () => {
	expect(normalize('[x]testo')).toBe('- [x] testo');
	expect(normalize('[X]testo')).toBe('- [x] testo');
	expect(normalize('[v]testo')).toBe('- [x] testo');
	expect(normalize('[ ]testo')).toBe('- [ ] testo');
	expect(normalize('[]testo')).toBe('- [ ] testo');
});

describe('normalizeMarkdownSymbols — blockquote', () => {
	expect(normalize('>testo')).toBe('> testo');
	expect(normalize('> già ok')).toBe('> già ok');
});

describe('normalizeMarkdownSymbols — separatori', () => {
	expect(normalize('===')).toBe('---');
	expect(normalize('___')).toBe('---');
	expect(normalize('***')).toBe('---');
	expect(normalize('---')).toBe('---');
});

describe('normalizeMarkdownSymbols — parole duplicate', () => {
	expect(normalize('ciao ciao')).toBe('ciao');
	expect(normalize('il il cliente')).toBe('il cliente');
});

describe('normalizeMarkdownSymbols — blocchi codice protetti', () => {
	// Il contenuto dentro ``` non deve essere modificato
	expect(normalize('```\n#non titolo\n```')).toBe('```\n#non titolo\n```');
	expect(normalize('```js\n-nolista\n```')).toBe('```js\n-nolista\n```');
});

// =============================================================================
// expandKeywords
// =============================================================================

describe('expandKeywords — titoli', () => {
	expect(expand('//H1 Titolo')).toBe('# Titolo');
	expect(expand('//H2 Sezione')).toBe('## Sezione');
	expect(expand('//H3 Sub')).toBe('### Sub');
	expect(expand('//H4 Piccolo')).toBe('#### Piccolo');
});

describe('expandKeywords — inline style', () => {
	expect(expand('//B parola')).toBe('**parola**');
	expect(expand('//I corsivo')).toBe('*corsivo*');
	expect(expand('//BI entrambi')).toBe('***entrambi***');
	expect(expand('//S barrato')).toBe('~~barrato~~');
	expect(expand('//HL evidenziato')).toBe('==evidenziato==');
	expect(expand('//CODE var x')).toBe('`var x`');
});

describe('expandKeywords — liste', () => {
	expect(expand('//LIST a, b, c')).toBe('- a\n- b\n- c');
	expect(expand('//NUMLIST a, b, c')).toBe('1. a\n2. b\n3. c');
	expect(expand('//CHECK task1, task2')).toBe('- [ ] task1\n- [ ] task2');
});

describe('expandKeywords — tabella', () => {
	expect(expand('//TABLE A, B, C')).toContain('| A | B | C |');
	expect(expand('//TABLE A, B, C')).toContain('|---|---|---|');
	// Tabella con righe dati e tag di chiusura
	const tableInput = '//TABLE Col1, Col2, Col3\nval1, val2, val3\nval4, val5, val6\n//TABLE';
	const tableOut   = expand(tableInput);
	expect(tableOut).toContain('| Col1 | Col2 | Col3 |');
	expect(tableOut).toContain('| val1 | val2 | val3 |');
	expect(tableOut).toContain('| val4 | val5 | val6 |');
});

describe('expandKeywords — callout', () => {
	expect(expand('//NOTE testo')).toBe('> [!NOTE]\n> testo');
	expect(expand('//WARN testo')).toBe('> [!WARNING]\n> testo');
	expect(expand('//TIP testo')).toBe('> [!TIP]\n> testo');
	expect(expand('//INFO testo')).toBe('> [!INFO]\n> testo');
	expect(expand('//ERROR testo')).toBe('> [!ERROR]\n> testo');
	expect(expand('//IMPORTANT testo')).toBe('> [!IMPORTANT]\n> testo');
	expect(expand('//QUOTE testo')).toBe('> testo');
});

describe('expandKeywords — link e immagini', () => {
	expect(expand('//LINK Google, https://google.com')).toBe('[Google](https://google.com)');
	expect(expand('//IMG logo, https://example.com/img.png')).toBe('![logo](https://example.com/img.png)');
});

describe('expandKeywords — separatori', () => {
	expect(expand('//HR')).toBe('---');
	expect(expand('//SEP')).toBe('---');
});

describe('expandKeywords — footnote', () => {
	expect(expand('//FN questa è una nota')).toBe('[^1]: questa è una nota');
	// Due footnote consecutive: numeri 1 e 2
	expect(expand('//FN prima\n//FN seconda')).toBe('[^1]: prima\n[^2]: seconda');
	// Partenza custom
	expect(expand('//FN nota', 5)).toBe('[^5]: nota');
});

describe('expandKeywords — math', () => {
	expect(expand('//MATH E=mc^2')).toBe('$E=mc^2$');
});

describe('expandKeywords — tag e date/ora', () => {
	expect(expand('//TAG progetto')).toBe('#progetto');
	expect(expand('//TAG due parole')).toBe('#due_parole');
	// //DATE, //TIME, //DATETIME usano la data corrente: verifichiamo solo il formato
	const dateOut = expand('//DATE');
	expect(typeof dateOut === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOut) ? 'ok' : 'fail').toBe('ok');
});

describe('expandKeywords — alias e case-insensitive', () => {
	expect(expand('//bold testo')).toBe('**testo**');   // alias BOLD = B
	expect(expand('//BOLD testo')).toBe('**testo**');
	expect(expand('//strike testo')).toBe('~~testo~~'); // alias STRIKE = S
	expect(expand('//hr')).toBe('---');                 // lowercase
	expect(expand('//Table A, B')).toContain('| A | B |'); // mixed case
});

describe('expandKeywords — colon opzionale', () => {
	expect(expand('//B: testo')).toBe('**testo**');     // con colon
	expect(expand('//H1: Titolo')).toBe('# Titolo');    // con colon
});

describe('expandKeywords — CODEBLOCK multi-riga', () => {
	const input = '//CODEBLOCK js\nconsole.debug(\'ciao\')\nconst x = 1\n';
	const out   = expand(input);
	expect(out).toContain('```js');
	expect(out).toContain('console.debug(\'ciao\')');
	expect(out).toContain('```');
});

describe('expandKeywords — indent', () => {
	expect(expand('//INDENT testo')).toBe('  testo');
});

// =============================================================================
// Pipeline completa parseHandwritingToMarkdown
// =============================================================================

describe('pipeline completa', () => {
	expect(parse('#Ciao\n//LIST a, b')).toBe('# Ciao\n- a\n- b');
	expect(parse('##sezione\n//B parola chiave')).toBe('## Sezione\n**parola chiave**');
	// Il blocco codice non viene toccato dalla normalizzazione
	expect(parse('```\n#non toccare\n```')).toBe('```\n#non toccare\n```');
	// Tabella con righe dati attraverso la pipeline completa
	const tableInput = '//TABLE Col1, Col2, Col3\nval1, val2, val3\nval4, val5, val6\n//TABLE';
	const tableOut   = parse(tableInput);
	expect(tableOut).toContain('| Col1 | Col2 | Col3 |');
	expect(tableOut).toContain('| val1 | val2 | val3 |');
	expect(tableOut).toContain('| val4 | val5 | val6 |');
});

// =============================================================================
// Report finale
// =============================================================================

console.debug(`\n${'─'.repeat(40)}`);
if (failed === 0) {
	console.debug(`✅ Tutti i ${passed} test passati.`);
} else {
	console.debug(`❌ ${failed} test falliti su ${passed + failed} totali.`);
	process.exit(1);
}
