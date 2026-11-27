/**
 * Schach-Oberfläche über dem Tisch: eine Statuszeile (wer ist dran, Schach!), Start, Ergebnis.
 * Bewusst knapp – gespielt wird am Brett, nicht in Dialogen. Kennt alle Spielarten: klassisch, Team, Tandem, Vierschach.
 */
import { escapeHtml } from '@treffen/boardgame-kit';
import { avatarImgHtml, type PlayState, type TableClient, type TableState } from '@treffen/tabletop';

const SIDES: Record<string, string[]> = {
    klassisch: ['Weiß', 'Schwarz'],
    team: ['Weiß', 'Weiß', 'Schwarz', 'Schwarz'],
    tandem: ['Weiß auf Brett A', 'Schwarz auf Brett B', 'Schwarz auf Brett A', 'Weiß auf Brett B'],
    vierer: ['Rot', 'Blau', 'Gelb', 'Grün'],
};
const LOBBY: Record<string, string> = {
    klassisch: 'Setzt euch hin (Weiß vorn, Schwarz gegenüber) oder holt einen Computer – dann starten.',
    team: 'Teamschach: Weiß sitzt vorn zu zweit, Schwarz gegenüber. Ihr zieht abwechselnd für euer Team.',
    tandem: 'Tandem: Partner sitzen nebeneinander und spielen verschiedene Farben. Geschlagenes geht an den Partner.',
    vierer: 'Vierschach: Rot vorn, Blau links, Gelb hinten, Grün rechts.',
};
const variantOf = (s: TableState) => s.game.variant && SIDES[s.game.variant] ? s.game.variant : 'klassisch';
const side = (s: TableState, seat: number | null | undefined) => SIDES[variantOf(s)][seat ?? 0] ?? '';

/** Steht der König dieses Platzes im Schach (in jeder Spielart)? */
function inCheck(s: TableState, p: PlayState, seat: number): boolean {
    const boards = p.boards as Record<string, { check: boolean }> | undefined;
    if (boards) return !!boards[seat % 2 === 0 ? 'A' : 'B']?.check && (p.to_move ?? []).includes(seat);
    if (Array.isArray(p.checks)) {
        return (p.checks as string[]).some(sq => Object.entries(s.pieces)
            .some(([pid, ps]) => ps.field === sq && s.layout.pieces[pid]?.seat === seat));
    }
    return !!p.check && p.turn === seat;
}

export function setupHud(client: TableClient): void {
    const status = document.getElementById('status')!;
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
    const over = document.getElementById('gameover')!;

    startBtn.addEventListener('click', () => client.start());
    over.addEventListener('click', ev => {
        if ((ev.target as HTMLElement).id === 'newround-btn') client.newRound();
    });

    const member = (s: TableState, seat: number | null | undefined) => s.members.find(x => x.seat === seat);
    const name = (s: TableState, seat: number | null | undefined) => {
        const m = member(s, seat);
        return m ? (m.id === client.you ? 'Du' : m.name) : side(s, seat);
    };
    const who = (s: TableState, seat: number | null | undefined) => avatarImgHtml(member(s, seat)) + escapeHtml(name(s, seat));

    client.onState(s => {
        const me = client.me;
        const variant = variantOf(s);
        const need = s.game.seats;
        const seated = s.members.filter(m => m.seat !== null);
        startBtn.hidden = s.status !== 'lobby' || !client.isHost;
        startBtn.disabled = seated.length < need;
        startBtn.textContent = seated.length >= need ? '▶ Partie starten'
            : need === 2 ? 'Zu zweit – oder einen Computer dazuholen' : `Zu viert – freie Plätze mit Computern füllen`;

        let text = '', mine = false;
        const p = s.play;
        if (s.status === 'lobby') {
            const ffa = variant === 'vierer' && s.settings?.mode === 'ffa';
            text = client.isHost
                ? `${escapeHtml(LOBBY[variant])}${variant === 'vierer' ? (ffa ? ' Jeder gegen jeden.' : ' Partner sitzen sich gegenüber.') : ''}`
                : `Warte auf den Start durch ${escapeHtml(s.members.find(m => m.id === s.host_id)?.name ?? 'den Host')} …`;
        } else if (s.status === 'playing' && p) {
            mine = client.myTurn;
            const movers = p.to_move ?? (p.turn != null ? [p.turn] : []);
            const check = (seat: number) => (inCheck(s, p, seat) ? ' <b class="check">Schach!</b>' : '');
            if (mine && me?.seat != null) {
                text = `${avatarImgHtml(me)}Du bist am Zug (${escapeHtml(side(s, me.seat))})${check(me.seat)}`;
            } else if (movers.length > 1) {
                text = movers.map(seat => `${who(s, seat)}${check(seat)}`).join(' und ') + ' sind am Zug …';
            } else if (movers.length === 1) {
                const m = member(s, movers[0]);
                text = `${who(s, movers[0])} (${escapeHtml(side(s, movers[0]))}) ${m?.is_bot ? 'denkt nach' : 'ist am Zug'} …${check(movers[0])}`;
            }
            if (variant === 'vierer' && Array.isArray(p.points)) {
                const pts = (p.points as number[]).map((n, seat) => `${side(s, seat)} ${n}`).join(' · ');
                text += `<br><small class="points">Punkte: ${escapeHtml(pts)}</small>`;
            }
            if (!me || me.seat === null) text = `👀 Du schaust zu · ${text}`;
        }
        status.innerHTML = text;
        status.hidden = !text;
        status.classList.toggle('mine', mine);

        if (s.status === 'finished' && p) {
            const result = p.result as { winners: number[]; text: string } | undefined;
            const winners = result?.winners ?? [];
            const iWin = me?.seat != null && winners.includes(me.seat);
            const head = !winners.length ? '🤝 Remis'
                : winners.length === 1 ? `🏆 ${who(s, winners[0])} ${iWin ? 'gewinnst' : 'gewinnt'}`
                    : `🏆 ${winners.map(w => who(s, w)).join(' & ')} ${iWin ? '– ihr gewinnt' : 'gewinnen'}`;
            let extra = '';
            if (variant === 'vierer' && Array.isArray(p.points)) {
                extra = `<p class="reason">Punkte: ${escapeHtml((p.points as number[]).map((n, seat) => `${side(s, seat)} ${n}`).join(' · '))}</p>`;
            }
            over.innerHTML = `<div class="gameover-card"><h2>${head}</h2><p class="reason">${escapeHtml(result?.text ?? '')}</p>${extra}${
                client.isHost ? '<button id="newround-btn">Neue Partie</button>' : '<p>Der Host kann eine neue Partie starten.</p>'}</div>`;
            over.hidden = false;
        } else {
            over.hidden = true;
        }
    });

    // Spürbar statt Text: Schach → kurze Vibration bei dem, der im Schach steht
    client.onEvent(ev => {
        const s = client.state, seat = client.me?.seat;
        if (ev.type === 'GAME_UPDATED' && ev.play && s && seat != null && inCheck(s, ev.play, seat)) navigator.vibrate?.([30, 50, 30]);
    });
}
