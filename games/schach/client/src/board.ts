/**
 * Schachbrett aus Holz: Nussbaum-Rahmen mit eingravierten Koordinaten, eingelegte Felder aus Ahorn und Nuss
 * (jedes Feld mit eigener Maserung), daneben zwei Filz-Ablagen für geschlagene Figuren.
 * Alles prozedural gezeichnet – keine fremden Assets. Positionen kommen aus dem Server-Layout
 * (games/schach/server/layout.py).
 */
import * as THREE from 'three';
import { feltTexture, seededRandom, type FieldSpec, type Layout } from '@treffen/tabletop';

export const BOARD_THICKNESS = 0.16;

/** Brett passend zum Layout: klassisch (auch Teamschach), Tandem (zwei Bretter) oder Vierschach (Kreuz). */
export function createBoard(layout: Layout, anisotropy: number, hiRes: boolean): THREE.Group {
    const kind = layout.board?.kind ?? 'chess';
    const S = layout.board?.spacing ?? 0.92;
    const frame = (layout.board?.frame as number | undefined) ?? 0.55;
    const group = new THREE.Group();
    const px = hiRes ? 2048 : 1536;

    if (kind === 'tandem') {
        const boards = (layout.board?.boards ?? {}) as Record<string, { cx: number; cz: number; size: number; white_front: boolean }>;
        for (const [id, b] of Object.entries(boards)) {
            const fields = Object.values(layout.fields).filter(f => f.kind === 'square' && (f as any).board === id)
                .map(f => ({ ...f, x: f.x - b.cx, z: f.z - b.cz }));
            const sub = squareBoard(fields, b.size, S, frame, !b.white_front, anisotropy, px / 2 * 1.5);
            sub.position.set(b.cx, 0, b.cz);
            group.add(sub);
        }
        feltPads(group, layout, f => f.kind === 'reserve' ? `${(f as any).board}-${f.color}` : null, 0x2f4a3a);
    } else if (kind === 'vierer') {
        group.add(crossBoard(layout, S, frame, anisotropy, px));
        feltPads(group, layout, f => f.kind === 'tray' ? String((f as any).seat) : null, 0x2f4a3a);
    } else {
        const size = layout.board?.size ?? 8.46;
        group.add(squareBoard(Object.values(layout.fields).filter(f => f.kind === 'square'), size, S, frame, false, anisotropy, px));
        // Filz-Ablagen links und rechts (dort landen geschlagene Figuren)
        feltPads(group, layout, f => f.kind === 'tray' ? String(Math.sign(f.x)) : null, 0x2f4a3a);
    }
    return group;      // letzter Zug / Schach markiert die Engine (marks der Regeln)
}

/** Quadratisches Holzbrett (Nussbaum-Rahmen, eingelegte Felder); Felder in Brett-Koordinaten (Mitte = 0,0). */
function squareBoard(fields: FieldSpec[], size: number, S: number, frame: number, flip: boolean, anisotropy: number,
    px: number): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
        roundedBox(size, BOARD_THICKNESS, size, 0.06),
        new THREE.MeshPhysicalMaterial({ color: 0x3b2416, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35 })
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const tex = new THREE.CanvasTexture(drawBoard(fields, size, S, frame, flip, Math.round(px)));
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
    return group;
}

/** Filz-Unterlagen unter Ablage-/Vorratsfeldern, je Gruppe (key) ein Rechteck um die Felder */
function feltPads(group: THREE.Group, layout: Layout, key: (f: FieldSpec) => string | null, color: number): void {
    const felt = feltTexture(256, 9);
    felt.repeat.set(2, 2);
    const groups = new Map<string, FieldSpec[]>();
    for (const f of Object.values(layout.fields)) {
        const k = key(f);
        if (k !== null) groups.set(k, [...(groups.get(k) ?? []), f]);
    }
    const S = layout.board?.spacing ?? 0.92;
    const pad = Math.min(0.8, S * 0.9);
    for (const fs of groups.values()) {
        const xs = fs.map(f => f.x), zs = fs.map(f => f.z);
        const w = Math.max(...xs) - Math.min(...xs) + pad, d = Math.max(...zs) - Math.min(...zs) + pad;
        const mat = new THREE.MeshStandardMaterial({ color, map: felt, roughness: 0.96 });
        const mesh = new THREE.Mesh(roundedRectGeo(w, d, 0.2), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set((Math.max(...xs) + Math.min(...xs)) / 2, 0.006, (Math.max(...zs) + Math.min(...zs)) / 2);
        mesh.receiveShadow = true;
        group.add(mesh);
    }
}

/** Vierschach: kreuzförmiges Brett (14×14 ohne die 3×3-Ecken) mit Rahmen in den vier Farben der Heere */
function crossBoard(layout: Layout, S: number, frame: number, anisotropy: number, px: number): THREE.Group {
    const n = 14, cut = (layout.board?.cut as number | undefined) ?? 3;
    const L = n * S + 2 * frame;                  // Kantenlänge
    const w = (n - 2 * cut) * S / 2 + frame;      // halbe Armbreite
    const shape = new THREE.Shape();
    const h = L / 2;
    const pts: [number, number][] = [[-w, -h], [w, -h], [w, -w], [h, -w], [h, w], [w, w], [w, h], [-w, h], [-w, w], [-h, w], [-h, -w], [-w, -w]];
    shape.moveTo(...pts[0]);
    for (const p of pts.slice(1)) shape.lineTo(...p);
    shape.closePath();

    const group = new THREE.Group();
    const bodyGeo = new THREE.ExtrudeGeometry(shape, {
        depth: BOARD_THICKNESS - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2
    });
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(0, 0.02, 0);
    const body = new THREE.Mesh(bodyGeo,
        new THREE.MeshPhysicalMaterial({ color: 0x3b2416, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35 }));
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const fields = Object.values(layout.fields).filter(f => f.kind === 'square');
    const tex = new THREE.CanvasTexture(drawCross(fields, L, w, S, layout, px));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    const topGeo = new THREE.ShapeGeometry(shape);
    const pos = topGeo.attributes.position, uv = topGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + h) / L, (pos.getY(i) + h) / L);
    const top = new THREE.Mesh(topGeo,
        new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.22 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = BOARD_THICKNESS + 0.0005;
    top.receiveShadow = true;
    group.add(top);
    return group;
}

