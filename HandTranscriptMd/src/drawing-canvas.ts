/* =============================================
   DrawingCanvas — Motore di disegno su Canvas API
   Usa curve di Bézier quadratiche (midpoint) per
   tratti fluidi. Supporta penna e gomma parziale.
   Undo/redo basato su history di stati completi
   (funziona sia per disegno che per gomma).
   ============================================= */

export interface Point {
	x: number;
	y: number;
	pressure: number;
}

export interface Stroke {
	points: Point[];
	color: string;
	width: number;
}

export type DrawMode = 'pen' | 'eraser';

// Deep copy di un array di Stroke
function cloneStrokes(strokes: Stroke[]): Stroke[] {
	return strokes.map(s => ({
		points: s.points.map(p => ({ ...p })),
		color: s.color,
		width: s.width
	}));
}

export class DrawingCanvas {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private strokes: Stroke[] = [];
	private currentStroke: Stroke | null = null;
	private mode: DrawMode = 'pen';
	private color = '#000000';
	private lineWidth = 2;
	private isDrawing = false;
	private changeCb: (() => void) | null = null;
	// Se true: siamo su mobile (Android/iOS)
	private mobileMode = false;

	// History per undo/redo: ogni entry è uno snapshot completo dei tratti.
	// Funziona sia per disegno che per gomma.
	private history: Stroke[][] = [];
	private historyIdx = -1;
	// Flag per sapere se la gomma ha modificato qualcosa durante un drag
	private eraserChanged = false;

	// Altezza di default delle settings (usata per reset su clear)
	private defaultHeight: number;

	// Righe e sfondo
	readonly LINE_SPACING = 32;
	private bgColor = '#ffffff';
	private lineColor = '#e0e0e0';

	// Auto-expand
	private readonly EXPAND_MARGIN = 40;
	private readonly EXPAND_AMOUNT = 150;

	private animFrameId: number | null = null;

	private boundDown: (e: PointerEvent) => void;
	private boundMove: (e: PointerEvent) => void;
	private boundUp: (e: PointerEvent) => void;
	private boundBeforeInput: ((e: Event) => void) | null = null;
	// Riferimento al container per il check "tap fuori"
	private container: HTMLElement | null = null;
	// Callback debug: se impostato, mostra Notice all'utente per ogni evento IME/touch
	private debugFn: ((msg: string) => void) | null = null;

	constructor(container: HTMLElement, width: number, height: number, defaultHeight: number, mobileMode = false, debugFn: ((msg: string) => void) | null = null) {
		this.canvas = document.createElement('canvas');
		this.canvas.width = width;
		this.canvas.height = height;
		this.defaultHeight = defaultHeight;
		this.mobileMode = mobileMode;
		this.container = container;
		this.debugFn = debugFn;
		// HANDWRITING ANDROID — problema aperto, vedi CLAUDE.md per storico tentativi.
		// Safety net: blocca beforeinput durante il disegno (utile anche in fullscreen)
		if (mobileMode) {
			this.boundBeforeInput = (e: Event) => {
				if (this.isDrawing) {
					this.debugFn?.('🚫 beforeinput bloccato');
					e.preventDefault();
				}
			};
			document.addEventListener('beforeinput', this.boundBeforeInput, true);
		}
		this.canvas.classList.add('hwm_canvas');
		// touch-action: none sul canvas previene scroll/zoom durante il disegno
		this.canvas.style.setProperty('touch-action', 'none', 'important');
		container.appendChild(this.canvas);

		this.ctx = this.canvas.getContext('2d')!;
		this.clearBackground();

		// Stato iniziale nella history (canvas vuoto)
		this.pushHistory();

		this.boundDown = this.onPointerDown.bind(this);
		this.boundMove = this.onPointerMove.bind(this);
		this.boundUp = this.onPointerUp.bind(this);

		this.canvas.addEventListener('pointerdown', this.boundDown);
		this.canvas.addEventListener('pointermove', this.boundMove);
		this.canvas.addEventListener('pointerup', this.boundUp);
		this.canvas.addEventListener('pointerleave', this.boundUp);
	}

	/* --- API pubblica --- */

	onChange(cb: () => void) { this.changeCb = cb; }

	setMode(mode: DrawMode) { this.mode = mode; }
	getMode(): DrawMode { return this.mode; }

	setColor(color: string) { this.color = color; }
	setLineWidth(w: number) { this.lineWidth = w; }

	getStrokes(): Stroke[] { return [...this.strokes]; }
	getWidth(): number { return this.canvas.width; }
	getHeight(): number { return this.canvas.height; }

	setBackground(bgColor: string, lineColor: string) {
		this.bgColor = bgColor;
		this.lineColor = lineColor;
		this.redraw();
	}
	getBgColor(): string { return this.bgColor; }
	getLineColor(): string { return this.lineColor; }

