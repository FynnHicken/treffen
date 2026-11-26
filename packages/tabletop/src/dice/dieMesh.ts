/**
 * Sechsseitiger Würfel: abgerundeter Würfelkörper, elfenbeinfarben, vertiefte Augen (selbst gezeichnet).
 * Gegenüberliegende Seiten ergeben 7. Seitenreihenfolge wie BoxGeometry: +x, −x, +y, −y, +z, −z.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const FACE_VALUES = [2, 5, 1, 6, 3, 4];
export const FACE_NORMALS = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
];

/** Lokale Normale der Seite mit dem Wert v */
export function normalForValue(v: number): THREE.Vector3 {
    return FACE_NORMALS[FACE_VALUES.indexOf(v)].clone();
}

/** Welche Zahl liegt oben, wenn der Würfel so gedreht ist? */
export function topValue(q: THREE.Quaternion): number {
    let best = 0, bestY = -Infinity;
    FACE_NORMALS.forEach((n, i) => {
        const y = n.clone().applyQuaternion(q).y;
        if (y > bestY) { bestY = y; best = i; }
    });
    return FACE_VALUES[best];
}

const PIPS: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.27, 0.23], [0.73, 0.23], [0.27, 0.5], [0.73, 0.5], [0.27, 0.77], [0.73, 0.77]]
};

const faceTextures = new Map<number, THREE.CanvasTexture>();

function faceTexture(value: number): THREE.CanvasTexture {
    const cached = faceTextures.get(value);
    if (cached) return cached;
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c = cv.getContext('2d')!;
    // Elfenbein mit leichtem Verlauf zur Kante (wirkt gerundet)
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.75);
    g.addColorStop(0, '#fbf6ea');
    g.addColorStop(1, '#e9dfc8');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    const r = value === 1 ? s * 0.11 : s * 0.085;
    for (const [px, py] of PIPS[value]) {
        const x = px * s, y = py * s;
        // Vertiefung: heller Rand unten rechts, dunkle Mitte
        c.fillStyle = 'rgba(255,255,255,0.7)';
        c.beginPath(); c.arc(x + r * 0.12, y + r * 0.14, r * 1.05, 0, Math.PI * 2); c.fill();
        const pg = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        pg.addColorStop(0, value === 1 ? '#a3241b' : '#1a1715');
        pg.addColorStop(1, value === 1 ? '#6e140f' : '#3a3430');
        c.fillStyle = pg;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    faceTextures.set(value, t);
    return t;
}

let geometry: RoundedBoxGeometry | null = null;

export function createDie(size: number): THREE.Mesh {
    if (!geometry) geometry = new RoundedBoxGeometry(size, size, size, 4, size * 0.14);
    const mats = FACE_VALUES.map(v => new THREE.MeshPhysicalMaterial({
        map: faceTexture(v), roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2
    }));
    const mesh = new THREE.Mesh(geometry, mats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
