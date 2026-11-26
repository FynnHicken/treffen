// Tests für den Hub-Sync-Server. Startet server.js auf einem freien Port und spricht ihn per WebSocket an.
//   cd party-server && npm install && npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';

const SECRET = 'test-ticket-secret';
const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let server, port;

function freePort() {
    return new Promise(resolve => {
        const srv = net.createServer().listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    });
}

before(async () => {
    port = await freePort();
    server = spawn(process.execPath, ['server.js'], {
        cwd: DIR, env: { ...process.env, PORT: String(port), TREFFEN_TICKET_SECRET: SECRET }, stdio: ['ignore', 'pipe', 'inherit']
    });
    await new Promise((resolve, reject) => {
        server.stdout.on('data', d => { if (String(d).includes('listening')) resolve(); });
        server.on('exit', code => reject(new Error(`server.js beendet (${code})`)));
    });
});
after(() => server && server.kill());

/** Client mit Nachrichten-Puffer und waitFor(predicate). */
async function client(room, id, secret = `secret-${id}`, name = id) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?room=${room}`);
    const msgs = [];
    const waiters = [];
    ws.on('message', raw => {
        const m = JSON.parse(raw);
        msgs.push(m);
        for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    });
    await new Promise(r => ws.on('open', r));
    const c = {
        ws, msgs, id,
        send: msg => ws.send(JSON.stringify(msg)),
        waitFor(pred, ms = 1500) {
            const hit = msgs.find(pred);
            if (hit) return Promise.resolve(hit);
            return new Promise((resolve, reject) => {
                const w = { pred, resolve };
                waiters.push(w);
                setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('Timeout: erwartete Nachricht kam nicht')); }, ms);
            });
        },
        lastRoster: () => [...msgs].reverse().find(m => m.type === 'ROSTER_SYNC'),
        clear: () => { msgs.length = 0; },
        close: () => ws.close()
    };
    c.send({ type: 'JOIN', secret, user: { id, name } });
    return c;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rosterWith = n => m => m.type === 'ROSTER_SYNC' && m.players.length === n;

function verifyTicket(ticket) {
    const [body, sig] = ticket.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    assert.equal(sig, expected, 'Signatur passt');
    return JSON.parse(Buffer.from(body, 'base64url').toString());
}

test('Erster Spieler wird Host, zweiter nicht', async () => {
    const a = await client('R1', 'alice');
    const b = await client('R1', 'bob');
    const r = await b.waitFor(rosterWith(2));
    assert.equal(r.hostId, 'alice');
    assert.deepEqual(r.players.map(p => [p.id, p.isHost]), [['alice', true], ['bob', false]]);
    a.close(); b.close();
});

test('Fremdes Secret für eine vergebene ID wird abgelehnt', async () => {
    const a = await client('R2', 'alice');
    await a.waitFor(rosterWith(1));
    const evil = await client('R2', 'alice', 'falsches-secret');
    const m = await evil.waitFor(m => m.type === 'JOIN_REJECTED');
    assert.equal(m.reason, 'id-in-use');
    a.close(); evil.close();
});

test('Nur der Host kann ein Spiel starten', async () => {
    const a = await client('R3', 'alice');
    const b = await client('R3', 'bob');
    await a.waitFor(rosterWith(2));
    b.send({ type: 'LAUNCH_GAME', gameId: 'uno' });
    await sleep(200);
    assert.ok(!a.msgs.some(m => m.type === 'LAUNCH_GAME'), 'Gast-Start wird ignoriert');
    a.send({ type: 'LAUNCH_GAME', gameId: 'uno' });
    const m = await b.waitFor(m => m.type === 'LAUNCH_GAME');
    assert.equal(m.gameId, 'uno');
    a.close(); b.close();
});

test('Spiel-Tickets: signiert, pro Person, host nur beim Host', async () => {
    const a = await client('R4', 'alice');
    const b = await client('R4', 'bob');
    await a.waitFor(rosterWith(2));
    const ta = verifyTicket(a.lastRoster().gameTicket);
    const tb = verifyTicket((await b.waitFor(rosterWith(2))).gameTicket);
    assert.equal(ta.room, 'R4'); assert.equal(ta.pid, 'alice'); assert.equal(ta.host, true);
    assert.equal(tb.pid, 'bob'); assert.equal(tb.host, false);
    assert.ok(ta.exp > Date.now() / 1000, 'Ticket noch gültig');
    a.close(); b.close();
});

test('Abstimmung: standardmäßig nur Host, Stimmen kommen bei allen an', async () => {
    const a = await client('R5', 'alice');
    const b = await client('R5', 'bob');
    await a.waitFor(rosterWith(2));
    assert.equal(a.lastRoster().hubSettings.anyoneCanVote, false, 'Standard: aus');

    b.send({ type: 'VOTE_TOGGLE', isVotingActive: true });
    const denied = await b.waitFor(m => m.type === 'VOTE_UPDATE' && m.denied);
    assert.equal(denied.isVotingActive, false, 'Gast darf Abstimmung nicht starten');

    a.send({ type: 'VOTE_TOGGLE', isVotingActive: true });
    await b.waitFor(m => m.type === 'VOTE_UPDATE' && m.isVotingActive === true);
    b.send({ type: 'VOTE_CAST', gameId: 'monopoly' });
    const v = await a.waitFor(m => m.type === 'VOTE_UPDATE' && m.votes.monopoly === 1);
    assert.equal(v.votes.monopoly, 1, 'Stimme von Bob kommt bei Alice an');
    b.send({ type: 'VOTE_CAST', gameId: 'gibtsnicht' });
    await sleep(150);

    a.send({ type: 'VOTE_TOGGLE', isVotingActive: false });
    const end = await b.waitFor(m => m.type === 'VOTE_UPDATE' && m.isVotingActive === false && !m.denied);
    assert.equal(end.votes.monopoly, 0, 'Beenden setzt Stimmen zurück');
    a.close(); b.close();
});

test('Raum-Einstellungen: nur Host ändert, unbekannte Schlüssel werden ignoriert', async () => {
    const a = await client('R6', 'alice');
    const b = await client('R6', 'bob');
    await a.waitFor(rosterWith(2));
    b.send({ type: 'HUB_SETTINGS_UPDATE', settings: { anyoneCanVote: true } });
    await sleep(200);
    assert.equal(a.lastRoster().hubSettings.anyoneCanVote, false, 'Gast kann Einstellungen nicht ändern');

    a.clear(); b.clear();
    a.send({ type: 'HUB_SETTINGS_UPDATE', settings: { anyoneCanVote: true, evil: 'x', isHost: true } });
    const r = await b.waitFor(m => m.type === 'ROSTER_SYNC' && m.hubSettings.anyoneCanVote === true);
    assert.deepEqual(Object.keys(r.hubSettings), ['anyoneCanVote'], 'nur bekannte Schlüssel');

    b.send({ type: 'VOTE_TOGGLE', isVotingActive: true });
    await a.waitFor(m => m.type === 'VOTE_UPDATE' && m.isVotingActive === true);
    a.close(); b.close();
});

test('Profilnamen werden bereinigt', async () => {
    const a = await client('R7', 'alice', 'secret-a', '<img src=x onerror=alert(1)>');
    const r = await a.waitFor(rosterWith(1));
    assert.ok(!/[<>"']/.test(r.players[0].name), `Name ohne HTML-Zeichen: ${r.players[0].name}`);
    a.close();
});

test('Ungültiger Raumcode wird abgelehnt', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?room=%3Cscript%3E`);
    const code = await new Promise(r => ws.on('close', c => r(c)));
    assert.equal(code, 1008);
});

