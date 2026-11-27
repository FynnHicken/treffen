/**
 * Schach-Oberfläche über dem Tisch: eine Statuszeile (wer ist dran, Schach!), Start, Ergebnis.
 * Bewusst knapp – gespielt wird am Brett, nicht in Dialogen.
 */
import { escapeHtml } from '@treffen/boardgame-kit';
import { avatarImgHtml, type TableClient, type TableState } from '@treffen/tabletop';

const SIDE = ['Weiß', 'Schwarz'];

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
        return m ? (m.id === client.you ? 'Du' : m.name) : SIDE[seat ?? 0];
    };
    const who = (s: TableState, seat: number | null | undefined) => avatarImgHtml(member(s, seat)) + escapeHtml(name(s, seat));

    client.onState(s => {
        const me = client.me;
        const seated = s.members.filter(m => m.seat !== null);
        startBtn.hidden = s.status !== 'lobby' || !client.isHost;
        startBtn.disabled = seated.length < 2;
        startBtn.textContent = seated.length < 2 ? 'Zu zweit – oder einen Computer dazuholen' : '▶ Partie starten';

        let text = '', mine = false;
        const p = s.play;
        if (s.status === 'lobby') {
            text = client.isHost
                ? 'Setzt euch hin (Weiß vorn, Schwarz gegenüber) oder holt einen Computer – dann starten.'
                : `Warte auf den Start durch ${escapeHtml(s.members.find(m => m.id === s.host_id)?.name ?? 'den Host')} …`;
        } else if (s.status === 'playing' && p) {
            mine = client.myTurn;
            const check = p.check ? ' <b class="check">Schach!</b>' : '';
            const m = member(s, p.turn);
            text = mine
                ? `${avatarImgHtml(me)}Du bist am Zug (${SIDE[p.turn ?? 0]})${check}`
                : `${who(s, p.turn)} ${m?.is_bot ? 'denkt nach' : 'ist am Zug'} …${check}`;
            if (!me || me.seat === null) text = `👀 Du schaust zu · ${text}`;
        }
        status.innerHTML = text;
        status.hidden = !text;
        status.classList.toggle('mine', mine);

        if (s.status === 'finished' && p) {
            const result = p.result as { winners: number[]; text: string } | undefined;
            const winner = result?.winners?.[0];
            const head = winner !== undefined
                ? `🏆 ${who(s, winner)} ${winner === me?.seat ? 'gewinnst' : 'gewinnt'}`
                : '🤝 Remis';
            over.innerHTML = `<div class="gameover-card"><h2>${head}</h2><p class="reason">${escapeHtml(result?.text ?? '')}</p>${
                client.isHost ? '<button id="newround-btn">Neue Partie</button>' : '<p>Der Host kann eine neue Partie starten.</p>'}</div>`;
            over.hidden = false;
        } else {
            over.hidden = true;
        }
    });

    // Spürbar statt Text: Schach → kurze Vibration bei dem, der im Schach steht
    client.onEvent(ev => {
        if (ev.type === 'GAME_UPDATED' && ev.play?.check && ev.play.turn === client.me?.seat) navigator.vibrate?.([30, 50, 30]);
    });
}
