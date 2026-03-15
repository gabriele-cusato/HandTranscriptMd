/* =============================================
   Recognizer — Abstraction layer OCR via Gemini
   Funziona sia su Windows che su Android.
   Riceve un'immagine PNG in base64, la invia
   all'API Gemini e restituisce il testo riconosciuto.
   L'interfaccia IRecognizer permette di aggiungere
   in futuro altri backend OCR senza toccare embed.ts.
   ============================================= */

// Modello Gemini da usare per il riconoscimento visivo
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Tipo della risposta JSON di Gemini (solo i campi che ci servono)
interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
	}>;
	error?: { message?: string };
}

/* ---------- Interfaccia comune ---------- */
// Mantiene l'astrazione: in futuro si può aggiungere un backend
// alternativo (es. OCR locale) senza modificare embed.ts

export interface IRecognizer {
	recognize(imageBase64: string): Promise<string>;
}

/* ---------- GeminiRecognizer ---------- */

class GeminiRecognizer implements IRecognizer {
	constructor(
		private apiKey: string,
		private languages: string[]
	) {}

	async recognize(imageBase64: string): Promise<string> {
		// Costruisce il prompt specificando le lingue attese e il formato di output
		const langList = this.languages.join(', ');
		const prompt =
			`Sei un sistema OCR specializzato in scrittura a mano. ` +
			`Analizza l'immagine e trascrivi esattamente il testo scritto. ` +
			`Le lingue attese sono: ${langList}. ` +
			`Preserva i simboli markdown scritti dall'utente ` +
			`(es. #, ##, ###, -, *, >, \`\`\`, **testo**, *testo*, ==testo==, ~~testo~~, - [ ], - [x]). ` +
			`Restituisci SOLO il testo trascritto, senza alcuna spiegazione aggiuntiva.`;

		const resp = await fetch(`${GEMINI_URL}?key=${this.apiKey}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [{
					parts: [
						// Immagine PNG in base64
						{ inline_data: { mime_type: 'image/png', data: imageBase64 } },
						// Istruzioni OCR
						{ text: prompt }
					]
				}]
			})
		});

		// Gestione errori HTTP (chiave non valida, quota esaurita, ecc.)
		if (!resp.ok) {
			const errJson = await resp.json().catch(() => ({})) as GeminiResponse;
			throw new Error(`Gemini ${resp.status}: ${errJson?.error?.message ?? resp.statusText}`);
		}

		const json = await resp.json() as GeminiResponse;
		// Estrae il testo dal primo candidato
		const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
		return text.trim();
	}
}

/* ---------- Factory ---------- */

// Lancia un errore subito se la chiave manca, così embed.ts
// può mostrare un avviso chiaro all'utente prima di chiamare l'API
export function getRecognizer(apiKey: string, languages: string[]): IRecognizer {
	if (!apiKey.trim()) {
		throw new Error('Chiave API Gemini non configurata — aprire le impostazioni del plugin');
	}
	return new GeminiRecognizer(apiKey, languages);
}
