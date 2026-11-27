/**
 * Markierte Felder (Engine 2.3): letzter Zug, Warnung (König im Schach), Hinweis.
 * Die Regeln schreiben `marks: [{field, kind}]` in den Spielstand – das Spiel braucht dafür keinen Client-Code.
 * Form: Quadrate, wenn das Brett eckige Felder hat (`layout.board.cells = "square"`), sonst runde Flecken.
 * Statisch (kein Dauer-Rendern).
 */
import * as THREE from 'three';
import type { TableScene } from '../engine/TableScene';
import type { Layout, Mark } from '../net/state';

const COLORS: Record<string, { color: number; opacity: number; glow?: boolean }> = {
    last: { color: 0xffd27a, opacity: 0.3 },
    alert: { color: 0xff3b2f, opacity: 0.85, glow: true },
    hint: { color: 0x9fe3ff, opacity: 0.35 },
};

let glowTex: THREE.CanvasTexture | null = null;
function glow(): THREE.CanvasTexture {
    if (glowTex) return glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
}

export class MarkLayer {
    private group = new THREE.Group();
    private key = '';

    constructor(private table: TableScene, private surfaceY: () => number) {
        table.scene.add(this.group);
    }

    set(layout: Layout, marks: Mark[] | undefined): void {
        const list = (marks ?? []).filter(m => layout.fields[m.field]);
        const key = JSON.stringify(list) + (layout.board?.kind ?? '');
        if (key === this.key) return;
        this.key = key;
        for (const o of [...this.group.children]) {
            this.group.remove(o);
            const m = o as THREE.Mesh;
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
        }
        const S = layout.board?.spacing ?? 0.8;
        const square = layout.board?.cells === 'square';
        list.forEach((mk, i) => {
            const f = layout.fields[mk.field];
            const st = COLORS[mk.kind] ?? COLORS.hint;
            const geo = st.glow ? new THREE.PlaneGeometry(S * 1.25, S * 1.25)
                : square ? new THREE.PlaneGeometry(S * 0.98, S * 0.98) : new THREE.CircleGeometry(S * 0.46, 32);
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
                color: st.color, transparent: true, opacity: st.opacity, depthWrite: false, map: st.glow ? glow() : null
            }));
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(f.x, this.surfaceY() + 0.002 + (st.glow ? 0.001 : 0) + i * 0.0001, f.z);
            mesh.renderOrder = 3;
            this.group.add(mesh);
        });
        this.table.invalidate();
    }

    /** Für Tests: wie viele Felder markiert sind */
    get count(): number {
        return this.group.children.length;
    }
}
