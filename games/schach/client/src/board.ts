/**
 * Schachbrett aus Holz: Nussbaum-Rahmen mit eingravierten Koordinaten, eingelegte Felder aus Ahorn und Nuss
 * (jedes Feld mit eigener Maserung), daneben zwei Filz-Ablagen für geschlagene Figuren.
 * Alles prozedural gezeichnet – keine fremden Assets. Positionen kommen aus dem Server-Layout
 * (games/schach/server/layout.py).
 */
import * as THREE from 'three';
import { feltTexture, seededRandom, type Layout } from '@treffen/tabletop';

export const BOARD_THICKNESS = 0.16;

export interface ChessBoard {
    group: THREE.Group;
    /** letzten Zug dezent markieren (beide Felder), null = keine Markierung */
    setLastMove(from: string | null, to: string | null): void;
    /** König im Schach: rotes Glimmen unter dem Feld, null = aus */
    setCheck(square: string | null): void;
}

export function createBoard(layout: Layout, anisotropy: number, hiRes: boolean): ChessBoard {
    const size = layout.board?.size ?? 8.46;
    const S = layout.board?.spacing ?? 0.92;
    const group = new THREE.Group();

    // Holzkörper mit gerundeter Kante
    const body = new THREE.Mesh(
        roundedBox(size, BOARD_THICKNESS, size, 0.06),
        new THREE.MeshPhysicalMaterial({ color: 0x3b2416, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35 })
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const tex = new THREE.CanvasTexture(drawBoard(layout, size, S, hiRes ? 2048 : 1536));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    const top = new THREE.Mesh(
        new THREE.PlaneGeometry(size - 0.02, size - 0.02),
        new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.22 })
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = BOARD_THICKNESS + 0.0005;
    top.receiveShadow = true;
    group.add(top);

    // Filz-Ablagen links und rechts (dort landen geschlagene Figuren)
    const felt = feltTexture(256, 9);
    felt.repeat.set(1, 3);
    for (const side of [-1, 1]) {
        const tray = Object.values(layout.fields).filter(f => f.kind === 'tray' && Math.sign(f.x) === side);
        if (!tray.length) continue;
        const xs = tray.map(f => f.x), zs = tray.map(f => f.z);
        const w = Math.max(...xs) - Math.min(...xs) + 0.8, d = Math.max(...zs) - Math.min(...zs) + 0.8;
        const mat = new THREE.MeshStandardMaterial({ color: 0x2f4a3a, map: felt, roughness: 0.96 });
        const pad = new THREE.Mesh(roundedRectGeo(w, d, 0.2), mat);
        pad.rotation.x = -Math.PI / 2;
        pad.position.set((Math.max(...xs) + Math.min(...xs)) / 2, 0.006, (Math.max(...zs) + Math.min(...zs)) / 2);
        pad.receiveShadow = true;
        group.add(pad);
    }

    // Markierungen (statisch, nur bei Änderung neu gezeichnet)
    const mark = (color: number, opacity: number) => {
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(S * 0.98, S * 0.98),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = BOARD_THICKNESS + 0.002;
        m.visible = false;
        m.renderOrder = 2;
        group.add(m);
        return m;
    };
    const last = [mark(0xffd27a, 0.22), mark(0xffd27a, 0.3)];
    const glowTex = new THREE.CanvasTexture(radialGlow());
    const check = new THREE.Mesh(
        new THREE.PlaneGeometry(S * 1.25, S * 1.25),
        new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff3b2f, transparent: true, depthWrite: false, opacity: 0.85 })
    );
    check.rotation.x = -Math.PI / 2;
    check.position.y = BOARD_THICKNESS + 0.003;
    check.visible = false;
    check.renderOrder = 3;
    group.add(check);

    const at = (sq: string) => layout.fields[sq];
    return {
        group,
        setLastMove(from, to) {
            [from, to].forEach((sq, i) => {
                const f = sq ? at(sq) : undefined;
                last[i].visible = !!f;
                if (f) last[i].position.set(f.x, BOARD_THICKNESS + 0.002, f.z);
            });
        },
        setCheck(sq) {
            const f = sq ? at(sq) : undefined;
            check.visible = !!f;
            if (f) check.position.set(f.x, BOARD_THICKNESS + 0.003, f.z);
        }
    };
}

