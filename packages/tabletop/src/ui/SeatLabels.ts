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
            el.addEventListener('click', ev => {
                const st = this.client.state;
                if (!st) return;
                const act = (ev.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
                if (act === 'bot') this.client.addBot(s);
                else if (act === 'rm') this.client.removeBot(s);
                else if (!st.members.some(m => m.seat === s) && (!st.status || st.status === 'lobby')) this.client.sit(s);
            });
            const obj = new CSS2DObject(el);
            table.scene.add(obj);
            this.labels.push(obj);
        }
        this.place();
        new ResizeObserver(() => this.place()).observe(table.renderer.domElement);
        client.onState(s => this.render(s));
    }

    /**
     * Schilder an der Tischkante. Hochkant (Handy) ist links/rechts kein Platz neben dem Brett –
     * die seitlichen Schilder wandern dann in den freien Streifen vor einem, auf ihre Seite.
     */
    private place(): void {
        const portrait = this.table.isPortrait;
        const own = this.table.seatDirection(this.table.ownSeatIndex);
        const half = this.table.tableSize / 2;
        this.labels.forEach((obj, s) => {
            const dir = this.table.seatDirection(s);
            const sideways = Math.abs(dir.dot(own)) < 0.5;      // aus Sicht des eigenen Platzes links/rechts
            const p = portrait && sideways
                ? own.clone().multiplyScalar(half - 0.85).add(dir.clone().multiplyScalar(half - 2.55))
                : this.table.seatPosition(s, 0.85);
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
            const lobby = !state.status || state.status === 'lobby';
            const manage = lobby && !!state.status && this.client.isHost;     // Host kann Computer setzen
            const turn = state.status === 'playing' && state.play?.turn === s;
            el.classList.toggle('free', !m);
            el.classList.toggle('me', !!m && m.id === this.client.you);
            el.classList.toggle('offline', !!m && !m.connected);
            el.classList.toggle('turn', turn);
            if (!m) {
                const sit = this.client.me ? '<span class="tt-seat-action" data-act="sit">Hinsetzen</span>' : '';
                const bot = manage ? '<span class="tt-seat-action bot" data-act="bot">+ Computer</span>' : '';
                el.innerHTML = `<span class="tt-seat-dot"></span><span class="tt-seat-name">Platz frei</span>${lobby ? sit : ''}${bot}`;
            } else {
                const crown = m.id === state.host_id ? '<span class="tt-seat-host" title="Host">👑</span>' : '';
                const icon = m.is_bot ? '<span title="Computer">🤖</span>' : '';
                const you = m.id === this.client.you ? ' <span class="tt-seat-you">(du)</span>' : '';
                const off = m.connected ? '' : ' <span class="tt-seat-off">getrennt – Computer spielt</span>';
                const rm = manage && m.is_bot ? '<span class="tt-seat-action rm" data-act="rm" title="Computer entfernen">✕</span>' : '';
                el.innerHTML = `<span class="tt-seat-dot"></span>${crown}${icon}<span class="tt-seat-name">${escapeHtml(m.name)}${you}${off}</span>${rm}`;
            }
            this.table.setSeatColor(s, m ? color : null);
        }
        this.table.setTurnSeat(state.status === 'playing' ? state.play?.turn ?? null : null);
        this.table.invalidate();
    }
}
