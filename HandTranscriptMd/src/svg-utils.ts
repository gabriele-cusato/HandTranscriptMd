/* =============================================
   SVG Utilities — Conversione tratti ↔ SVG
   I tratti vengono salvati come <path> nell'SVG,
   e i dati grezzi in un elemento <desc> (JSON)
   per poter ricaricare e rieditare il disegno.
   ============================================= */

import { Point, Stroke } from './drawing-canvas';

// Genera ID univoco per nuovi disegni (timestamp + random)
export function generateId(): string {
	const ts = Date.now().toString(36);
	const rnd = Math.random().toString(36).substring(2, 6);
	return `hw_${ts}_${rnd}`;
}

// Converte un array di punti in un attributo SVG path "d"
// Usa curve quadratiche Bézier con midpoint per smoothing
function pointsToPathD(points: Point[]): string {
	if (points.length < 2) return '';

	const parts: string[] = [];
	// Move to primo punto
	parts.push(`M ${r(points[0]!.x)},${r(points[0]!.y)}`);

	if (points.length === 2) {
		parts.push(`L ${r(points[1]!.x)},${r(points[1]!.y)}`);
	} else {
		// Curve quadratiche con midpoint (stessa tecnica del canvas)
		for (let i = 1; i < points.length - 1; i++) {
			const curr = points[i]!;
			const next = points[i + 1]!;
			const midX = (curr.x + next.x) / 2;
			const midY = (curr.y + next.y) / 2;
			parts.push(`Q ${r(curr.x)},${r(curr.y)} ${r(midX)},${r(midY)}`);
		}
		// Ultimo punto
		const last = points[points.length - 1]!;
		parts.push(`L ${r(last.x)},${r(last.y)}`);
	}

	return parts.join(' ');
}

// Arrotonda a 1 decimale per SVG più compatti
function r(n: number): string {
	return Math.round(n * 10) / 10 + '';
}

// Converte array di Stroke in contenuto SVG completo
// I dati grezzi dei tratti sono dentro <desc> come JSON
// per permettere il riedit senza perdere informazioni
export function strokesToSvg(
	strokes: Stroke[], width: number, height: number,
	bgColor = '#ffffff', lineColor = '#e0e0e0'
): string {
	const paths: string[] = [];

	for (const stroke of strokes) {
		const d = pointsToPathD(stroke.points);
		if (!d) continue;
		paths.push(
			`  <path d="${d}" stroke="${stroke.color}" fill="none" ` +
			`stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`
		);
	}

	const strokesJson = JSON.stringify(strokes);

	// Righe orizzontali (foglio a righe) — stessa spaziatura del canvas
	const LINE_SPACING = 32;
	const lines: string[] = [];
	for (let y = LINE_SPACING; y < height; y += LINE_SPACING) {
		lines.push(`  <line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${lineColor}" stroke-width="0.5"/>`);
	}

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
		`  <rect width="100%" height="100%" fill="${bgColor}"/>`,
		...lines,
		`  <desc class="hwm-strokes">${escapeXml(strokesJson)}</desc>`,
		...paths,
		`</svg>`
	].join('\n');
}

// Estrae i tratti dal JSON nella <desc> dell'SVG
// Restituisce array vuoto se non trova dati validi
export function parseSvgStrokes(svgContent: string): Stroke[] {
	try {
		// Cerca il contenuto del tag <desc class="hwm-strokes">
		const match = svgContent.match(/<desc class="hwm-strokes">([\s\S]*?)<\/desc>/);
		if (!match) return [];

		const json = unescapeXml(match[1] ?? '');
		const parsed = JSON.parse(json);

		// Validazione base: deve essere un array di oggetti con points, color, width
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((s: Stroke) =>
			Array.isArray(s.points) && typeof s.color === 'string' && typeof s.width === 'number'
		);
	} catch {
		return [];
	}
}

// Escape caratteri speciali XML per inserimento in <desc>
function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Ripristina i caratteri XML escapati
function unescapeXml(s: string): string {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&');
}