	loadStrokes(strokes: Stroke[]) {
		this.strokes = cloneStrokes(strokes);
		// Reset history con lo stato caricato
		this.history = [];
		this.historyIdx = -1;
		this.pushHistory();
		this.redraw();
	}

	// Torna allo stato precedente nella history
	undo(): boolean {
		if (this.historyIdx <= 0) return false;
		this.historyIdx--;
		this.strokes = cloneStrokes(this.history[this.historyIdx]!);
		this.redraw();
		this.changeCb?.();
		return true;
	}

	// Avanza allo stato successivo nella history
	redo(): boolean {
		if (this.historyIdx >= this.history.length - 1) return false;
		this.historyIdx++;
		this.strokes = cloneStrokes(this.history[this.historyIdx]!);
		this.redraw();
		this.changeCb?.();
		return true;
	}

	clear() {
		this.strokes = [];
		this.pushHistory();
		// Ridisegna subito (canvas visualmente vuoto) anche se l'altezza
		// è già quella di default (animateHeight ritornerebbe senza fare nulla)
		this.redraw();
		this.animateHeight(this.defaultHeight);
		this.changeCb?.();
	}

	resizeHeight(newHeight: number) {
		if (newHeight < 100) return;
		this.canvas.height = newHeight;
		this.redraw();
	}

