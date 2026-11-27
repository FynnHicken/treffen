/**
 * Schachfiguren im klassischen Staunton-Stil, gedrechselt (Drehkörper) und lackiert – per Code modelliert.
 * Ursprung = Mitte des Fußes. Maße passen zu Feldbreite 0,92 (Fuß ≈ 0,6 breit, König ≈ 1,06 hoch).
 * Springer: gedrechselter Fuß + ausgesägter Pferdekopf, der zum Gegner schaut.
 */
import * as THREE from 'three';
import { lacqueredWood } from '@treffen/tabletop';

type Profile = [number, number][];       // [Radius, Höhe] von unten nach oben

const cache = new Map<string, THREE.BufferGeometry[]>();

function lathe(profile: Profile, segments = 40): THREE.LatheGeometry {
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), segments);
    g.computeVertexNormals();
    return g;
}

/** Fuß mit Wulst und Kehle – bei allen Figuren gleich, nur die Größe ändert sich */
function foot(r: number): Profile {
    return [[0, 0], [r, 0], [r * 1.03, 0.025], [r * 1.0, 0.055], [r * 0.9, 0.075], [r * 0.93, 0.1], [r * 0.8, 0.125], [r * 0.66, 0.14]];
}

function ball(cx: number, cy: number, r: number, from = -Math.PI / 2 + 0.5, steps = 12): Profile {
    const out: Profile = [];
    for (let i = 0; i <= steps; i++) {
        const a = from + (i / steps) * (Math.PI / 2 - from);
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
}

function geometries(kind: string): THREE.BufferGeometry[] {
    const hit = cache.get(kind);
    if (hit) return hit;
    let out: THREE.BufferGeometry[];
    switch (kind) {
        case 'pawn':
            out = [lathe([...foot(0.25), [0.15, 0.2], [0.11, 0.3], [0.09, 0.36], [0.16, 0.38], [0.165, 0.395], [0.1, 0.41],
                ...ball(0, 0.5, 0.115)])];
            break;
        case 'rook': {
            const body = lathe([...foot(0.28), [0.2, 0.2], [0.175, 0.33], [0.17, 0.44], [0.22, 0.47], [0.23, 0.5], [0.215, 0.52],
                [0.215, 0.6], [0.17, 0.6], [0.17, 0.57], [0.0001, 0.57]]);
            // Zinnen: kleine Klötze im Kreis auf dem Rand
            const merlons: THREE.BufferGeometry[] = [];
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const b = new THREE.BoxGeometry(0.075, 0.07, 0.06);
                b.rotateY(-a);
                b.translate(Math.cos(a) * 0.19, 0.635, Math.sin(a) * 0.19);
                merlons.push(b);
            }
            out = [body, ...merlons];
            break;
        }
        case 'bishop': {
            const body = lathe([...foot(0.265), [0.17, 0.2], [0.12, 0.34], [0.095, 0.44], [0.16, 0.47], [0.165, 0.49], [0.1, 0.51],
                [0.12, 0.56], [0.135, 0.63], [0.12, 0.7], [0.08, 0.76], [0.035, 0.79], [0.03, 0.8], ...ball(0, 0.84, 0.045)]);
            // Kerbe in der Mitra (dunkler Schlitz, schräg)
            const slit = new THREE.BoxGeometry(0.3, 0.025, 0.022);
            slit.rotateZ(0.7);
            slit.translate(0.0, 0.66, 0.0);
            out = [body, slit];
            break;
        }
        case 'queen': {
            const body = lathe([...foot(0.29), [0.19, 0.2], [0.13, 0.38], [0.105, 0.52], [0.175, 0.55], [0.18, 0.575], [0.11, 0.6],
                [0.13, 0.68], [0.17, 0.78], [0.19, 0.82], [0.15, 0.84], [0.08, 0.86], ...ball(0, 0.9, 0.06)]);
            const crown: THREE.BufferGeometry[] = [];
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const s = new THREE.SphereGeometry(0.032, 10, 8);
                s.translate(Math.cos(a) * 0.17, 0.835, Math.sin(a) * 0.17);
                crown.push(s);
            }
            out = [body, ...crown];
            break;
        }
        case 'king': {
            const body = lathe([...foot(0.3), [0.2, 0.2], [0.14, 0.4], [0.11, 0.56], [0.185, 0.59], [0.19, 0.615], [0.12, 0.64],
                [0.13, 0.72], [0.17, 0.83], [0.18, 0.86], [0.12, 0.88], [0.07, 0.9], [0.065, 0.92], [0.0001, 0.92]]);
            const v = new THREE.BoxGeometry(0.05, 0.17, 0.05);
            v.translate(0, 1.0, 0);
            const h = new THREE.BoxGeometry(0.13, 0.045, 0.05);
            h.translate(0, 1.02, 0);
            out = [body, v, h];
            break;
        }
        case 'knight': {
            const base = lathe([...foot(0.27), [0.19, 0.18], [0.17, 0.22], [0.0001, 0.22]]);
            out = [base, horseHead()];
            break;
        }
        default:
            out = [lathe([...foot(0.25), [0.1, 0.3], ...ball(0, 0.4, 0.1)])];
    }
    cache.set(kind, out);
    return out;
}

