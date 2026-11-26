/**
 * Namen an den Sitzplätzen – in die Platzsets „eingraviert“ (echte 3D-Fläche auf dem Tisch, Würfel und
 * Figuren rollen darüber und verdecken sie). Jede Gravur zeigt zu ihrem Platz; die gegenüber wird für den
 * eigenen Blick umgedreht, damit man sie lesen kann.
 *
 * Nur Bedienknöpfe (Hinsetzen, + Computer, Computer entfernen) liegen als kleine HTML-Chips darüber –
 * und das nur in der Lobby.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TableScene } from '../engine/TableScene';
import type { TableClient } from '../net/TableClient';
import type { TableState } from '../net/state';
import { avatarCanvas, avatarUrl } from './avatar';

const PLATE_W = 3.4, PLATE_D = 0.85;
const CW = 1024, CH = Math.round(CW * PLATE_D / PLATE_W);

interface Plate {
    group: THREE.Group;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    key: string;
    text: string;
    chips: CSS2DObject;
    botChip: boolean;
    hasAvatar: boolean;
}

export class SeatLabels {
    private plates: Plate[] = [];
    /** URL → fertiges Avatar-Canvas (null = lädt noch) */
    private avatars = new Map<string, HTMLCanvasElement | null>();
    private lastState: TableState | null = null;

    constructor(private table: TableScene, private client: TableClient) {
        for (let s = 0; s < table.seats; s++) {
            const canvas = document.createElement('canvas');
            canvas.width = CW; canvas.height = CH;
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = table.renderer.capabilities.getMaxAnisotropy();
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(PLATE_W, PLATE_D),
                new THREE.MeshStandardMaterial({
                    map: texture, transparent: true, depthWrite: false, roughness: 0.9,
                    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
                })
            );
            mesh.rotation.x = -Math.PI / 2;
            mesh.receiveShadow = true;
            mesh.renderOrder = 1;
            const group = new THREE.Group();
            group.add(mesh);
            table.scene.add(group);

            const el = document.createElement('div');
            el.className = 'tt-seat';
            el.addEventListener('click', ev => {
                const st = this.client.state;
                if (!st) return;
                const act = (ev.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
                if (act === 'bot') this.client.addBot(s);
                else if (act === 'rm') this.client.removeBot(s);
                else if (act === 'sit') this.client.sit(s);
            });
            const chips = new CSS2DObject(el);
            table.scene.add(chips);
            this.plates.push({ group, canvas, texture, key: '', text: '', chips, botChip: false, hasAvatar: false });
        }
        this.place();
        new ResizeObserver(() => this.place()).observe(table.renderer.domElement);
        client.onState(s => this.render(s));
    }

    /** Gravuren auf den Platzsets ausrichten; Knöpfe seitlicher Plätze hochkant (Handy) untereinander stellen. */
    private place(): void {
        const portrait = this.table.isPortrait;
        const own = this.table.seatDirection(this.table.ownSeatIndex);
        const half = this.table.tableSize / 2;
        this.plates.forEach((pl, s) => {
            const dir = this.table.seatDirection(s);
            const a = (s / this.table.seats) * Math.PI * 2;
            const opposite = dir.dot(own) < -0.5;
            const p = this.table.seatPosition(s, 0.85);
            pl.group.position.set(p.x, 0.009, p.z);
            pl.group.rotation.y = -a + (opposite ? Math.PI : 0);

            const sideways = Math.abs(dir.dot(own)) < 0.5;
            let c: THREE.Vector3;
            const column = portrait && sideways;
            (pl.chips.element as HTMLElement).classList.toggle('col', column);
            if (column) {
                // Hochkant: Knöpfe untereinander am Rand neben dem Brett
                c = dir.clone().multiplyScalar(half - 1.75);
            } else if (pl.botChip) {
                // „✕“ ans Ende der Gravur, damit der Name lesbar bleibt
                const along = new THREE.Vector3(1, 0, 0).applyQuaternion(pl.group.quaternion);
                c = p.clone().add(along.multiplyScalar(PLATE_W / 2 - 0.2));
            } else {
                c = p.clone();
            }
            pl.chips.position.set(c.x, 0.05, c.z);
        });
        this.table.invalidate();
    }

    private render(state: TableState): void {
        this.lastState = state;
        const me = this.client.me;
        const seatBefore = this.table.ownSeatIndex;
        this.table.setOwnSeat(me?.seat ?? null);
        let replace = this.table.ownSeatIndex !== seatBefore;
        for (let s = 0; s < this.plates.length; s++) {
            const pl = this.plates[s];
            const m = state.members.find(x => x.seat === s);
            const color = state.game.seat_colors[s] ?? '#999';
            const lobby = !state.status || state.status === 'lobby';
            const manage = lobby && !!state.status && this.client.isHost;     // Host kann Computer setzen

            // Gravur
            const name = m ? m.name : 'Platz frei';
            const icons = m ? `${m.id === state.host_id ? '👑 ' : ''}${m.is_bot ? '🤖 ' : ''}` : '';
            const note = m && !m.connected ? 'getrennt – Computer spielt' : '';
            // Avatar aus dem Hub: erst zeichnen, wenn geladen (dann neu rendern)
            const url = avatarUrl(m);
            let avatar: HTMLCanvasElement | null = null;
            let avatarState = 'none';
            if (url) {
                const cached = this.avatars.get(url);
                if (cached === undefined) {
                    this.avatars.set(url, null);
                    avatarCanvas(url).then(c => {
                        if (!c) { this.avatars.delete(url); return; }
                        this.avatars.set(url, c);
                        if (this.lastState) this.render(this.lastState);
                    });
                } else if (cached) {
                    avatar = cached;
                    avatarState = url;
                }
            }
            const key = JSON.stringify([icons, name, note, !!m, m?.id === this.client.you, avatarState]);
            if (key !== pl.key) {
                pl.key = key;
                pl.text = `${icons}${name}${m && m.id === this.client.you ? ' (du)' : ''}${note ? ' ' + note : ''}`;
                pl.hasAvatar = !!avatar;
                this.drawPlate(pl, icons + name, note, !m, avatar);
            }

            // Bedien-Chips (nur Lobby)
            const el = pl.chips.element as HTMLDivElement;
            el.style.setProperty('--tt-color', color);
            let html = '';
            if (!m && lobby) {
                if (this.client.me) html += '<span class="tt-seat-action" data-act="sit">Hinsetzen</span>';
                if (manage) html += '<span class="tt-seat-action bot" data-act="bot">+ Computer</span>';
            } else if (m && manage && m.is_bot) {
                html = '<span class="tt-seat-action rm" data-act="rm" title="Computer entfernen">✕</span>';
            }
            if (el.innerHTML !== html) el.innerHTML = html;
            el.hidden = !html;
            const botChip = !!m && !!html;
            if (botChip !== pl.botChip) { pl.botChip = botChip; replace = true; }
            this.table.setSeatColor(s, m ? color : null);
        }
        if (replace) this.place();
        this.table.invalidate();
    }

    /**
     * Text wie eingeschnitten: dunkle Vertiefung, heller Lichtkante unten.
     * Mit Avatar: links davon als eingelassene Plakette (runde Vertiefung, Bild darin).
     */
    private drawPlate(pl: Plate, text: string, note: string, free: boolean, avatar: HTMLCanvasElement | null = null): void {
        const c = pl.canvas.getContext('2d')!;
        c.clearRect(0, 0, CW, CH);
        const family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
        const disc = avatar ? Math.round(CH * (note ? 0.62 : 0.78)) : 0;
        const gap = avatar ? Math.round(CH * 0.14) : 0;
        const room = CW * 0.9 - disc - gap;
        let size = free ? 92 : 118;
        c.font = `${free ? 500 : 800} ${size}px ${family}`;
        let w = c.measureText(text).width;
        if (w > room) { size = Math.floor(size * room / w); c.font = `${free ? 500 : 800} ${size}px ${family}`; w = c.measureText(text).width; }
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const y = note ? CH * 0.4 : CH * 0.52;
        // Avatar + Name als Gruppe mittig
        const textX = avatar ? (CW - (disc + gap + w)) / 2 + disc + gap + w / 2 : CW / 2;
        if (avatar) {
            const cx = (CW - (disc + gap + w)) / 2 + disc / 2, r = disc / 2;
            c.save();
            c.fillStyle = 'rgba(24, 12, 5, 0.75)';                       // Vertiefung
            c.beginPath(); c.arc(cx, y + 3, r + 7, 0, Math.PI * 2); c.fill();
            c.fillStyle = 'rgba(255, 236, 205, 0.35)';                    // Lichtkante
            c.beginPath(); c.arc(cx, y + 6, r + 4, 0, Math.PI, false); c.fill();
            c.beginPath(); c.arc(cx, y, r, 0, Math.PI * 2); c.clip();
            c.drawImage(avatar, cx - r, y - r, disc, disc);
            c.restore();
        }
        const engrave = (t: string, x: number, yy: number, alpha: number) => {
            c.fillStyle = `rgba(255, 236, 205, ${0.4 * alpha})`;      // Lichtkante
            c.fillText(t, x, yy + 4);
            c.fillStyle = `rgba(24, 12, 5, ${0.95 * alpha})`;          // Vertiefung
            c.fillText(t, x, yy);
        };
        engrave(text, textX, y, free ? 0.45 : 1);
        if (note) {
            c.font = `600 44px ${family}`;
            engrave(note, CW / 2, CH * 0.8, 0.9);
        }
        pl.texture.needsUpdate = true;
    }

    /** Für Tests: eingravierte Texte je Platz */
    texts(): string[] {
        return this.plates.map(p => p.text);
    }

    /** Für Tests: welche Platzschilder einen Avatar zeigen */
    avatarShown(): boolean[] {
        return this.plates.map(p => p.hasAvatar);
    }
}