	destroy() {
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
		}
		this.canvas.removeEventListener('pointerdown', this.boundDown);
		this.canvas.removeEventListener('pointermove', this.boundMove);
		this.canvas.removeEventListener('pointerup', this.boundUp);
		this.canvas.removeEventListener('pointerleave', this.boundUp);
		// Rimuove listener beforeinput (registrato solo in mobileMode)
		if (this.boundBeforeInput) {
			document.removeEventListener('beforeinput', this.boundBeforeInput, true);
			this.boundBeforeInput = null;
		}
	}

	/* --- History --- */

	// Salva uno snapshot dei tratti correnti nella history.
	// Taglia eventuali stati futuri (redo) quando si aggiunge un nuovo stato.
	private pushHistory() {
		this.history = this.history.slice(0, this.historyIdx + 1);
		this.history.push(cloneStrokes(this.strokes));
		this.historyIdx = this.history.length - 1;
	}

	/* --- Pointer Events --- */

	private onPointerDown(e: PointerEvent) {
		// pointerType vuoto ("") = evento degradato da Android → trattato come penna
		const ptype = e.pointerType || 'pen';

		// Su mobile: il dito non disegna mai
		if (this.mobileMode && ptype === 'touch') {
			this.debugFn?.('👆 Dito sul canvas');
			e.stopPropagation();
			return;
		}

		e.preventDefault();
		if (this.mobileMode) {
			this.debugFn?.(`🖊 pointerdown tipo="${e.pointerType}" → "${ptype}"`);
			e.stopPropagation();
		}
		this.canvas.setPointerCapture(e.pointerId);
		this.isDrawing = true;
		const pt = this.eventToPoint(e);

		if (this.mode === 'pen') {
			this.currentStroke = {
				points: [pt],
				color: this.color,
				width: this.lineWidth,
			};
		} else {
			// Inizio drag gomma: reset flag
			this.eraserChanged = false;
			this.eraseAt(pt);
		}
	}

	private onPointerMove(e: PointerEvent) {
		// Su mobile: ignora il dito
		if (this.mobileMode && (e.pointerType || 'pen') === 'touch') return;
		if (!this.isDrawing) return;
		e.preventDefault();
		const pt = this.eventToPoint(e);

		if (this.mode === 'pen' && this.currentStroke) {
			this.currentStroke.points.push(pt);
			this.drawSegment(this.currentStroke);
			this.checkAutoExpand(pt);
		} else if (this.mode === 'eraser') {
			this.eraseAt(pt);
		}
	}

	private onPointerUp(e: PointerEvent) {
		// Su mobile: ignora il dito
		if (this.mobileMode && (e.pointerType || 'pen') === 'touch') return;

		if (!this.isDrawing) return;
		this.isDrawing = false;

		if (this.mode === 'pen' && this.currentStroke) {
			if (this.currentStroke.points.length >= 2) {
				this.strokes.push(this.currentStroke);
				// Salva nella history dopo ogni tratto completato
				this.pushHistory();
				this.changeCb?.();
			}
			this.currentStroke = null;
		} else if (this.mode === 'eraser' && this.eraserChanged) {
			// Salva nella history dopo un drag gomma che ha cancellato qualcosa
			this.pushHistory();
			this.changeCb?.();
		}
	}

	/* --- Auto-expand --- */

	private checkAutoExpand(pt: Point) {
		// Se un'animazione è già in corso non lanciarne un'altra:
		// ripartire da un'altezza intermedia causerebbe un effetto di restringimento.
		if (this.animFrameId !== null) return;
		if (pt.y > this.canvas.height - this.EXPAND_MARGIN) {
			const newHeight = this.canvas.height + this.EXPAND_AMOUNT;
			this.animateHeight(newHeight);
		}
	}

	private animateHeight(targetHeight: number) {
		const startHeight = this.canvas.height;
		if (startHeight === targetHeight) return;

		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}

		const duration = 300;
		const startTime = performance.now();

		const step = (now: number) => {
			const elapsed = now - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const eased = 1 - Math.pow(1 - progress, 3);
			const h = Math.round(startHeight + (targetHeight - startHeight) * eased);

			this.canvas.height = h;
			this.redraw();
			if (this.currentStroke) {
				this.drawFullStroke(this.currentStroke);
			}

			if (progress < 1) {
				this.animFrameId = requestAnimationFrame(step);
			} else {
				this.animFrameId = null;
			}
		};

		this.animFrameId = requestAnimationFrame(step);
	}

	/* --- Coordinate --- */

	private eventToPoint(e: PointerEvent): Point {
		const rect = this.canvas.getBoundingClientRect();
		const scaleX = this.canvas.width / rect.width;
		const scaleY = this.canvas.height / rect.height;
		return {
			x: (e.clientX - rect.left) * scaleX,
			y: (e.clientY - rect.top) * scaleY,
			pressure: e.pressure > 0 ? e.pressure : 0.5,
		};
	}

	/* --- Gomma parziale --- */

	// La gomma rimuove solo i punti vicini, tagliando i tratti in segmenti.
	// Non salva nella history ad ogni singolo punto cancellato —
	// lo snapshot viene salvato una sola volta al pointerup.
	private eraseAt(pt: Point) {
		const radius = 15;
		const r2 = radius * radius;
		let changed = false;
		const newStrokes: Stroke[] = [];

		for (const stroke of this.strokes) {
			let segment: Point[] = [];
			let strokeTouched = false;

			for (const p of stroke.points) {
				const dx = p.x - pt.x;
				const dy = p.y - pt.y;

				if (dx * dx + dy * dy < r2) {
					if (segment.length >= 2) {
						newStrokes.push({
							points: [...segment],
							color: stroke.color,
							width: stroke.width
						});
					}
					segment = [];
					strokeTouched = true;
				} else {
					segment.push(p);
				}
			}

			if (!strokeTouched) {
				newStrokes.push(stroke);
			} else {
				changed = true;
				if (segment.length >= 2) {
					newStrokes.push({
						points: [...segment],
						color: stroke.color,
						width: stroke.width
					});
				}
			}
		}

		if (changed) {
			this.strokes = newStrokes;
			this.eraserChanged = true;
			this.redraw();
		}
	}

	/* --- Rendering --- */

	private clearBackground() {
		const w = this.canvas.width;
		const h = this.canvas.height;

		this.ctx.fillStyle = this.bgColor;
		this.ctx.fillRect(0, 0, w, h);

		this.ctx.strokeStyle = this.lineColor;
		this.ctx.lineWidth = 0.5;
		for (let y = this.LINE_SPACING; y < h; y += this.LINE_SPACING) {
			this.ctx.beginPath();
			this.ctx.moveTo(0, y);
			this.ctx.lineTo(w, y);
			this.ctx.stroke();
		}
	}

	private redraw() {
		this.clearBackground();
		for (const stroke of this.strokes) {
			this.drawFullStroke(stroke);
		}
	}

	private drawFullStroke(stroke: Stroke) {
		const pts = stroke.points;
		if (pts.length < 2) return;

		const ctx = this.ctx;
		ctx.strokeStyle = stroke.color;
		ctx.lineWidth = stroke.width;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(pts[0]!.x, pts[0]!.y);

		if (pts.length === 2) {
			ctx.lineTo(pts[1]!.x, pts[1]!.y);
		} else {
			for (let i = 1; i < pts.length - 1; i++) {
				const curr = pts[i]!;
				const next = pts[i + 1]!;
				const midX = (curr.x + next.x) / 2;
				const midY = (curr.y + next.y) / 2;
				ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
			}
			const last = pts[pts.length - 1]!;
			ctx.lineTo(last.x, last.y);
		}
		ctx.stroke();
	}

	private drawSegment(stroke: Stroke) {
		const pts = stroke.points;
		if (pts.length < 2) return;

		const ctx = this.ctx;
		ctx.strokeStyle = stroke.color;
		ctx.lineWidth = stroke.width;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();

		if (pts.length === 2) {
			ctx.moveTo(pts[0]!.x, pts[0]!.y);
			ctx.lineTo(pts[1]!.x, pts[1]!.y);
		} else {
			const i = pts.length - 2;
			const prev = i > 0 ? pts[i - 1]! : pts[0]!;
			const curr = pts[i]!;
			const next = pts[i + 1]!;
			const startX = (prev.x + curr.x) / 2;
			const startY = (prev.y + curr.y) / 2;
			const endX = (curr.x + next.x) / 2;
			const endY = (curr.y + next.y) / 2;

			ctx.moveTo(startX, startY);
			ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
		}
		ctx.stroke();
	}
}
