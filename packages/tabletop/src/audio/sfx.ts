/**
 * Tisch-Geräusche, synthetisch erzeugt (keine fremden Audiodateien):
 * Holz auf Holz, Würfelbecher, Schritte, Rauswurf, Zielhaus, Zugwechsel & Fanfare.
 * Browser erlauben Ton erst nach einer Geste – `unlockAudioOnGesture()` hängt sich an den ersten Tipp/Klick.
 */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

function audio(): AudioContext | null {
    if (muted) return null;
    if (!ctx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
}

function noiseBuffer(c: AudioContext): AudioBuffer {
    if (noise) return noise;
    noise = c.createBuffer(1, c.sampleRate * 0.25, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noise;
}

export function setMuted(v: boolean): void {
    muted = v;
}

export function unlockAudioOnGesture(target: EventTarget = window): void {
    const once = () => { audio(); target.removeEventListener('pointerdown', once); };
    target.addEventListener('pointerdown', once);
}

/** Hilfsfunktion: weicher Marimba-/Holzklang-Ton zu Zeitpunkt `at`. */
function tone(
    c: AudioContext,
    freq: number,
    at: number,
    dur: number,
    vol: number,
    type: OscillatorType = 'triangle',
    endFreq?: number
): void {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq && endFreq !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), at + dur);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(c.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
}

/**
 * Kurzer Holz-„Klack“: gefiltertes Rauschen (Anschlag) + gedämpfter Resonanzton (Holzkörper).
 * volume 0..1, pitch ~1 (Figur auf Brett), höher = kleiner/härter.
 */
export function knock(volume = 0.6, pitch = 1): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.value = volume * 0.85;
    out.connect(c.destination);

    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1850 * pitch * (0.9 + Math.random() * 0.2);
    bp.Q.value = 1.5;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.85, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(bp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.08);

    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(410 * pitch * (0.94 + Math.random() * 0.12), t);
    osc.frequency.exponentialRampToValueAtTime(250 * pitch, t + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.14);
}

/** Leises Aufnehmen (Figur löst sich vom Brett). */
export function lift(volume = 0.35): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(c, 520, t, 0.06, volume * 0.25, 'sine', 760);
    knock(volume * 0.35, 1.65);
}

/** Schritt-für-Schritt-Hüpfen mit leicht ansteigender Tonhöhe. */
export function step(stepIndex = 0, isFinal = false): void {
    const pitch = isFinal ? 0.96 : (0.98 + (stepIndex % 6) * 0.065);
    knock(isFinal ? 0.58 : 0.34, pitch);
}

/** Klappern im Lederbecher (deutlich anders als Holzfigur). */
export function rattle(volume = 0.3): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200 * (0.85 + Math.random() * 0.35);
    bp.Q.value = 3.2;
    const ng = c.createGain();
    ng.gain.setValueAtTime(volume * 0.65, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.032);
    src.connect(bp).connect(ng).connect(c.destination);
    src.start(t);
    src.stop(t + 0.05);
    tone(c, 1150 * (0.9 + Math.random() * 0.25), t, 0.028, volume * 0.14, 'triangle', 750);
}

/** Elfenbein-Würfel prallt auf das Holzbrett. */
export function dieBounce(volume = 0.45): void {
    const c = audio();
    if (!c) return;
    knock(volume, 2.25 + Math.random() * 0.35);
}

/** Hoher Wurf (z. B. 6 gewürfelt): heller Zweiklang. */
export function rolledHigh(): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(c, 784, t, 0.11, 0.16, 'triangle');       // G5
    tone(c, 1046.5, t + 0.075, 0.22, 0.18, 'triangle'); // C6
}

/** Figur geschlagen / rausgeworfen: knackiger Schlag + abfallender Rutschton. */
export function capture(): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    knock(0.75, 0.78);
    tone(c, 540, t + 0.02, 0.22, 0.22, 'triangle', 145);
    tone(c, 220, t + 0.04, 0.18, 0.15, 'sine', 95);
}

/** Figur erreicht das Zielhaus: warmer Dreiklang. */
export function goal(): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(c, 523.25, t, 0.16, 0.16, 'triangle');       // C5
    tone(c, 659.25, t + 0.07, 0.18, 0.16, 'triangle'); // E5
    tone(c, 783.99, t + 0.14, 0.28, 0.18, 'triangle'); // G5
}

/** Sanftes Signal, wenn du am Zug bist. */
export function turnChime(): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(c, 440, t, 0.12, 0.11, 'sine');       // A4
    tone(c, 587.33, t + 0.08, 0.18, 0.12, 'sine'); // D5
}

/** Unerlaubter Zug: gedämpftes tiefes „Mööp“/Klopfen. */
export function reject(): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(c, 185, t, 0.09, 0.18, 'triangle', 140);
    tone(c, 145, t + 0.08, 0.13, 0.18, 'triangle', 105);
}

/** Spielende / Siegerehrung. */
export function win(): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(c, 523.25, t, 0.14, 0.16, 'triangle');        // C5
    tone(c, 659.25, t + 0.09, 0.14, 0.16, 'triangle'); // E5
    tone(c, 783.99, t + 0.18, 0.14, 0.17, 'triangle'); // G5
    tone(c, 1046.5, t + 0.28, 0.42, 0.2, 'triangle');  // C6
}

export function vibrate(ms: number | number[]): void {
    try { navigator.vibrate?.(ms); } catch { /* nicht unterstützt */ }
}