test('Gestartete Spiele landen im Verlauf, unbekannte Spiele werden ignoriert', async () => {
    const a = await client('R8', 'alice');
    const b = await client('R8', 'bob');
    await a.waitFor(rosterWith(2));
    a.send({ type: 'LAUNCH_GAME', gameId: 'gibtsnicht' });
    await sleep(150);
    assert.ok(!b.msgs.some(m => m.type === 'LAUNCH_GAME'), 'unbekanntes Spiel startet nicht');
    a.send({ type: 'LAUNCH_GAME', gameId: 'uno', lobbyId: '<script>' });
    const l = await b.waitFor(m => m.type === 'LAUNCH_GAME');
    assert.equal(l.lobbyId, null, 'ungültige Lobby-ID wird verworfen');
    const r = await b.waitFor(m => m.type === 'ROSTER_SYNC' && m.history && m.history.length === 1);
    assert.equal(r.history[0].gameId, 'uno');
    assert.ok(Math.abs(r.history[0].startedAt - Date.now()) < 5000, 'Startzeit stimmt');
    a.close(); b.close();
});

test('Avatar als SVG: Farbe + gemaltes Gesicht, unbekannte Spieler 404, ETag', async () => {
    const face = 'data:image/png;base64,iVBORw0KGgo=';
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?room=R9`);
    await new Promise(r => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'JOIN', secret: 's', user: { id: 'p_alice', name: 'Alice', color: '#22c55e', avatar: face } }));
    await sleep(150);
    const url = `http://127.0.0.1:${port}/party-ws/avatar/r9/p_alice.svg`;
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    const svg = await res.text();
    assert.ok(svg.includes('fill="#22c55e"'), 'Körperfarbe');
    assert.ok(svg.includes(`href="${face}"`), 'Gesicht eingebettet');
    const again = await fetch(url, { headers: { 'If-None-Match': res.headers.get('etag') } });
    assert.equal(again.status, 304);
    const json = await (await fetch(`http://127.0.0.1:${port}/party-ws/avatar/R9/p_alice.json`)).json();
    assert.deepEqual(json, { color: '#22c55e', face });
    assert.equal((await fetch(`http://127.0.0.1:${port}/party-ws/avatar/R9/niemand.svg`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/party-ws/avatar/R9/..%2Fx.svg`)).status, 404);
    ws.close();
});
