/**
 * Klassische Spielfigur („Pöppel“): gedrechseltes, lackiertes Holz – per Drehkörper erzeugt.
 * Maße in Tisch-Einheiten; Fuß-Radius ≈ 0,27, Höhe ≈ 0,7 (passt zu Feldabstand 0,8).
 */
import * as THREE from 'three';

let sharedGeometry: THREE.LatheGeometry | null = null;

export function pawnGeometry(): THREE.LatheGeometry {
    if (sharedGeometry) return sharedGeometry;
    const pts: THREE.Vector2[] = [];
    const add = (r: number, y: number) => pts.push(new THREE.Vector2(r, y));
    // Fuß mit leicht gerundeter Kante
    add(0.0001, 0);
    add(0.255, 0);
    add(0.272, 0.015);
    add(0.274, 0.04);
    add(0.262, 0.065);
    add(0.232, 0.085);
    // Körper (schlanker Kegel mit sanfter Taille)
    add(0.2, 0.1);
    add(0.168, 0.15);
    add(0.142, 0.22);
    add(0.122, 0.3);
    add(0.106, 0.38);
    add(0.098, 0.42);
    // Kragen
    add(0.128, 0.435);
    add(0.136, 0.452);
    add(0.124, 0.468);
    add(0.09, 0.478);
    // Kopf (Kugel, Mittelpunkt y = 0.575, r = 0.125)
    const cy = 0.575, r = 0.125;
    for (let i = 0; i <= 14; i++) {
        const a = -Math.PI / 2 + 0.55 + (i / 14) * (Math.PI - 0.55);
        add(Math.max(0.0001, Math.cos(a) * r), cy + Math.sin(a) * r);
    }
    sharedGeometry = new THREE.LatheGeometry(pts, 48);
    sharedGeometry.computeVertexNormals();
    return sharedGeometry;
}

/** Lackiertes Holz in einer Farbe (geteilt pro Farbe). */
const materials = new Map<string, THREE.MeshPhysicalMaterial>();
export function lacqueredWood(color: string): THREE.MeshPhysicalMaterial {
    let m = materials.get(color);
    if (!m) {
        const c = new THREE.Color(color);
        const dark = c.getHSL({ h: 0, s: 0, l: 0 }).l < 0.2;
        m = new THREE.MeshPhysicalMaterial({
            color: c,
            roughness: dark ? 0.42 : 0.38,
            metalness: 0,
            clearcoat: 0.85,
            clearcoatRoughness: 0.18,
            sheen: dark ? 0.25 : 0,          // schwarzer Lack wirkt sonst „tot“
            sheenColor: new THREE.Color(0x777777)
        });
        materials.set(color, m);
    }
    return m;
}

export function createPawn(color: string): THREE.Mesh {
    const mesh = new THREE.Mesh(pawnGeometry(), lacqueredWood(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
