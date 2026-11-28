/**
 * Tischgespräch (Engine 2.7): Reaktionen und Verlauf – das, was am echten Tisch nebenbei passiert.
 *
 *  - 😊 unten links öffnet eine Leiste mit Emojis; antippen → das Emoji steigt über dem eigenen Platz auf, bei allen.
 *    Flüchtig (wie die Zeiger), nicht gespeichert, gedrosselt.
 *  - 📜 öffnet den Verlauf: Hinweise der Regeln (NOTE), Würfe, Züge auf Brettfeldern („e2 → e4“), Start und Ende.
 *    Regeln können jedem Ereignis einen eigenen Verlaufstext geben: `"log": "{p0} schlägt auf e5"`.
 */
import * as THREE from 'three';
import { escapeHtml } from '@treffen/boardgame-kit';
import type { TableScene } from '../engine/TableScene';
import type { TableClient } from '../net/TableClient';
import type { TableEvent, TableState } from '../net/state';
import type { HudContext } from './hud';
import { avatarImgHtml } from '../ui/avatar';

export const REACTIONS = ['👍', '👏', '😂', '😮', '😅', '🤔', '🔥', '❤️', '😬', '🎉'];
const LOG_MAX = 60;

export interface Talk {
    /** Verlaufseinträge (neueste zuletzt), für Tests */
    readonly log: string[];
}

export function setupTalk(table: TableScene, client: TableClient, ctx: HudContext): Talk {
    const wrap = document.createElement('div');
    wrap.className = 'talk';
    wrap.innerHTML = `
        <div class="talk-bar" hidden>${REACTIONS.map(e => `<button data-emoji="${e}">${e}</button>`).join('')}</div>
        <div class="talk-log" hidden><h3>Verlauf</h3><ol></ol></div>
        <div class="talk-btns">
            <button class="talk-btn" data-open="bar" title="Reaktion zeigen" aria-label="Reaktion zeigen">😊</button>
            <button class="talk-btn" data-open="log" title="Verlauf" aria-label="Verlauf">📜</button>
        </div>`;
    document.body.appendChild(wrap);
    const bar = wrap.querySelector('.talk-bar') as HTMLElement;
    const logEl = wrap.querySelector('.talk-log') as HTMLElement;
    const list = logEl.querySelector('ol')!;
    const reactBtn = wrap.querySelector('[data-open="bar"]') as HTMLButtonElement;

    wrap.addEventListener('click', ev => {
        const b = (ev.target as HTMLElement).closest('button');
        if (!b) return;
        if (b.dataset.emoji) {
            client.react(b.dataset.emoji);
            bar.hidden = true;
            navigator.vibrate?.(6);
        } else if (b.dataset.open === 'bar') {
            bar.hidden = !bar.hidden;
            logEl.hidden = true;
        } else if (b.dataset.open === 'log') {
            logEl.hidden = !logEl.hidden;
            bar.hidden = true;
        }
    });
    client.onState(() => { reactBtn.hidden = !client.me; });

    // ---------- Reaktionen ----------
    client.onReaction((from, emoji) => {
        const s = client.state;
        const m = s?.members.find(x => x.id === from);
        let x = window.innerWidth / 2, y = window.innerHeight * 0.3;
        if (m && m.seat !== null) {
            const p = table.seatPosition(m.seat, 1.8).setY(0.4).project(table.camera);
            const rect = table.renderer.domElement.getBoundingClientRect();
            x = rect.left + (p.x + 1) / 2 * rect.width;
            y = rect.top + (1 - p.y) / 2 * rect.height;
        }
        const el = document.createElement('div');
        el.className = 'talk-float';
        el.textContent = emoji;
        el.style.left = `${Math.max(24, Math.min(window.innerWidth - 24, x))}px`;
        el.style.top = `${Math.max(40, Math.min(window.innerHeight - 40, y))}px`;
        if (m) el.dataset.who = m.name;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2200);
    });

    // ---------- Verlauf ----------
    const log: string[] = [];
    const add = (html: string) => {
        log.push(html);
        if (log.length > LOG_MAX) log.shift();
        const li = document.createElement('li');
        li.innerHTML = html;
        list.prepend(li);
        while (list.children.length > LOG_MAX) list.lastElementChild?.remove();
    };
    const nameOf = (s: TableState, id: string) => {
        const m = s.members.find(x => x.id === id);
        return m ? avatarImgHtml(m) + escapeHtml(m.id === client.you ? 'Du' : m.name) : '';
    };
    const square = (s: TableState, f: string) => s.layout.fields[f]?.kind === 'square';
    let lastStatus: TableState['status'] = null;
    client.onEvent((ev: TableEvent) => {
        const s = client.state;
        if (!s) return;
        const own = (ev as { log?: string }).log;
        if (typeof own === 'string') { add(ctx.render(s, own)); return; }
        switch (ev.type) {
            case 'NOTE': {
                const seat = client.me?.seat;
                add(ctx.render(s, (seat != null ? ev.you?.[String(seat)] : undefined) ?? ev.text));
                break;
            }
            case 'DICE_ROLLED':
                if (s.status === 'playing') add(`🎲 ${nameOf(s, ev.by)} würfelt ${ev.values.join(' + ')}`);
                break;
            case 'PIECE_MOVED':
                if (ev.by && ev.by !== 'rules' && square(s, ev.from) && square(s, ev.to)) {
                    add(`${nameOf(s, ev.by)}: ${escapeHtml(ev.from)} → ${escapeHtml(ev.to)}`);
                }
                break;
            case 'GAME_UPDATED':
                if (ev.status !== lastStatus) {
                    if (ev.status === 'playing' && lastStatus === 'lobby') add('▶ Spiel gestartet');
                    if (ev.status === 'finished') add('🏁 Spiel zu Ende');
                }
                lastStatus = ev.status;
                break;
        }
    });
    client.onState(s => { lastStatus = s.status; });
    return { get log() { return log; } };
}

/** Bildschirmpunkt eines Tischpunkts (für eigene Erweiterungen) */
export function screenOf(table: TableScene, p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(table.camera);
    const rect = table.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
}
