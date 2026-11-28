/**
 * Standard-Anzeige über dem Tisch (Engine 2.3): Statuszeile, Start-Knopf, Siegerehrung, kurze Hinweise.
 * Gespeist aus dem Standard-Spielstand der Regeln (say, alerts, scores, finished, result, NOTE-Ereignisse) –
 * ein Spiel muss dafür keinen Client-Code schreiben. Texte vom Server werden escaped; nur die Platzhalter
 * {who} {p2} {s2} werden zu HTML (Avatar + Name).
 */
import { escapeHtml } from '@treffen/boardgame-kit';
import { turnChime, win } from '../audio/sfx';
import { avatarImgHtml } from '../ui/avatar';
import type { TableClient } from '../net/TableClient';
import type { PlayState, TableState } from '../net/state';
import { formatClock } from '../objects/ClockLayer';

export interface HudTexts {
    /** „Spiel“ oder „Partie“ – für „▶ Spiel starten“, „Neue Runde/Partie“ */
    start?: string;
    newRound?: string;
    /** Figur abgelehnt */
    rejected?: string;
}

export interface HudContext {
    /** Name eines Platzes („Weiß“, „Gelb“, sonst „Platz 3“) */
    seatName(s: TableState, seat: number | null | undefined): string;
    /** „Du“ oder Name des Mitglieds an diesem Platz (sonst Platzname) */
    name(s: TableState, seat: number | null | undefined): string;
    /** Avatar + escapter Name (HTML) */
    who(s: TableState, seat: number | null | undefined): string;
    /** Text mit Platzhaltern → HTML */
    render(s: TableState, text: string): string;
}

/** Plätze, die gerade handeln dürfen */
export const movers = (p: PlayState | null | undefined): number[] =>
    !p ? [] : Array.isArray(p.to_move) ? p.to_move : p.turn != null ? [p.turn] : [];

export function hudContext(client: TableClient): HudContext {
    const member = (s: TableState, seat: number | null | undefined) => s.members.find(x => x.seat === seat);
    const ctx: HudContext = {
        seatName: (s, seat) => s.game.seat_names?.[seat ?? -1] ?? `Platz ${(seat ?? 0) + 1}`,
        name: (s, seat) => {
            const m = member(s, seat);
            return m ? (m.id === client.you ? 'Du' : m.name) : ctx.seatName(s, seat);
        },
        who: (s, seat) => avatarImgHtml(member(s, seat)) + escapeHtml(ctx.name(s, seat)),
        render: (s, text) => escapeHtml(text).replace(/\{(who|p\d+|s\d+)\}/g, (_, key: string) => {
            if (key === 'who') return movers(s.play).map(seat => ctx.who(s, seat)).join(' und ');
            const seat = Number(key.slice(1));
            return key[0] === 'p' ? ctx.who(s, seat) : escapeHtml(ctx.seatName(s, seat));
        }),
    };
    return ctx;
}

export interface Hud {
    ctx: HudContext;
    toast(text: string, html?: boolean): void;
}

