/**
 * Tisch-Geräusche, synthetisch erzeugt (keine fremden Audiodateien): Holz auf Holz, Aufnehmen.
 * Browser erlauben Ton erst nach einer Geste – `unlock()` hängt sich an den ersten Tipp/Klick.
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

/**
 * Kurzer Holz-„Klack“: gefiltertes Rauschen (Anschlag) + gedämpfter Resonanzton (Holzkörper).
 * volume 0..1, pitch ~1 (Figur auf Brett), höher = kleiner/härter.
 */
export function knock(volume = 0.6, pitch = 1): void {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.value = volume * 0.9;
    out.connect(c.destination);

    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900 * pitch * (0.9 + Math.random() * 0.2);
    bp.Q.value = 1.4;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(bp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.08);

    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420 * pitch * (0.95 + Math.random() * 0.1), t);
    osc.frequency.exponentialRampToValueAtTime(260 * pitch, t + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.14);
}

/** Leises Aufnehmen (Figur löst sich vom Brett). */
export function lift(volume = 0.35): void {
    knock(volume * 0.5, 1.6);
}

export function vibrate(ms: number | number[]): void {
    try { navigator.vibrate?.(ms); } catch { /* nicht unterstützt */ }
}
