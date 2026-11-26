/**
 * Namensschilder an den Sitzplätzen: Name, Farbe, Host-Krone, getrennt-Status.
 * Freie Plätze zeigen „Hinsetzen“ – ein Klick setzt einen dorthin.
 */
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { escapeHtml } from '@treffen/boardgame-kit';
import type { TableScene } from '../engine/TableScene';
import type { TableClient } from '../net/TableClient';
import type { TableState } from '../net/state';

export class SeatLabels {
    private labels: CSS2DObject[] = [];

    constructor(private table: TableScene, private client: TableClient) {
        for (let s = 0; s < table.seats; s++) {
            const el = document.createElement('div');
            el.className = 'tt-seat';
            el.addEventListener('click', () => {
                const st = this.client.state;
                if (st && !st.members.some(m => m.seat === s)) this.client.sit(s);
            });
            const obj = new CSS2DObject(el);
            table.scene.add(obj);
            this.labels.push(obj);
        }
        this.place();
        new ResizeObserver(() => this.place()).observe(table.renderer.domElement);
        client.onState(s => this.render(s));
    }

    /** Schilder an der Tischkante; hochkant rücken die seitlichen nach innen, damit sie nicht abgeschnitten werden. */
    private place(): void {
        const portrait = this.table.isPortrait;
        const own = this.table.seatDirection(this.table.ownSeatIndex);
        this.labels.forEach((obj, s) => {
            // „seitlich“ = aus Sicht des eigenen Platzes links/rechts
            const sideways = Math.abs(this.table.seatDirection(s).dot(own)) < 0.5;
            const p = this.table.seatPosition(s, portrait && sideways ? 2.6 : 0.85);
            obj.position.set(p.x, 0.05, p.z);
        });
        this.table.invalidate();
    }

    private render(state: TableState): void {
        const me = this.client.me;
        const seatBefore = this.table.ownSeatIndex;
        this.table.setOwnSeat(me?.seat ?? null);
        if (this.table.ownSeatIndex !== seatBefore) this.place();
        for (let s = 0; s < this.labels.length; s++) {
            const el = this.labels[s].element as HTMLDivElement;
            const m = state.members.find(x => x.seat === s);
            const color = state.game.seat_colors[s] ?? '#999';
            el.style.setProperty('--tt-color', color);
            el.classList.toggle('free', !m);
            el.classList.toggle('me', !!m && m.id === this.client.you);
            el.classList.toggle('offline', !!m && !m.connected);
            if (!m) {
                el.innerHTML = `<span class="tt-seat-dot"></span><span class="tt-seat-name">Platz frei</span><span class="tt-seat-action">Hinsetzen</span>`;
            } else {
                const crown = m.id === state.host_id ? '<span class="tt-seat-host" title="Host">👑</span>' : '';
                const you = m.id === this.client.you ? ' <span class="tt-seat-you">(du)</span>' : '';
                const off = m.connected ? '' : ' <span class="tt-seat-off">getrennt</span>';
                el.innerHTML = `<span class="tt-seat-dot"></span>${crown}<span class="tt-seat-name">${escapeHtml(m.name)}${you}${off}</span>`;
            }
            this.table.setSeatColor(s, m ? color : null);
        }
        this.table.invalidate();
    }
}
