/* =============================================
   md-parser — Parser prefissi Markdown
   Converte testo grezzo (output OCR) in markdown
   strutturato, analizzando riga per riga.
   ============================================= */

// Converte tutto il testo grezzo in markdown formattato
export function parseMarkdown(raw: string): string {
	const lines = raw.split('\n');
	return lines.map(parseLine).join('\n');
}

// Processa una singola riga, rilevando il prefisso e applicando la sintassi markdown
function parseLine(line: string): string {
	const t = line.trim();
	if (!t) return '';

	// Separatore orizzontale: "---" o più trattini
	if (/^-{3,}$/.test(t)) return '---';

	// Intestazioni H1 / H2 / H3 (es. "# Titolo", "## Sezione")
	if (/^#{1,3}\s+/.test(t)) return t;

	// Checkbox spuntata: "- [x] testo" (case insensitive)
	if (/^-\s*\[x\]\s*/i.test(t)) {
		const content = t.replace(/^-\s*\[x\]\s*/i, '');
		return `- [x] ${content}`;
	}

	// Checkbox vuota: "- [ ] testo"
	if (/^-\s*\[\s*\]\s*/.test(t)) {
		const content = t.replace(/^-\s*\[\s*\]\s*/, '');
		return `- [ ] ${content}`;
	}

	// Lista non ordinata: "- testo" o "* testo"
	if (/^[-*]\s+/.test(t)) {
		const content = t.replace(/^[-*]\s+/, '');
		return `- ${content}`;
	}

	// Lista ordinata: "1. testo", "2. testo", ecc.
	if (/^\d+\.\s+/.test(t)) return t;

	// Blockquote: "> testo"
	if (/^>\s*/.test(t)) return t;

	// Blocco codice: riga che inizia con ``` (anche con linguaggio, es. ```js)
	if (t.startsWith('```')) return t;

	// Testo con inline code, grassetto, corsivo, highlight, barrato:
	// questi sono già nella forma giusta (es. **testo**), li passiamo invariati.
	// L'OCR dovrebbe produrli come scritti a mano con i simboli.
	return t;
}