/** Baut die Standard-Anzeige. `status` kann die Statuszeile eines Spiels ersetzen (null = Standard). */
export function setupHud(client: TableClient, texts: HudTexts,
    status?: (s: TableState, ctx: HudContext) => string | null, clockLeft?: (seat: number) => number | null): Hud {
    const ctx = hudContext(client);
    const el = (id: string) => document.getElementById(id)!;
    const statusEl = el('status'), startBtn = el('start-btn') as HTMLButtonElement, over = el('gameover');
    const rollBtn = el('roll-btn') as HTMLButtonElement, toastEl = el('toast'), actsEl = el('acts');
    // Knöpfe für Aktionen ohne Figur (Engine 2.4): „Weiter“, Farbe wünschen … – kommen als `acts` von den Regeln
    let actsKey = '';
    actsEl.addEventListener('click', ev => {
        const btn = (ev.target as HTMLElement).closest('button');
        if (btn?.dataset.lobby !== undefined) { client.newRound(); return; }
        if (btn?.dataset.undo !== undefined) { client.undo(); return; }
        if (btn?.dataset.undoYes !== undefined) { client.undoAnswer(true); return; }
        if (btn?.dataset.undoNo !== undefined) { client.undoAnswer(false); return; }
        const i = btn?.dataset.i;
        const a = i !== undefined ? client.myActs[Number(i)] : undefined;
        if (a) { client.act(a); navigator.vibrate?.(8); }
    });
    const word = texts.start ?? 'Spiel';

    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const toast = (text: string, html = false) => {
        if (html) toastEl.innerHTML = text; else toastEl.textContent = text;
        toastEl.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
    };

    startBtn.addEventListener('click', () => client.start());
    over.addEventListener('click', ev => {
        if ((ev.target as HTMLElement).id === 'newround-btn') client.newRound();
    });

    const scoresLine = (s: TableState, p: PlayState) => {
        if (!Array.isArray(p.scores)) return '';
        // nur besetzte Plätze; mit Namen (bzw. Platzname, wenn dort niemand mehr sitzt)
        const seated = new Set(s.members.filter(m => m.seat !== null).map(m => m.seat));
        const pts = p.scores.map((n, seat) => (seated.has(seat) || (p.finished ?? []).includes(seat) ? `${ctx.name(s, seat)} ${n}` : ''))
            .filter(Boolean).join(' · ');
        return `${escapeHtml(p.scores_label ?? 'Punkte')}: ${escapeHtml(pts)}`;
    };
    const alertOf = (p: PlayState, seat: number) => {
        const a = p.alerts?.[String(seat)];
        return a ? ` <b class="alert">${escapeHtml(a)}</b>` : '';
    };

    const defaultStatus = (s: TableState): string => {
        const me = client.me;
        if (s.status === 'lobby') {
            if (!client.isHost) return `Warte auf den Start durch ${escapeHtml(s.members.find(m => m.id === s.host_id)?.name ?? 'den Host')} …`;
            return escapeHtml(s.game.lobby || 'Setzt euch hin oder holt Computer an freie Plätze – dann starten.');
        }
        const p = s.play;
        if (s.status !== 'playing' || !p) return '';
        const mine = client.myTurn && me?.seat != null;
        const side = (seat: number) => s.game.seat_names ? ` (${escapeHtml(ctx.seatName(s, seat))})` : '';
        let text: string;
        if (mine && p.say?.me) text = avatarImgHtml(me) + ctx.render(s, p.say.me) + alertOf(p, me!.seat!);
        else if (mine) text = `${avatarImgHtml(me)}Du bist am Zug${side(me!.seat!)}${alertOf(p, me!.seat!)}`;
        else if (p.say?.all) text = ctx.render(s, p.say.all);
        else {
            const ms = movers(p);
            if (ms.length > 1) text = ms.map(seat => `${ctx.who(s, seat)}${alertOf(p, seat)}`).join(' und ') + ' sind am Zug …';
            else if (ms.length === 1) {
                const m = s.members.find(x => x.seat === ms[0]);
                text = `${ctx.who(s, ms[0])}${side(ms[0])} ${m?.is_bot ? 'denkt nach' : 'ist am Zug'} …${alertOf(p, ms[0])}`;
            } else text = '';
        }
        const sc = scoresLine(s, p);
        if (sc) text += `<br><small class="scores">${sc}</small>`;
        if (!me || me.seat === null) text = `👀 Du schaust zu · ${text}`;
        return text;
    };

    const gameOver = (s: TableState, p: PlayState): string => {
        const me = client.me;
        const result = p.result ?? null;
        let body: string;
        if (result) {
            const winners = result.winners ?? [];
            const iWin = me?.seat != null && winners.includes(me.seat);
            const head = !winners.length ? '🤝 Unentschieden'
                : winners.length === 1 ? `🏆 ${ctx.who(s, winners[0])} ${iWin ? 'gewinnst' : 'gewinnt'}`
                    : `🏆 ${winners.map(w => ctx.who(s, w)).join(' & ')} ${iWin ? '– ihr gewinnt' : 'gewinnen'}`;
            body = `<h2>${head}</h2><p class="reason">${escapeHtml(result.text ?? '')}</p>`;
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            const names = !!s.game.seat_names;
            const rows = (p.finished ?? []).map((seat, i) =>
                `<li><span>${medals[i] ?? i + 1 + '.'}</span> ${ctx.who(s, seat)}${
                    names ? ` <small>(${escapeHtml(ctx.seatName(s, seat))})</small>` : ''}</li>`).join('');
            body = `<h2>🏁 ${escapeHtml(word)} vorbei</h2><ol>${rows}</ol>`;
        }
        const sc = scoresLine(s, p);
        if (sc) body += `<p class="reason">${sc}</p>`;
        const again = texts.newRound ?? 'Neue Runde';
        return `<div class="gameover-card">${body}${client.isHost ? `<button id="newround-btn">${escapeHtml(again)}</button>`
            : `<p>Der Host kann eine ${escapeHtml(again.replace(/^Neue /, 'neue '))} starten.</p>`}</div>`;
    };

    client.onState(s => {
        const seated = s.members.filter(m => m.seat !== null).length;
        const need = s.game.min_players ?? 2;
        rollBtn.hidden = s.status !== 'playing' || !client.canRoll || !s.layout.dice;
        startBtn.hidden = s.status !== 'lobby' || !client.isHost;
        startBtn.disabled = seated < need;
        startBtn.textContent = seated >= need ? `▶ ${word} starten (${seated} Spieler)`
            : need >= s.game.seats ? `Alle ${s.game.seats} Plätze besetzen – oder Computer dazuholen`
                : `Mindestens ${need} Spieler (+ Computer)`;

        const acts = client.myActs;
        const lobbyBtn = s.status === 'playing' && !!s.play?.free && client.isHost;     // freies Spiel endet beim Host
        // Zurücknehmen (Hausregel): fragen, bzw. die Frage eines anderen beantworten
        const ask = s.status === 'playing' ? s.play?.undo_ask ?? null : null;
        const mySeat = client.me?.seat;
        let undoHtml = '';
        if (ask && ask.need.includes(client.you) && !ask.yes.includes(client.you)) {
            undoHtml = `<span class="ask">↩️ ${ctx.who(s, ask.seat)} möchte den Zug zurücknehmen</span>`
                + '<button data-undo-yes>Ja</button><button data-undo-no class="quiet">Nein</button>';
        } else if (ask && ask.by === client.you) {
            undoHtml = '<span class="ask">↩️ Warte auf Zustimmung …</span>';
        } else if (!ask && mySeat != null && (s.play?.undoable ?? []).includes(mySeat) && !client.me?.is_bot) {
            undoHtml = '<button data-undo class="quiet">↩️ Zurücknehmen</button>';
        }
        const key = JSON.stringify(acts) + lobbyBtn + undoHtml;
        if (key !== actsKey) {
            actsKey = key;
            actsEl.innerHTML = acts.map((a, i) => `<button data-i="${i}">${escapeHtml(a.label)}</button>`).join('')
                + undoHtml + (lobbyBtn ? '<button data-lobby class="quiet">🏁 Zurück in die Lobby</button>' : '');
            actsEl.hidden = !acts.length && !lobbyBtn && !undoHtml;
        }

        let text = status?.(s, ctx) ?? defaultStatus(s);
        if (text && s.status === 'playing' && s.play?.clock && mySeat != null && clockLeft) text += ' <span class="tt-clock"></span>';
        statusEl.innerHTML = text;
        tickClock();
        statusEl.hidden = !text;
        statusEl.classList.toggle('mine', client.myTurn && s.status === 'playing');

        if (s.status === 'finished' && s.play) {
            over.innerHTML = gameOver(s, s.play);
            over.hidden = false;
        } else {
            over.hidden = true;
        }
    });

    // Eigene Bedenkzeit in der Statuszeile (zählt selbst herunter, ohne neu zu zeichnen)
    function tickClock(): void {
        const span = statusEl.querySelector('.tt-clock') as HTMLElement | null, seat = client.me?.seat;
        if (!span || seat == null || !clockLeft) return;
        const left = clockLeft(seat);
        span.textContent = left === null ? '' : `⏱ ${formatClock(left)}`;
        span.classList.toggle('low', left !== null && left < 20);
    }
    setInterval(tickClock, 250);

    // Spürbar statt Text
    let alerted = false;
    client.onEvent(ev => {
        const s = client.state, seat = client.me?.seat;
        if (!s) return;
        if (ev.type === 'NOTE') {
            const mine = seat != null ? ev.you?.[String(seat)] : undefined;
            toast(ctx.render(s, mine ?? ev.text), true);
        }
        if (ev.type === 'GAME_UPDATED' && ev.status === 'playing' && ev.play && seat != null) {
            const p = ev.play;
            const nowMine = movers(p).includes(seat);
            const wasMine = s.status === 'playing' && movers(s.play).includes(seat);
            if (nowMine && !wasMine) {
                turnChime();
                navigator.vibrate?.([10, 60, 10]);          // du bist dran
            }
            const alert = !!p.alerts?.[String(seat)];
            if (alert && !alerted) navigator.vibrate?.([30, 50, 30]);            // z. B. Schach
            alerted = alert;
        }
        if (ev.type === 'GAME_UPDATED' && ev.status === 'finished' && s.status !== 'finished') {
            win();
        }
    });
    client.onError(err => {
        if (err.code === 'DROP_REJECTED') toast(texts.rejected ?? 'Dort kann die Figur nicht hin.');
    });
    return { ctx, toast };
}
