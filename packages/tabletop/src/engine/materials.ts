/**
 * Prozedurale Materialien (selbst erzeugt → keine fremden Assets, keine Lizenzfragen).
 */
import * as THREE from 'three';

/** Pseudo-Zufall mit Startwert, damit der Tisch bei allen gleich aussieht. */
export function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Holzplatte aus Dielen mit Maserung, Astlöchern und Fugen – warm, geölt (Eiche/Nuss).
 * Liefert Farb- und Rauheitstextur (Fugen sind rauer, Maserung leicht glänzender).
 */
export function woodTextures(size = 1024, planks = 5, seed = 7): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
    const rnd = seededRandom(seed);
    const color = document.createElement('canvas');
    const rough = document.createElement('canvas');
    color.width = color.height = rough.width = rough.height = size;
    const c = color.getContext('2d')!;
    const r = rough.getContext('2d')!;
    const plankW = size / planks;

    r.fillStyle = 'rgb(140,140,140)';
    r.fillRect(0, 0, size, size);

    for (let p = 0; p < planks; p++) {
        const x0 = p * plankW;
        // Jede Diele etwas anders getönt
        const hue = 26 + rnd() * 6, sat = 45 + rnd() * 12, light = 30 + rnd() * 8;
        const grad = c.createLinearGradient(x0, 0, x0 + plankW, 0);
        grad.addColorStop(0, `hsl(${hue},${sat}%,${light - 2}%)`);
        grad.addColorStop(0.5, `hsl(${hue + 2},${sat + 4}%,${light + 3}%)`);
        grad.addColorStop(1, `hsl(${hue},${sat}%,${light - 3}%)`);
        c.fillStyle = grad;
        c.fillRect(x0, 0, plankW, size);

        // Maserung: viele leicht gewellte Linien entlang der Diele
        const lines = 46 + Math.floor(rnd() * 20);
        for (let i = 0; i < lines; i++) {
            const baseX = x0 + rnd() * plankW;
            const amp = 2 + rnd() * 7, freq = 0.004 + rnd() * 0.01, phase = rnd() * 10;
            const dark = rnd() < 0.55;
            c.strokeStyle = dark ? `rgba(40,20,8,${0.05 + rnd() * 0.14})` : `rgba(255,220,170,${0.03 + rnd() * 0.06})`;
            c.lineWidth = 0.6 + rnd() * 2.2;
            c.beginPath();
            for (let y = 0; y <= size; y += 8) {
                const x = baseX + Math.sin(y * freq + phase) * amp + Math.sin(y * freq * 3.1 + phase) * amp * 0.3;
                if (y === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }
            c.stroke();
        }
        // Gelegentlich ein Ast mit Ringen
        if (rnd() < 0.7) {
            const kx = x0 + plankW * (0.25 + rnd() * 0.5), ky = rnd() * size, kr = 5 + rnd() * 9;
            for (let ring = 5; ring >= 0; ring--) {
                c.strokeStyle = `rgba(45,22,8,${0.10 + ring * 0.03})`;
                c.lineWidth = 1.2;
                c.beginPath();
                c.ellipse(kx, ky, kr + ring * 3.5, (kr + ring * 3.5) * 2.6, 0, 0, Math.PI * 2);
                c.stroke();
            }
            c.fillStyle = 'rgba(40,18,6,0.55)';
            c.beginPath();
            c.ellipse(kx, ky, kr * 0.6, kr * 1.4, 0, 0, Math.PI * 2);
            c.fill();
        }
        // Fuge zwischen den Dielen (dunkel, rau)
        c.fillStyle = 'rgba(20,10,4,0.75)';
        c.fillRect(x0, 0, 2, size);
        r.fillStyle = 'rgb(235,235,235)';
        r.fillRect(x0, 0, 3, size);
    }
    // Feines Rauschen gegen „zu sauber“
    const img = c.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 10;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    c.putImageData(img, 0, 0);

    const map = new THREE.CanvasTexture(color);
    map.colorSpace = THREE.SRGBColorSpace;
    const roughness = new THREE.CanvasTexture(rough);
    for (const t of [map, roughness]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }
    return { map, roughness };
}

/** Feiner Filz (für Platzsets der Sitzplätze), getönt in Spielerfarbe. */
export function feltTexture(size = 256, seed = 3): THREE.CanvasTexture {
    const rnd = seededRandom(seed);
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = 215 + rnd() * 40;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}
