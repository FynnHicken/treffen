/**
 * Standard-Figuren der Engine (2.3) – ein Spiel nennt nur die Art (`kind` im Layout), die Engine baut das Modell:
 *
 *   pawn   Pöppel (Mensch, Halma)                 disc    Spielstein, flach mit Rille (Dame, Mühle)
 *   king   Doppelstein (Dame: gekrönter Stein)    stone   gewölbter Stein (Go)
 *   flip   Wendestein, oben Farbe, unten `back` (Reversi)
 *   cube   Würfelchen/Holzklotz (Siedeln, Marker)  cone    Kegel (Spielfigur, Marker)
 *   ring   Ring / Chip mit Loch (Punkte-Marker)
 *
 * Farbe: `color` der Figur – ein Name aus `layout.palette` oder direkt "#rrggbb". Größe passt sich dem
 * Feldabstand an (`layout.board.spacing`, Standard 0,8). Unbekannte Art → Pöppel.
 */
import * as THREE from 'three';
import type { Layout, PieceSpec } from '../net/state';
import { createPawn, lacqueredWood } from './pawn';

const geos = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = geos.get(key);
    if (!g) { g = make(); geos.set(key, g); }
    return g;
}

/** Flacher Stein mit gerundeter Kante und Rille (Drehkörper) */
function discGeometry(h: number): THREE.BufferGeometry {
    return geo(`disc${h}`, () => {
        const r = 0.31, pts: THREE.Vector2[] = [];
        const add = (x: number, y: number) => pts.push(new THREE.Vector2(x, y));
        add(0.0001, 0); add(r - 0.02, 0); add(r, 0.018); add(r, h - 0.018); add(r - 0.02, h);
        add(r - 0.05, h); add(r - 0.065, h - 0.012); add(r - 0.08, h); add(0.0001, h);
        const g = new THREE.LatheGeometry(pts, 48);
        g.computeVertexNormals();
        return g;
    });
}

function stoneGeometry(): THREE.BufferGeometry {
    return geo('stone', () => {
        const g = new THREE.SphereGeometry(0.3, 40, 20);
        g.scale(1, 0.38, 1);
        g.translate(0, 0.114, 0);
        return g;
    });
}

function mesh(g: THREE.BufferGeometry, color: string): THREE.Mesh {
    const m = new THREE.Mesh(g, lacqueredWood(color));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

export function colorOf(spec: PieceSpec, layout: Layout): string {
    const c = spec.color ?? '';
    return layout.palette?.[c] ?? (c.startsWith('#') ? c : '#999999');
}

export function createPiece(spec: PieceSpec, layout: Layout): THREE.Object3D {
    const color = colorOf(spec, layout);
    let obj: THREE.Object3D;
    switch (spec.kind) {
        case 'disc':
            obj = mesh(discGeometry(0.1), color);
            break;
        case 'king': {
            obj = new THREE.Group();
            const a = mesh(discGeometry(0.1), color), b = mesh(discGeometry(0.1), color);
            b.position.y = 0.1;
            b.rotation.y = 0.6;
            obj.add(a, b);
            break;
        }
        case 'stone':
            obj = mesh(stoneGeometry(), color);
            break;
        case 'flip': {
            obj = new THREE.Group();
            const back = (spec as PieceSpec & { back?: string }).back ?? '#f4f1ea';
            const bottom = mesh(discGeometry(0.05), layout.palette?.[back] ?? back);
            const top = mesh(discGeometry(0.05), color);
            top.position.y = 0.05;
            obj.add(bottom, top);
            break;
        }
        case 'cube':
            obj = mesh(geo('cube', () => { const g = new THREE.BoxGeometry(0.34, 0.34, 0.34); g.translate(0, 0.17, 0); return g; }), color);
            break;
        case 'cone':
            obj = mesh(geo('cone', () => { const g = new THREE.ConeGeometry(0.2, 0.55, 32); g.translate(0, 0.275, 0); return g; }), color);
            break;
        case 'ring':
            obj = mesh(geo('ring', () => {
                const g = new THREE.TorusGeometry(0.22, 0.07, 16, 40);
                g.rotateX(Math.PI / 2);
                g.translate(0, 0.07, 0);
                return g;
            }), color);
            break;
        default:
            obj = createPawn(color);
    }
    obj.scale.setScalar(Math.min(1.25, (layout.board?.spacing ?? 0.8) / 0.8));
    return obj;
}