function drawBoard(layout: Layout, size: number, S: number, px: number): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const c = cv.getContext('2d')!;
    const k = px / size;
    const X = (x: number) => (x + size / 2) * k;
    const rnd = seededRandom(23);

    // Rahmen: Nussbaum mit Längsmaserung
    woodFill(c, 0, 0, px, px, [58, 36, 22], rnd, true, 1.6);

    const half = 4 * S;
    // Eingelegte Zierleiste (heller Span) um die Felder
    c.fillStyle = '#c9a66b';
    c.fillRect(X(-half) - k * 0.07, X(-half) - k * 0.07, 8 * S * k + k * 0.14, 8 * S * k + k * 0.14);
    c.fillStyle = '#2a170c';
    c.fillRect(X(-half) - k * 0.035, X(-half) - k * 0.035, 8 * S * k + k * 0.07, 8 * S * k + k * 0.07);

    for (const [, f] of Object.entries(layout.fields)) {
        if (f.kind !== 'square') continue;
        const x0 = X(f.x - S / 2), y0 = X(f.z - S / 2), w = S * k;
        const dark = f.color === 'dark';
        woodFill(c, x0, y0, w, w, dark ? [110, 68, 40] : [226, 196, 146], rnd, (Math.round(f.x / S + f.z / S) & 1) === 0, dark ? 1 : 0.7);
        // feine Fuge
        c.strokeStyle = 'rgba(30,16,8,0.35)';
        c.lineWidth = Math.max(1, k * 0.008);
        c.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, w - 1);
    }

    // Koordinaten im Rahmen (gravierter, hellerer Ton) – für Weiß unten lesbar, für Schwarz oben gedreht
    const files = 'abcdefgh';
    const frame = (size - 8 * S) / 2;
    c.font = `600 ${Math.round(k * frame * 0.42)}px Georgia, "Times New Roman", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const engrave = (text: string, x: number, y: number, rot: number) => {
        c.save();
        c.translate(x, y);
        c.rotate(rot);
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.fillText(text, 1.5, 1.5);
        c.fillStyle = '#d8b57a';
        c.fillText(text, 0, 0);
        c.restore();
    };
    for (let i = 0; i < 8; i++) {
        const fx = X((i - 3.5) * S), rz = X((3.5 - i) * S);
        engrave(files[i], fx, X(half + frame / 2), 0);                  // unten (Weiß)
        engrave(files[i], fx, X(-half - frame / 2), Math.PI);           // oben (Schwarz)
        engrave(String(i + 1), X(-half - frame / 2), rz, 0);
        engrave(String(i + 1), X(half + frame / 2), rz, Math.PI);
    }
    return cv;
}

/** Holzfläche mit Maserung: Grundton, wellige Jahresringe, feines Korn */
function woodFill(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    rgb: [number, number, number], rnd: () => number, vertical: boolean, strength: number): void {
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    const [r, g, b] = rgb;
    const tone = (d: number) => `rgb(${r + d},${g + d * 0.8},${b + d * 0.6})`;
    c.fillStyle = tone((rnd() - 0.5) * 14);
    c.fillRect(x, y, w, h);
    const lines = Math.max(6, Math.round((vertical ? w : h) / 7));
    const phase = rnd() * 10;
    for (let i = 0; i < lines; i++) {
        const t = (i + rnd() * 0.6) / lines;
        c.strokeStyle = `rgba(${rnd() < 0.5 ? '40,20,8' : '255,235,200'},${(0.05 + rnd() * 0.08) * strength})`;
        c.lineWidth = 1 + rnd() * 2.2;
        c.beginPath();
        const steps = 12;
        for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            const wave = Math.sin(u * 5 + phase + i * 0.7) * 3 + Math.sin(u * 13 + i) * 1.2;
            const px = vertical ? x + t * w + wave : x + u * w;
            const py = vertical ? y + u * h : y + t * h + wave;
            if (s === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
    }
    c.restore();
}

function radialGlow(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d')!;
    const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    return cv;
}

function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    const x = -w / 2, z = -d / 2;
    shape.moveTo(x + r, z);
    shape.lineTo(x + w - r, z); shape.quadraticCurveTo(x + w, z, x + w, z + r);
    shape.lineTo(x + w, z + d - r); shape.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
    shape.lineTo(x + r, z + d); shape.quadraticCurveTo(x, z + d, x, z + d - r);
    shape.lineTo(x, z + r); shape.quadraticCurveTo(x, z, x + r, z);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 6 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.02, 0);
    return geo;
}

function roundedRectGeo(w: number, h: number, r: number): THREE.ShapeGeometry {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return new THREE.ShapeGeometry(s, 8);
}
