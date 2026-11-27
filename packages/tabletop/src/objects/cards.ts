/**
 * Spielkarten (Engine 2.4): dünne Karte mit runden Ecken, Vorderseite aus dem Katalog des Layouts gezeichnet
 * (`layout.cards[face] = {rank, suit, color, title?, text?, icon?, bg?}`), Rückseite aus `layout.card_back`.
 * Liegt flach, Vorderseite nach oben, Kopf der Karte zeigt von Platz 0 weg (−z). Unbekannte Vorderseite → Rückseite oben.
 * Texturen werden je Vorderseite einmal gezeichnet und geteilt.
 */
import * as THREE from 'three';
import type { Layout } from '../net/state';

export const CARD_W = 0.62;
export const CARD_H = 0.88;
export const CARD_T = 0.01;

export interface CardFace {
    rank?: string;
    suit?: string;
    color?: string;
    title?: string;
    text?: string;
    icon?: string;
    bg?: string;
}

const PX_W = 256, PX_H = Math.round(256 * CARD_H / CARD_W);
const texCache = new Map<string, THREE.CanvasTexture>();

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = PX_W;
    c.height = PX_H;
    return [c, c.getContext('2d')!];
}

function texture(key: string, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    let t = texCache.get(key);
    if (t) return t;
    const [c, g] = canvas();
    draw(g);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
    return t;
}

function frontTexture(key: string, f: CardFace): THREE.CanvasTexture {
    return texture(`f:${key}`, g => {
        g.fillStyle = f.bg ?? '#fbf8f1';
        g.fillRect(0, 0, PX_W, PX_H);
        g.strokeStyle = 'rgba(0,0,0,0.18)';
        g.lineWidth = 3;
        roundRect(g, 8, 8, PX_W - 16, PX_H - 16, 14);
        g.stroke();
        const ink = f.color ?? '#1b1b1b';
        g.fillStyle = ink;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const corner = (f.rank ?? '') + '\n' + (f.suit ?? '');
        const drawCorner = () => {
            const [a, b] = corner.split('\n');
            g.font = '700 44px Georgia, serif';
            g.fillText(a, 36, 42);
            g.font = '400 38px "Segoe UI Symbol", system-ui, sans-serif';
            g.fillText(b, 36, 84);
        };
        if (f.rank || f.suit) {
            drawCorner();
            g.save();
            g.translate(PX_W, PX_H);
            g.rotate(Math.PI);
            drawCorner();
            g.restore();
        }
        const center = f.icon ?? f.suit ?? '';
        if (f.title) {
            g.font = '700 30px system-ui, sans-serif';
            g.fillText(f.title, PX_W / 2, PX_H * 0.28, PX_W - 40);
        }
        if (center) {
            g.font = `400 ${f.title || f.text ? 96 : 130}px "Segoe UI Emoji", "Segoe UI Symbol", system-ui, sans-serif`;
            g.fillText(center, PX_W / 2, PX_H * (f.text ? 0.45 : 0.52));
        }
        if (f.text) {
            g.font = '500 22px system-ui, sans-serif';
            const words = f.text.split(/\s+/);
            let line = '', y = PX_H * 0.66;
            for (const w of words) {
                const t = line ? `${line} ${w}` : w;
                if (g.measureText(t).width > PX_W - 50 && line) { g.fillText(line, PX_W / 2, y); line = w; y += 28; }
                else line = t;
            }
            if (line) g.fillText(line, PX_W / 2, y);
        }
    });
}

function backTexture(color: string, pattern: string): THREE.CanvasTexture {
    return texture(`b:${color}:${pattern}`, g => {
        g.fillStyle = '#fbf8f1';
        g.fillRect(0, 0, PX_W, PX_H);
        g.fillStyle = color;
        roundRect(g, 14, 14, PX_W - 28, PX_H - 28, 12);
        g.fill();
        g.strokeStyle = pattern;
        g.globalAlpha = 0.55;
        g.lineWidth = 2;
        for (let i = -PX_H; i < PX_W + PX_H; i += 18) {
            g.beginPath(); g.moveTo(i, 14); g.lineTo(i + PX_H, PX_H + 14); g.stroke();
            g.beginPath(); g.moveTo(i, PX_H - 14); g.lineTo(i + PX_H, -PX_H - 14); g.stroke();
        }
        g.globalAlpha = 1;
        g.lineWidth = 4;
        roundRect(g, 26, 26, PX_W - 52, PX_H - 52, 10);
        g.stroke();
    });
}

let shapeGeo: THREE.ShapeGeometry | null = null;
let edgeGeo: THREE.ExtrudeGeometry | null = null;
function geometries(): { face: THREE.ShapeGeometry; edge: THREE.ExtrudeGeometry } {
    if (!shapeGeo || !edgeGeo) {
        const s = new THREE.Shape();
        const w = CARD_W, h = CARD_H, r = 0.05, x = -w / 2, y = -h / 2;
        s.moveTo(x + r, y);
        s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
        s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
        s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
        shapeGeo = new THREE.ShapeGeometry(s, 4);
        const uv = shapeGeo.attributes.uv as THREE.BufferAttribute;
        const pos = shapeGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
        edgeGeo = new THREE.ExtrudeGeometry(s, { depth: CARD_T, bevelEnabled: false, curveSegments: 4 });
    }
    return { face: shapeGeo, edge: edgeGeo };
}

const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.8 });

/** Karte bauen. face = Schlüssel im Katalog oder null (unbekannt → Rückseite oben). */
export function createCard(face: string | null, layout: Layout): THREE.Object3D {
    const cat = (layout as Layout & { cards?: Record<string, CardFace> }).cards ?? {};
    const backSpec = (layout as Layout & { card_back?: { color?: string; pattern?: string } }).card_back ?? {};
    const back = new THREE.MeshStandardMaterial({ map: backTexture(backSpec.color ?? '#1f4e79', backSpec.pattern ?? '#d9c48a'), roughness: 0.6 });
    const front = face && cat[face]
        ? new THREE.MeshStandardMaterial({ map: frontTexture(face, cat[face]), roughness: 0.55 })
        : null;
    const { face: fg, edge } = geometries();
    const g = new THREE.Group();
    // In der Ebene x/y gebaut, flach gelegt: Kopf (+y) zeigt nach −z
    const inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2;
    const body = new THREE.Mesh(edge, edgeMat);
    body.position.z = 0;
    const top = new THREE.Mesh(fg, front ?? back);
    top.position.z = CARD_T + 0.0005;
    const bottom = new THREE.Mesh(fg, back);
    bottom.rotation.y = Math.PI;
    bottom.position.z = -0.0005;
    for (const m of [body, top, bottom]) { m.castShadow = true; m.receiveShadow = true; }
    inner.add(body, top, bottom);
    g.add(inner);
    g.userData.card = { face, known: !!front };
    return g;
}
