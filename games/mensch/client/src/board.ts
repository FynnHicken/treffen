/**
 * Das Mensch-Brett als bedruckter Karton: Druckbild auf Canvas (selbst gezeichnet), Kartonkante darunter.
 * Felder/Positionen kommen aus dem Server-Layout (games/mensch/server/layout.py).
 */
import * as THREE from 'three';
import { seededRandom, type Layout } from '@treffen/tabletop';

export const BOARD_THICKNESS = 0.12;

export function createBoard(layout: Layout, anisotropy: number, hiRes: boolean): THREE.Group {
    const size = layout.board?.size ?? 9.7;
    const group = new THREE.Group();

    // Kartonkörper (dunkelblaue Kaschierung wie bei vielen Spielbrettern, Kanten leicht heller)
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(size, BOARD_THICKNESS, size),
        new THREE.MeshStandardMaterial({ color: 0x1f2c4a, roughness: 0.85 })
    );
    body.position.y = BOARD_THICKNESS / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Druckbild oben
    const tex = new THREE.CanvasTexture(drawBoard(layout, size, hiRes ? 2048 : 1536));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    const top = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.4 })
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = BOARD_THICKNESS + 0.0005;
    top.receiveShadow = true;
    group.add(top);
    return group;
}

function drawBoard(layout: Layout, size: number, px: number): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const c = cv.getContext('2d')!;
    const k = px / size;                                     // Pixel pro Tisch-Einheit
    const X = (x: number) => (x + size / 2) * k;
    const Z = (z: number) => (z + size / 2) * k;
    const pal = layout.palette ?? {};
    const color = (name?: string) => (name && pal[name]) || '#999';
    const spacing = layout.board?.spacing ?? 0.8;
    const R = spacing * 0.36 * k;                            // Feldradius

    // Papier: warmes Creme mit leichter Wolkigkeit und Faserrauschen
    c.fillStyle = '#f4e7c6';
    c.fillRect(0, 0, px, px);
    const rnd = seededRandom(11);
    for (let i = 0; i < 70; i++) {
        const g = c.createRadialGradient(rnd() * px, rnd() * px, 0, rnd() * px, rnd() * px, px * (0.1 + rnd() * 0.25));
        g.addColorStop(0, `rgba(${rnd() < 0.5 ? '255,250,235' : '214,190,140'},0.08)`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, px, px);
    }
    // Rahmenlinie
    c.strokeStyle = '#3b2a1a';
    c.lineWidth = k * 0.05;
    c.strokeRect(k * 0.18, k * 0.18, px - k * 0.36, px - k * 0.36);

    const fields = layout.fields;
    const track = Object.entries(fields).filter(([, f]) => f.kind === 'track' || f.kind === 'start')
        .sort((a, b) => (a[1].index ?? 0) - (b[1].index ?? 0)).map(([, f]) => f);

    // Laufbahn-Verbindungen
    c.strokeStyle = '#2d2118';
    c.lineWidth = k * 0.07;
    c.lineCap = 'round';
    c.beginPath();
    track.forEach((f, i) => (i === 0 ? c.moveTo(X(f.x), Z(f.z)) : c.lineTo(X(f.x), Z(f.z))));
    c.closePath();
    c.stroke();

    // Zielstraßen (vom Eingangsfeld zur Mitte) + Pfeil
    for (const name of Object.keys(pal)) {
        const goals = Object.values(fields).filter(f => f.kind === 'goal' && f.color === name)
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (!goals.length) continue;
        const start = track.find(f => f.kind === 'start' && f.color === name);
        const entryIdx = start ? ((start.index ?? 0) + track.length - 1) % track.length : -1;
        const entry = track[entryIdx];
        c.strokeStyle = color(name);
        c.lineWidth = k * 0.1;
        c.beginPath();
        c.moveTo(X(entry.x), Z(entry.z));
        goals.forEach(g => c.lineTo(X(g.x), Z(g.z)));
        c.stroke();
        drawArrow(c, X(entry.x), Z(entry.z), X(goals[0].x), Z(goals[0].z), R, color(name));
    }

    // Felder
    for (const f of Object.values(fields)) {
        const cx = X(f.x), cy = Z(f.z);
        const fill = f.kind === 'track' ? '#fbf6ea' : color(f.color);
        // Schatten-Prägung
        c.fillStyle = 'rgba(60,40,20,0.25)';
        c.beginPath(); c.arc(cx + R * 0.06, cy + R * 0.08, R, 0, Math.PI * 2); c.fill();
        c.fillStyle = fill;
        c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
        c.lineWidth = k * 0.045;
        c.strokeStyle = '#2d2118';
        c.stroke();
        if (f.kind !== 'track') {
            // Innenring (wie gedruckte Vertiefung)
            c.lineWidth = k * 0.02;
            c.strokeStyle = 'rgba(255,255,255,0.45)';
            c.beginPath(); c.arc(cx, cy, R * 0.72, 0, Math.PI * 2); c.stroke();
        }
        if (f.kind === 'start' || (f.kind === 'home' && f.index === 0)) {
            // Beschriftung zum Platz der jeweiligen Farbe gedreht (Platz 0 unten, im Uhrzeigersinn)
            const seat = Math.max(0, Object.keys(pal).indexOf(f.color ?? ''));
            const dark = f.color === 'yellow';
            c.save();
            c.translate(cx, cy);
            c.rotate((seat * Math.PI) / 2);
            c.fillStyle = dark ? '#3b2a12' : '#fff8e6';
            c.font = `700 ${Math.round(R * 1.05)}px Georgia, "Times New Roman", serif`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(f.kind === 'start' ? 'A' : 'B', 0, R * 0.05);
            c.restore();
        }
    }

    // Feines Papierkorn
    const img = c.getImageData(0, 0, px, px);
    for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 9;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    c.putImageData(img, 0, 0);
    return cv;
}

function drawArrow(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number, color: string): void {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    c.save();
    c.translate(mx, my);
    c.rotate(a);
    c.fillStyle = color;
    c.strokeStyle = '#2d2118';
    c.lineWidth = r * 0.12;
    c.beginPath();
    c.moveTo(r * 0.45, 0);
    c.lineTo(-r * 0.3, -r * 0.38);
    c.lineTo(-r * 0.3, r * 0.38);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
}
