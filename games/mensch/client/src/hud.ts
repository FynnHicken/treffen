/**
 * Mensch-Oberfläche über dem Tisch: Statuszeile (wer ist dran, was ist zu tun), Start, Siegerehrung.
 */
import { escapeHtml } from '@treffen/boardgame-kit';
import { avatarImgHtml, type TableClient, type TableState } from '@treffen/tabletop';

const COLOR_NAMES = ['Gelb', 'Grün', 'Rot', 'Schwarz'];

export function setupHud(client: TableClient, toast: (t: string) => void): void {
    const status = document.getElementById('status')!;
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
    const rollBtn = document.getElementById('roll-btn') as HTMLButtonElement;
    const over = document.getElementById('gameover')!;

    startBtn.addEventListener('click', () => client.start());
    over.addEventListener('click', ev => {
        if ((ev.target as HTMLElement).id === 'newround-btn') client.newRound();
    });

    const name = (s: TableState, seat: number | null | undefined) => {
        const m = s.members.find(x => x.seat === seat);
        return m ? (m.id === client.you ? 'Du' : m.name) : COLOR_NAMES[seat ?? 0];
    };
    /** Avatar (aus dem Hub) + escapter Name – für HTML */
    const who = (s: TableState, seat: number | null | undefined) =>
        avatarImgHtml(s.members.find(x => x.seat === seat)) + escapeHtml(name(s, seat));

    client.onState(s => {
        const me = client.me;
        const seated = s.members.filter(m => m.seat !== null);
        rollBtn.hidden = !client.canRoll || s.status === 'lobby';
        startBtn.hidden = s.status !== 'lobby' || !client.isHost;
        startBtn.disabled = seated.length < 2;
        startBtn.textContent = seated.length < 2 ? 'Mindestens 2 Spieler (+ Computer)' : `▶ Spiel starten (${seated.length} Spieler)`;

        let text = '', mine = false;
        if (s.status === 'lobby') {
            text = client.isHost
                ? 'Setzt euch hin oder holt Computer an freie Plätze – dann starten.'
                : `Warte auf den Start durch ${escapeHtml(s.members.find(m => m.id === s.host_id)?.name ?? 'den Host')} …`;
        } else if (s.status === 'playing' && s.play) {
            const p = s.play;
            mine = client.myTurn;
            const turn = who(s, p.turn);
            const mineAv = avatarImgHtml(me);
            if (p.phase === 'roll') {
                const tries = (p.rolls_left ?? 0) > 1 ? ` (noch ${p.rolls_left} Versuche für eine 6)` : '';
                text = mine ? `${mineAv}Du bist dran – greif den Becher und würfle!${tries}` : `${turn} würfelt …`;
            } else if (p.phase === 'move') {
                text = mine ? `${mineAv}Du hast eine ${p.dice} – zieh eine leuchtende Figur.` : `${turn} hat eine ${p.dice} und zieht …`;
            }
            if (!me || me.seat === null) text = `👀 Du schaust zu · ${text}`;
        }
        status.innerHTML = text;
        status.hidden = !text;
        status.classList.toggle('mine', mine);

        // Siegerehrung
        if (s.status === 'finished' && s.play) {
            const medals = ['🥇', '🥈', '🥉', '4.'];
            const rows = (s.play.finished ?? []).map((seat, i) =>
                `<li><span>${medals[i] ?? i + 1 + '.'}</span> ${who(s, seat)} <small>(${COLOR_NAMES[seat]})</small></li>`).join('');
            over.innerHTML = `<div class="gameover-card"><h2>🏁 Spiel vorbei</h2><ol>${rows}</ol>${
                client.isHost ? '<button id="newround-btn">Neue Runde</button>' : '<p>Der Host kann eine neue Runde starten.</p>'}</div>`;
            over.hidden = false;
        } else {
            over.hidden = true;
        }
    });

    // Ereignisse, die man spüren soll
    client.onEvent(ev => {
        const s = client.state;
        if (!s) return;
        if (ev.type === 'PIECE_MOVED' && ev.reason === 'captured') {
            const victim = s.layout.pieces[ev.piece]?.seat;
            toast(`💥 ${name(s, victim)} ${victim === client.me?.seat ? 'wurdest' : 'wurde'} rausgeworfen!`);
        }
        if (ev.type === 'GAME_UPDATED' && ev.status === 'playing' && ev.play?.phase === 'roll' && ev.play.turn === client.me?.seat
            && ev.play.dice == null) {
            navigator.vibrate?.([10, 60, 10]);
        }
    });
}