/** Ausgesägter Pferdekopf (Profil in x/y, Blick nach −x), gerundete Kanten */
function horseHead(): THREE.BufferGeometry {
    const s = new THREE.Shape();
    const p: [number, number][] = [
        [0.17, 0.2], [0.19, 0.34], [0.17, 0.5], [0.12, 0.64], [0.07, 0.72], [0.05, 0.8], [0.02, 0.76], [-0.01, 0.75],
        [-0.06, 0.7], [-0.13, 0.62], [-0.2, 0.52], [-0.24, 0.45], [-0.23, 0.4], [-0.17, 0.39], [-0.1, 0.43],
        [-0.05, 0.42], [-0.06, 0.34], [-0.12, 0.26], [-0.14, 0.2]
    ];
    s.moveTo(p[0][0], p[0][1]);
    for (const [x, y] of p.slice(1)) s.lineTo(x, y);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.065, bevelSize: 0.04, bevelSegments: 6, curveSegments: 6 });
    g.translate(0, 0, -0.035);
    g.computeVertexNormals();
    return g;
}

/**
 * Figur als Gruppe. `color` = Lackfarbe, `facingDeg` = Blickrichtung wie die Plätze am Tisch (0 = zu +z, 180 = zu −z;
 * Weiß sitzt vorn und schaut nach hinten = 180). Der Springer schaut zum Gegner.
 * `inward` +1/−1: Figur steht aus Sicht ihres Spielers rechts/links – der Springerkopf dreht sich leicht zur Mitte.
 * `scale`: kleinere Felder (Tandem, Vierschach) → kleinere Figuren.
 */
export function createChessPiece(kind: string, color: string, facingDeg: number, inward = 0, scale = 1): THREE.Group {
    // Äußere Gruppe gehört dem Tisch (Neigung beim Tragen setzt rotation), innen die Blickrichtung
    const outer = new THREE.Group();
    const group = new THREE.Group();
    outer.add(group);
    const mat = lacqueredWood(color);
    const dark = new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).l < 0.3;
    const slitMat = lacqueredWood(dark ? '#120c09' : '#8a6a44');
    geometries(kind).forEach((g, i) => {
        const m = new THREE.Mesh(g, kind === 'bishop' && i === 1 ? slitMat : mat);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
    });
    // Springerkopf: Profil schaut nach −x → zum Gegner drehen (Blickrichtung a: (−sin a, cos a) → Drehung π/2 − a),
    // dazu leicht zur Mitte, so sieht man das Profil
    if (kind === "knight") group.rotation.y = Math.PI / 2 - THREE.MathUtils.degToRad(facingDeg) + inward * 0.55;
    group.scale.setScalar(scale);
    return outer;
}
