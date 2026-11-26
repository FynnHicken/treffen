/**
 * „Die anderen am Tisch spüren“: eigener Zeiger → Server, fremde Zeiger als leuchtender Punkt in
 * Spielerfarbe mit Namen. Bewegungen werden weich nachgezogen; nach Inaktivität blendet der Zeiger aus.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TableScene } from '../engine/TableScene';
import type { PresenceData, TableClient } from '../net/TableClient';
import type { Member } from '../net/state';
import { avatarUrl } from '../ui/avatar';

const FADE_AFTER_MS = 2500;

interface Remote {
    group: THREE.Group;
    ring: THREE.Mesh;
    label: CSS2DObject;
    target: THREE.Vector3;
    lastSeen: number;
    down: boolean;
}

export class Presence {
    private remotes = new Map<string, Remote>();
    private animating = false;

    constructor(private table: TableScene, private client: TableClient) {
        const el = table.renderer.domElement;
        let down = false;
        const send = (ev: PointerEvent) => {
            const p = table.pickTable(ev.clientX, ev.clientY);
            if (p) client.sendPresence({ x: p.x, z: p.z, down });
        };
        el.addEventListener('pointermove', send);
        el.addEventListener('pointerdown', ev => { down = true; send(ev); });
        el.addEventListener('pointerup', ev => { down = false; send(ev); });
        client.onPresence((from, p) => this.update(from, p));
        client.onState(s => {
            // Farbe/Name aktualisieren, Verlassene entfernen
            for (const [id, r] of this.remotes) {
                const m = s.members.find(x => x.id === id);
                if (!m || !m.connected) this.remove(id);
                else this.style(r, m.name, m.color, m);
            }
        });
    }

    private update(from: string, p: PresenceData | null): void {
        if (from === this.client.you) return;
        if (!p) { this.remove(from); return; }
        let r = this.remotes.get(from);
        if (!r) {
            r = this.create(from);
            r.group.position.set(p.x, 0.02, p.z);
        }
        r.target.set(p.x, 0.02, p.z);
        r.lastSeen = performance.now();
        r.down = !!p.down;
        r.group.visible = true;
        this.ensureAnimating();
    }

    private create(id: string): Remote {
        const group = new THREE.Group();
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.16, 0.24, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        const dot = new THREE.Mesh(
            new THREE.CircleGeometry(0.07, 20),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false })
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.y = 0.001;
        const div = document.createElement('div');
        div.className = 'tt-presence-label';
        const label = new CSS2DObject(div);
        label.position.set(0, 0.35, 0);
        group.add(ring, dot, label);
        this.table.scene.add(group);
        const r: Remote = { group, ring, label, target: new THREE.Vector3(), lastSeen: performance.now(), down: false };
        this.remotes.set(id, r);
        const m = this.client.state?.members.find(x => x.id === id);
        this.style(r, m?.name ?? '…', m?.color ?? '#ffffff', m);
        return r;
    }

    private style(r: Remote, name: string, color: string, m?: Member | null): void {
        for (const child of r.group.children) {
            const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
            if (mat && 'color' in mat) mat.color.set(color);
        }
        const el = r.label.element as HTMLDivElement;
        const url = avatarUrl(m);
        if (el.dataset.name !== name || (el.dataset.avatar ?? '') !== (url ?? '')) {
            el.dataset.name = name;
            el.dataset.avatar = url ?? '';
            el.textContent = name;
            if (url) {
                const img = document.createElement('img');
                img.className = 'tt-avatar';
                img.src = url;
                img.alt = '';
                el.prepend(img);
            }
        }
        el.style.setProperty('--tt-color', color);
        el.style.color = readableTextOn(color);
    }

    private remove(id: string): void {
        const r = this.remotes.get(id);
        if (!r) return;
        r.label.element.remove();
        this.table.scene.remove(r.group);
        this.remotes.delete(id);
        this.table.invalidate();
    }

    private ensureAnimating(): void {
        if (this.animating) return;
        this.animating = true;
        this.table.addAnimator(dt => {
            const now = performance.now();
            let busy = false;
            for (const r of this.remotes.values()) {
                if (!r.group.visible) continue;
                r.group.position.lerp(r.target, 1 - Math.exp(-dt * 14));
                const s = r.down ? 0.75 : 1;
                r.ring.scale.lerp(new THREE.Vector3(s, s, s), 1 - Math.exp(-dt * 18));
                const idle = now - r.lastSeen;
                if (idle > FADE_AFTER_MS) {
                    r.group.visible = false;
                    (r.label.element as HTMLElement).style.opacity = '0';
                    continue;
                }
                (r.label.element as HTMLElement).style.opacity = '1';
                busy = busy || r.group.position.distanceToSquared(r.target) > 1e-5 || idle < FADE_AFTER_MS;
            }
            this.animating = busy;
            return busy;
        });
    }

    /** Für Tests: Anzahl sichtbarer fremder Zeiger */
    get visibleCount(): number {
        return [...this.remotes.values()].filter(r => r.group.visible).length;
    }
}

/** Schwarz oder Weiß – je nachdem, was auf der Hintergrundfarbe besser lesbar ist. */
function readableTextOn(color: string): string {
    const c = new THREE.Color(color);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;   // linear
    return lum > 0.2 ? '#111' : '#fff';
}
