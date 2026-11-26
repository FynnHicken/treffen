/**
 * Würfelbecher aus Leder (Drehkörper, oben offen, mit Naht und dunklem Rand).
 */
import * as THREE from 'three';

let geo: THREE.LatheGeometry | null = null;
let inner: THREE.LatheGeometry | null = null;

export function createCup(): THREE.Group {
    if (!geo) {
        const pts = [
            [0.0001, 0], [0.34, 0], [0.37, 0.02], [0.375, 0.06], [0.39, 0.3], [0.41, 0.6],
            [0.43, 0.74], [0.445, 0.78], [0.42, 0.8]
        ].map(([r, y]) => new THREE.Vector2(r, y));
        geo = new THREE.LatheGeometry(pts, 40);
        inner = new THREE.LatheGeometry([[0.0001, 0.06], [0.33, 0.06], [0.37, 0.6], [0.4, 0.79]]
            .map(([r, y]) => new THREE.Vector2(r, y)), 40);
    }
    const leather = new THREE.MeshPhysicalMaterial({ color: 0x5a3220, roughness: 0.72, sheen: 0.5, sheenColor: new THREE.Color(0x8a5a3a) });
    const lining = new THREE.MeshStandardMaterial({ color: 0x1e3b2a, roughness: 0.95, side: THREE.BackSide });   // grüner Filz innen
    const cup = new THREE.Group();
    const outer = new THREE.Mesh(geo, leather);
    outer.castShadow = true;
    outer.receiveShadow = true;
    const lin = new THREE.Mesh(inner!, lining);
    const seam = new THREE.Mesh(
        new THREE.TorusGeometry(0.43, 0.012, 6, 48),
        new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.8 })
    );
    seam.rotation.x = Math.PI / 2;
    seam.position.y = 0.7;
    cup.add(outer, lin, seam);
    // Großzügige Trefferfläche
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.0, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.45;
    cup.add(hit);
    return cup;
}