function drawCross(fields: FieldSpec[], L: number, w: number, S: number, layout: Layout, px: number): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const c = cv.getContext('2d')!;
    const k = px / L;
    const X = (x: number) => (x + L / 2) * k;
    const rnd = seededRandom(31);
    woodFill(c, 0, 0, px, px, [58, 36, 22], rnd, true, 1.6);
    // Farbige Leisten vor jedem Heer (Platz 0 vorn, 1 links, 2 hinten, 3 rechts)
    const pal = Object.values(layout.palette ?? {});
    const edge = k * 0.12;
    const arm = (w - 0.08) * 2 * k;
    const strips: [number, number, number, number][] = [
        [X(-w + 0.04), px - edge, arm, edge * 0.6], [0 + edge * 0.4, X(-w + 0.04), edge * 0.6, arm],
        [X(-w + 0.04), edge * 0.4, arm, edge * 0.6], [px - edge, X(-w + 0.04), edge * 0.6, arm]
    ];
    strips.forEach(([x, y, sw, sh], i) => { c.fillStyle = pal[i] ?? '#c9a66b'; c.globalAlpha = 0.8; c.fillRect(x, y, sw, sh); });
    c.globalAlpha = 1;
    for (const f of fields) {
        const x0 = X(f.x - S / 2), y0 = X(f.z - S / 2), sz = S * k;
        const dark = f.color === 'dark';
        woodFill(c, x0, y0, sz, sz, dark ? [110, 68, 40] : [226, 196, 146], rnd, (Math.round(f.x / S + f.z / S) & 1) === 0, dark ? 1 : 0.7);
        c.strokeStyle = 'rgba(30,16,8,0.35)';
        c.lineWidth = Math.max(1, k * 0.008);
        c.strokeRect(x0 + 0.5, y0 + 0.5, sz - 1, sz - 1);
    }
    return cv;
}

function drawBoard(fields: FieldSpec[], size: number, S: number, frameW: number, flip: boolean, px: number): HTMLCanvasElement {
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

    for (const f of fields) {
        const x0 = X(f.x - S / 2), y0 = X(f.z - S / 2), w = S * k;
        const dark = f.color === 'dark';
        woodFill(c, x0, y0, w, w, dark ? [110, 68, 40] : [226, 196, 146], rnd, (Math.round(f.x / S + f.z / S) & 1) === 0, dark ? 1 : 0.7);
        // feine Fuge
        c.strokeStyle = 'rgba(30,16,8,0.35)';
        c.lineWidth = Math.max(1, k * 0.008);
        c.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, w - 1);
    }

    // Koordinaten im Rahmen (gravierter, hellerer Ton) – für Weiß unten lesbar, für Schwarz oben gedreht
    // (flip: Brett um 180° gedreht, Weiß sitzt hinten – Tandem-Brett B)
    const files = 'abcdefgh';
    const frame = frameW;
    c.font = `600 ${Math.round(k * frame * 0.42)}px Georgia, "Times New Roman", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const engrave = (text: string, x: number, y: number, rot: number) => {
        c.save();
        c.translate(x, y);
        c.rotate(rot + (flip ? Math.PI : 0));
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.fillText(text, 1.5, 1.5);
        c.fillStyle = '#d8b57a';
        c.fillText(text, 0, 0);
        c.restore();
    };
    const m = flip ? -1 : 1;
    for (let i = 0; i < 8; i++) {
        const fx = X(m * (i - 3.5) * S), rz = X(m * (3.5 - i) * S);
        engrave(files[i], fx, X(m * (half + frame / 2)), 0);                  // vorn (Weiß)
        engrave(files[i], fx, X(-m * (half + frame / 2)), Math.PI);           // hinten (Schwarz)
        engrave(String(i + 1), X(-m * (half + frame / 2)), rz, 0);
        engrave(String(i + 1), X(m * (half + frame / 2)), rz, Math.PI);
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
