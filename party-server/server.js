import http from 'http';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { checkForUpdate, setActiveChannel, triggerWebhookUpdate, verifyHubHostTicket } from './updater.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

const SOLO_ROOM_TTL_MS = 60000; // 60 seconds for unused rooms with <= 1 player

// Spiel-Tickets: signierter Nachweis für Spiele (z. B. Monopoly), wer im Hub-Raum Host ist.
// Gleicher Schlüssel muss im Spiel gesetzt sein (siehe games/monopoly/server/auth.py, packages/tabletop-server).
const TICKET_SECRET = (process.env.TREFFEN_TICKET_SECRET || '').trim();
const TICKET_TTL_MS = 30 * 60 * 1000;
if (!TICKET_SECRET) {
    console.warn('⚠️  TREFFEN_TICKET_SECRET nicht gesetzt – Spiele bekommen keine signierten Tickets.');
}
function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signTicket(payload) {
    if (!TICKET_SECRET) return null;
    const body = b64url(JSON.stringify(payload));
    const sig = b64url(crypto.createHmac('sha256', TICKET_SECRET).update(body).digest());
    return `${body}.${sig}`;
}

// Profilfelder kommen vom Client und landen bei allen anderen im DOM –
// daher hier hart begrenzen (Defense in depth, der Client escaped zusätzlich).
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const AVATAR_DATA_URL_RE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]{1,32768}$/;
function cleanText(value, maxLen, fallback) {
    if (typeof value !== 'string') return fallback;
    const cleaned = value.replace(/[<>"'`&\u0000-\u001f]/g, '').trim().slice(0, maxLen);
    return cleaned || fallback;
}
function cleanAvatar(value) {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (AVATAR_DATA_URL_RE.test(trimmed)) return trimmed;
    return cleanText(trimmed, 8, undefined);
}
function sanitizeProfile(user) {
    return {
        name: cleanText(user.name, 24, undefined),
        avatar: cleanAvatar(user.avatar),
        color: typeof user.color === 'string' && COLOR_RE.test(user.color) ? user.color : undefined,
        status: cleanText(user.status, 32, undefined)
    };
}

// Raum-Einstellungen, die nur der Host ändert. Neue Einstellung = ein Eintrag hier
// (+ Text im Hub unter HUB_SETTING_LABELS in party-hub/app.js). Nur boolesche Schalter.
const HUB_SETTINGS_SCHEMA = {
    anyoneCanVote: { default: false }   // false = nur der Host startet/beendet Abstimmungen
};
function defaultHubSettings() {
    return Object.fromEntries(Object.entries(HUB_SETTINGS_SCHEMA).map(([k, v]) => [k, v.default]));
}

const KNOWN_GAME_IDS = ['skribbol', 'uno', 'codenames', 'price_guess', 'monopoly', 'mensch', 'schach'];
const HISTORY_LIMIT = 12; // so viele gestartete Spiele merkt sich ein Raum („Heute gespielt“)

class Room {
    constructor(code) {
        this.code = code;
        this.players = new Map(); // id -> player object
        this.sockets = new Map(); // id -> WebSocket
        this.socketToPlayerId = new Map(); // ws -> playerId
        this.votes = Object.fromEntries(KNOWN_GAME_IDS.map(id => [id, 0]));
        this.hubSettings = defaultHubSettings();
        this.userVotes = new Map(); // playerId -> gameId
        this.isVotingActive = false;
        this.activeModalGameId = null;
        this.activeGame = null;
        this.history = []; // gestartete Spiele dieses Raums: { gameId, startedAt } (neueste zuletzt)
        this.gameSettings = {};
        this.hostId = null;
        this.creatorId = null;
        this.hostTransferred = false;
        this.disconnectTimers = new Map(); // playerId -> timer
        this.secrets = new Map(); // playerId -> client secret (bindet die ID an den Browser)
        this.expiresAt = Date.now() + SOLO_ROOM_TTL_MS;
    }

    updateExpiryTimer(forceReset = false) {
        if (this.players.size <= 1 && !this.activeGame) {
            if (!this.expiresAt || forceReset) {
                this.expiresAt = Date.now() + SOLO_ROOM_TTL_MS;
            }
        } else {
            this.expiresAt = null;
        }
    }

    addPlayer(user, ws, secret) {
        if (!user || typeof user.id !== 'string' || !user.id || user.id.length > 64) return false;

        // Eine Spieler-ID gehört dem Browser, der sie zuerst benutzt hat.
        // Verhindert, dass jemand die (im Roster sichtbare) Host-ID übernimmt.
        const clientSecret = typeof secret === 'string' ? secret.slice(0, 128) : null;
        if (this.secrets.has(user.id)) {
            if (this.secrets.get(user.id) !== clientSecret) {
                console.warn(`[Room ${this.code}] Rejected JOIN for ${user.id}: secret mismatch`);
                return false;
            }
        } else {
            this.secrets.set(user.id, clientSecret);
        }

        // Alten Socket derselben ID entkoppeln (z. B. zweiter Tab / Reconnect)
        const oldWs = this.sockets.get(user.id);
        if (oldWs && oldWs !== ws) {
            this.socketToPlayerId.delete(oldWs);
        }
        const profile = sanitizeProfile(user);

        // Cancel pending disconnect timer if player reconnected
        if (this.disconnectTimers.has(user.id)) {
            clearTimeout(this.disconnectTimers.get(user.id));
            this.disconnectTimers.delete(user.id);
        }

        const wasEmpty = this.players.size === 0;

        // Remember the original creator of this room
        if (!this.creatorId && (wasEmpty || user.isCreator)) {
            this.creatorId = user.id;
        }

        // If original creator reconnects and host was not manually transferred, restore creator as host
        if (this.creatorId === user.id && !this.hostTransferred) {
            this.hostId = user.id;
        } else if (!this.hostId || !this.players.has(this.hostId)) {
            if (this.hostId !== user.id && this.players.size === 0) {
                this.hostId = user.id;
            } else if (!this.hostId) {
                this.hostId = user.id;
            }
        }

        const isHost = (this.hostId === user.id);

        const player = {
            id: user.id,
            name: profile.name || "Gast",
            avatar: profile.avatar || "",
            color: profile.color || "#6366f1",
            isHost: isHost,
            isReady: user.isReady ?? true,
            status: profile.status || "Bereit",
            joinedAt: Number.isFinite(user.joinedAt) ? user.joinedAt : Date.now(),
            lastSeen: Date.now()
        };

        this.players.set(user.id, player);
        this.sockets.set(user.id, ws);
        this.socketToPlayerId.set(ws, user.id);

        // Ensure all other players have isHost = false
        for (const [pid, p] of this.players.entries()) {
            p.isHost = (pid === this.hostId);
        }

        this.updateExpiryTimer(wasEmpty);

        console.log(`[Room ${this.code}] Player joined: ${player.name} (${player.id}) [Host: ${isHost}, currentHost: ${this.hostId}]`);
        this.broadcastRoster();
        return true;
    }

    updateUser(playerId, user) {
        if (!playerId || !user) return;
        const player = this.players.get(playerId);
        if (player) {
            const profile = sanitizeProfile(user);
            if (profile.name) player.name = profile.name;
            if (profile.avatar) player.avatar = profile.avatar;
            if (profile.color) player.color = profile.color;
            player.lastSeen = Date.now();
            this.broadcastRoster();
        }
    }

    setReadyState(playerId, isReady) {
        const player = this.players.get(playerId);
        if (player) {
            player.isReady = !!isReady;
            this.broadcast({
                type: "READY_STATE_CHANGED",
                playerId: playerId,
                isReady: player.isReady
            });
            this.broadcastRoster();
        }
    }

    handleDisconnect(ws) {
        const playerId = this.socketToPlayerId.get(ws);
        if (!playerId) return;

        this.socketToPlayerId.delete(ws);
        // Spieler hat inzwischen einen neuen Socket (Reload/zweiter Tab) → nichts entfernen
        if (this.sockets.get(playerId) !== ws) return;
        this.sockets.delete(playerId);

        // Grace period of 15 seconds before removing player (handles app switching on mobile to share room code, page refresh, etc.)
        const timer = setTimeout(() => {
            this.disconnectTimers.delete(playerId);
            const player = this.players.get(playerId);
            if (!player) return;

            console.log(`[Room ${this.code}] Player left: ${player.name} (${playerId})`);
            this.players.delete(playerId);
            this.userVotes.delete(playerId);
            if (playerId !== this.creatorId) this.secrets.delete(playerId);
            this.recalcVotes();

            // Pass host to next remaining player if host left
            if (this.hostId === playerId) {
                const remaining = Array.from(this.players.values()).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
                if (remaining.length > 0) {
                    this.hostId = remaining[0].id;
                    remaining[0].isHost = true;
                    console.log(`[Room ${this.code}] New host elected: ${remaining[0].name}`);
                } else {
                    this.hostId = null;
                    this.activeGame = null;
                    this.activeModalGameId = null;
                }
            }

            if (this.players.size === 0 && this.disconnectTimers.size === 0) {
                rooms.delete(this.code);
                console.log(`[Room ${this.code}] Empty room removed.`);
                return;
            }

            this.updateExpiryTimer(true);
            this.broadcastRoster();
            this.broadcast({
                type: "PLAYER_LEFT",
                playerId: playerId,
                name: player.name
            });
        }, 15000);

        this.disconnectTimers.set(playerId, timer);
    }

    recalcVotes() {
        const counts = Object.fromEntries(KNOWN_GAME_IDS.map(id => [id, 0]));
        for (const gameId of this.userVotes.values()) {
            if (counts[gameId] !== undefined) {
                counts[gameId]++;
            }
        }
        this.votes = counts;
    }

    castVote(playerId, gameId) {
        if (!this.isVotingActive || !KNOWN_GAME_IDS.includes(gameId)) return;
        const current = this.userVotes.get(playerId);
        if (current === gameId) {
            this.userVotes.delete(playerId);
        } else {
            this.userVotes.set(playerId, gameId);
        }
        this.recalcVotes();
        this.broadcastVotes();
    }

    broadcastVotes() {
        this.broadcast({ type: "VOTE_UPDATE", votes: this.votes, isVotingActive: this.isVotingActive });
    }

    canToggleVoting(ws) {
        return this.isSenderHost(ws) || (this.hubSettings.anyoneCanVote && this.socketToPlayerId.has(ws));
    }

    updateHubSettings(changes) {
        if (!changes || typeof changes !== 'object') return;
        for (const [key, value] of Object.entries(changes)) {
            if (HUB_SETTINGS_SCHEMA[key] && typeof value === 'boolean') this.hubSettings[key] = value;
        }
        this.broadcastRoster();
    }

    toggleVoting(isActive) {
        this.isVotingActive = !!isActive;
        if (!this.isVotingActive) {
            this.userVotes.clear();
            this.recalcVotes();
        }
        this.broadcastVotes();
    }

    transferHost(targetPlayerId) {
        if (!this.players.has(targetPlayerId)) return false;
        const previousHostId = this.hostId;
        this.hostId = targetPlayerId;
        this.hostTransferred = true;
        const targetPlayer = this.players.get(targetPlayerId);
        console.log(`[Room ${this.code}] Host transferred from ${previousHostId} to ${targetPlayer ? targetPlayer.name : targetPlayerId}`);
        this.broadcastRoster();
        this.broadcast({
            type: "HOST_TRANSFERRED",
            previousHostId: previousHostId,
            newHostId: targetPlayerId,
            newHostName: targetPlayer ? targetPlayer.name : "Neuer Host"
        });
        return true;
    }

    isSenderHost(ws) {
        // Nur die serverseitig an den Socket gebundene ID zählt, nie Felder aus der Nachricht
        const senderId = this.socketToPlayerId.get(ws);
        if (!senderId) return false;
        if (senderId === this.hostId) return true;
        if (!this.hostId && this.players.size > 0) {
            const firstPlayer = Array.from(this.players.values()).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
            this.hostId = firstPlayer ? firstPlayer.id : senderId;
            return senderId === this.hostId;
        }
        return false;
    }

    broadcastRoster() {
        this.updateExpiryTimer(false);
        const playerList = Array.from(this.players.values()).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
        playerList.forEach(p => {
            p.isHost = (p.id === this.hostId);
        });

        const now = Date.now();
        this.broadcastPersonal({
            type: "ROSTER_SYNC",
            players: playerList,
            hostId: this.hostId,
            isVotingActive: this.isVotingActive,
            votes: this.votes,
            activeModalGameId: this.activeModalGameId,
            activeGame: this.activeGame,
            history: this.history,
            gameSettings: this.gameSettings,
            hubSettings: this.hubSettings,
            expiresAt: this.expiresAt,
            remainingMs: this.expiresAt ? Math.max(0, this.expiresAt - now) : null,
            ttlTotalMs: SOLO_ROOM_TTL_MS
        });
    }

    // Wie broadcast(), aber jeder Socket bekommt zusätzlich sein eigenes Spiel-Ticket
    broadcastPersonal(msg) {
        const exp = Date.now() + TICKET_TTL_MS;
        for (const [id, ws] of this.sockets.entries()) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            const player = this.players.get(id);
            const gameTicket = player ? signTicket({
                v: 1, room: this.code, pid: id, name: player.name, host: id === this.hostId, exp: Math.floor(exp / 1000)
            }) : null;
            try {
                ws.send(JSON.stringify(gameTicket ? { ...msg, gameTicket } : msg));
            } catch (e) {
                console.error(`[Room ${this.code}] Send error to ${id}:`, e);
            }
        }
    }

    broadcast(msg, excludeWs = null) {
        const payload = JSON.stringify(msg);
        for (const [id, ws] of this.sockets.entries()) {
            if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(payload);
                } catch (e) {
                    console.error(`[Room ${this.code}] Send error to ${id}:`, e);
                }
            }
        }
    }
}

const rooms = new Map();

function getOrCreateRoom(code) {
    const cleanCode = (code || "DEFAULT").toUpperCase();
    if (!rooms.has(cleanCode)) {
        rooms.set(cleanCode, new Room(cleanCode));
    }
    return rooms.get(cleanCode);
}

// Automatically clean up unused rooms with <= 1 player after 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
        if (room.players.size <= 1 && !room.activeGame && room.expiresAt && now >= room.expiresAt) {
            console.log(`[Room ${code}] Auto-deleting unused room (<= 1 player for 60s)`);
            room.broadcast({
                type: "ROOM_EXPIRED",
                code: code,
                reason: "Ungenutzter Raum (max. 1 Person) wurde nach 60 Sekunden automatisch geschlossen."
            });
            for (const ws of room.sockets.values()) {
                try { ws.close(); } catch (e) {}
            }
            for (const t of room.disconnectTimers.values()) {
                clearTimeout(t);
            }
            rooms.delete(code);
        }
    }
}, 1000);

// Avatare als fertiges Bild für die Spiele: /party-ws/avatar/<RAUM>/<Spieler-ID>.svg
// (.json liefert {color, face} – für Spiele, die selbst auf ein Canvas/WebGL zeichnen: ein SVG würde
// dort je nach Browser das Canvas „verunreinigen“, ein data:-PNG nicht)
// Die Spiele kennen die Spieler-ID aus dem Ticket und brauchen nur ein <img>; die Bilddaten
// laufen so nicht durch ihre eigenen Protokolle. Gesicht und Farbe sind beim Beitritt geprüft
// (sanitizeProfile), das SVG wird über <img> geladen (keine Skripte) und hat zusätzlich eine strenge CSP.
const AVATAR_PATH_RE = /^\/(?:party-ws\/)?avatar\/([A-Za-z0-9_-]{1,32})\/([A-Za-z0-9_-]{1,64})\.(svg|json)$/;
const DEFAULT_FACE_SVG = '<g transform="translate(22, 11) scale(0.56)"><circle cx="35" cy="42" r="7" fill="#111827"/>' +
    '<circle cx="65" cy="42" r="7" fill="#111827"/><circle cx="37" cy="40" r="2.2" fill="#fff"/>' +
    '<circle cx="67" cy="40" r="2.2" fill="#fff"/><path d="M33,62 Q50,76 67,62" fill="none" stroke="#111827" ' +
    'stroke-width="6.5" stroke-linecap="round"/></g>';
function avatarSvg(player) {
    const color = COLOR_RE.test(player.color || '') ? player.color : '#6366f1';
    const face = AVATAR_DATA_URL_RE.test(player.avatar || '')
        ? `<image href="${player.avatar}" x="0" y="0" width="100" height="100"/>`
        : DEFAULT_FACE_SVG;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">' +
        '<defs><clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath></defs><g clip-path="url(#c)">' +
        '<rect width="100" height="100" fill="#1e293b" opacity="0.18"/>' +
        `<path d="M14,104 C14,72 30,62 50,62 C70,62 86,72 86,104 Z" fill="${color}" stroke="#1e293b" stroke-width="5" stroke-linejoin="round"/>` +
        `<circle cx="50" cy="39" r="28" fill="${color}" stroke="#1e293b" stroke-width="5"/>` +
        '<path d="M31,24 A22,22 0 0,1 48,16" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="3.5" stroke-linecap="round"/>' +
        `${face}</g></svg>`;
}
function serveAvatar(req, res, pathname) {
    const m = AVATAR_PATH_RE.exec(pathname);
    if (!m) return false;
    const room = rooms.get(m[1].toUpperCase());
    const player = room && room.players.get(m[2]);
    if (!player) {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
        res.end();
        return true;
    }
    const asJson = m[3] === 'json';
    const body = asJson
        ? JSON.stringify({
            color: COLOR_RE.test(player.color || '') ? player.color : '#6366f1',
            face: AVATAR_DATA_URL_RE.test(player.avatar || '') ? player.avatar : null
        })
        : avatarSvg(player);
    const etag = '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"';
    const headers = {
        'Content-Type': asJson ? 'application/json' : 'image/svg+xml',
        // kurz cachen, dann per ETag nachfragen: neue Gesichter kommen nach spätestens 30 s an
        'Cache-Control': 'public, max-age=30, must-revalidate',
        'ETag': etag,
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin'
    };
    if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return true;
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
}

function readJsonBody(req, maxBytes = 16384) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', chunk => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) return resolve({});
            try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
}

function extractBearerToken(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return '';
}

// HTTP Server for Healthchecks & Open Rooms Listing
const server = http.createServer(async (req, res) => {
    try {
        const reqUrl = new URL(req.url, 'http://localhost');
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            res.end();
            return;
        }
        if (serveAvatar(req, res, reqUrl.pathname)) return;
        if (reqUrl.pathname === '/update/status' || reqUrl.pathname === '/party-ws/update/status') {
            const channelId = reqUrl.searchParams.get('channel') || '';
            const force = reqUrl.searchParams.get('force') === '1';
            const data = await checkForUpdate({ channelId, force });
            sendJson(res, 200, data);
            return;
        }
        if (req.method === 'POST' && (reqUrl.pathname === '/update/channel' || reqUrl.pathname === '/party-ws/update/channel')) {
            const body = await readJsonBody(req);
            const auth = verifyHubHostTicket(extractBearerToken(req) || body.ticket, TICKET_SECRET);
            if (!auth.ok) {
                sendJson(res, 403, { error: auth.error });
                return;
            }
            const resChannel = setActiveChannel(body.channel);
            if (resChannel.error) {
                sendJson(res, 400, { error: resChannel.error });
                return;
            }
            const status = await checkForUpdate({ channelId: resChannel.channel.id, force: true });
            sendJson(res, 200, status);
            return;
        }
        if (req.method === 'POST' && (reqUrl.pathname === '/update/apply' || reqUrl.pathname === '/party-ws/update/apply')) {
            const body = await readJsonBody(req);
            const auth = verifyHubHostTicket(extractBearerToken(req) || body.ticket, TICKET_SECRET);
            if (!auth.ok) {
                sendJson(res, 403, { error: auth.error });
                return;
            }
            const out = await triggerWebhookUpdate(body.channel || '');
            sendJson(res, out.status, out.body);
            return;
        }
        if (reqUrl.pathname === '/rooms' || reqUrl.pathname === '/party-ws/rooms' || reqUrl.searchParams.get('rooms') === '1') {
            const now = Date.now();
            const activeRooms = [];
            for (const [code, room] of rooms.entries()) {
                if (room.players.size > 0) {
                    room.updateExpiryTimer(false);
                    const playerList = Array.from(room.players.values()).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
                    const host = playerList.find(p => p.id === room.hostId) || playerList[0];
                    activeRooms.push({
                        code: code,
                        hostName: host ? host.name : 'Host',
                        hostAvatar: host ? host.avatar : '',
                        hostColor: host ? host.color : '#6366f1',
                        playerCount: playerList.length,
                        players: playerList.map(p => ({ name: p.name, avatar: p.avatar, color: p.color })),
                        activeGame: room.activeGame ? room.activeGame.gameId : null,
                        expiresAt: room.expiresAt,
                        remainingMs: room.expiresAt ? Math.max(0, room.expiresAt - now) : null,
                        ttlTotalMs: SOLO_ROOM_TTL_MS
                    });
                }
            }
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ rooms: activeRooms }));
            return;
        }
    } catch (e) {}

    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: "ok",
            rooms: rooms.size,
            uptime: process.uptime()
        }));
        return;
    }
    res.writeHead(404);
    res.end();
});

// WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const roomCode = (url.searchParams.get('room') || 'DEFAULT').toUpperCase();
    // Raumcodes werden in /rooms öffentlich gelistet → nur harmlose Zeichen zulassen
    if (!/^[A-Z0-9_-]{1,32}$/.test(roomCode)) {
        ws.close(1008, 'invalid room code');
        return;
    }
    const room = getOrCreateRoom(roomCode);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (!data || !data.type) return;
            const senderId = room.socketToPlayerId.get(ws);

            switch (data.type) {
                case 'JOIN':
                    if (!room.addPlayer(data.user, ws, data.secret) && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'JOIN_REJECTED', reason: 'id-in-use' }));
                    }
                    break;

                case 'UPDATE_USER':
                    room.updateUser(senderId, data.user);
                    break;

                case 'HEARTBEAT':
                    if (senderId) {
                        const p = room.players.get(senderId);
                        if (p) p.lastSeen = Date.now();
                    }
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'PONG' }));
                    }
                    break;

                case 'READY_STATE_CHANGED':
                    if (senderId) room.setReadyState(senderId, data.isReady);
                    break;

                case 'OPEN_GAME_MODAL': {
                    if (!room.isSenderHost(ws)) {
                        console.warn(`[Room ${room.code}] Non-host tried to open game modal.`);
                        break;
                    }
                    room.activeModalGameId = data.gameId;
                    if (data.lobbyId) {
                        room.activeLobbyId = data.lobbyId;
                    }
                    room.broadcast({
                        type: 'OPEN_GAME_MODAL',
                        gameId: data.gameId,
                        lobbyId: data.lobbyId || null,
                        initiatedBy: data.initiatedBy
                    }, ws);
                    break;
                }

                case 'CLOSE_GAME_MODAL': {
                    if (!room.isSenderHost(ws)) {
                        break;
                    }
                    room.activeModalGameId = null;
                    room.broadcast({ type: 'CLOSE_GAME_MODAL' }, ws);
                    break;
                }

                case 'GAME_SETTINGS_UPDATE': {
                    if (!room.isSenderHost(ws)) {
                        console.warn(`[Room ${room.code}] Non-host tried to update game settings.`);
                        break;
                    }
                    if (!room.gameSettings) room.gameSettings = {};
                    room.gameSettings[data.gameId] = data.settings;
                    room.broadcast({
                        type: 'GAME_SETTINGS_SYNC',
                        gameId: data.gameId,
                        settings: data.settings
                    }, ws);
                    break;
                }

                case 'TRANSFER_HOST': {
                    if (!room.isSenderHost(ws)) {
                        console.warn(`[Room ${room.code}] Non-host tried to transfer host.`);
                        break;
                    }
                    if (data.targetPlayerId) {
                        room.transferHost(data.targetPlayerId);
                    }
                    break;
                }

                case 'VOTE_CAST':
                    if (senderId) room.castVote(senderId, data.gameId);
                    break;

                case 'VOTE_TOGGLE':
                    if (room.canToggleVoting(ws)) {
                        room.toggleVoting(data.isVotingActive);
                    } else if (ws.readyState === WebSocket.OPEN) {
                        // Client hat optimistisch umgeschaltet → echten Stand zurückschicken
                        ws.send(JSON.stringify({ type: 'VOTE_UPDATE', votes: room.votes, isVotingActive: room.isVotingActive, denied: true }));
                    }
                    break;

                case 'HUB_SETTINGS_UPDATE':
                    if (room.isSenderHost(ws)) room.updateHubSettings(data.settings);
                    break;

                case 'LAUNCH_GAME': {
                    if (!room.isSenderHost(ws)) {
                        console.warn(`[Room ${room.code}] Non-host tried to launch game.`);
                        break;
                    }
                    if (!KNOWN_GAME_IDS.includes(data.gameId)) break;
                    const lobbyId = (typeof data.lobbyId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(data.lobbyId)) ? data.lobbyId : null;
                    room.activeGame = { gameId: data.gameId, lobbyId };
                    room.history.push({ gameId: data.gameId, startedAt: Date.now() });
                    if (room.history.length > HISTORY_LIMIT) room.history.splice(0, room.history.length - HISTORY_LIMIT);
                    room.activeModalGameId = null;
                    room.broadcast({
                        type: 'LAUNCH_GAME',
                        gameId: data.gameId,
                        lobbyId
                    });
                    room.broadcastRoster();
                    break;
                }

                case 'EXIT_GAME': {
                    if (room.isSenderHost(ws)) {
                        room.activeModalGameId = null;
                        room.activeGame = null;
                        room.updateExpiryTimer(true);
                        room.broadcast({ type: 'EXIT_GAME' });
                        room.broadcastRoster();
                    }
                    break;
                }

                case 'EXTEND_ROOM_TTL': {
                    room.updateExpiryTimer(true);
                    room.broadcastRoster();
                    break;
                }

                case 'SLOT_MODAL_SYNC': {
                    if (room.isSenderHost(ws)) {
                        room.broadcast({
                            type: 'SLOT_MODAL_SYNC',
                            action: data.action
                        }, ws);
                    }
                    break;
                }

                case 'SLOT_SPIN_START': {
                    if (room.isSenderHost(ws)) {
                        room.broadcast({
                            type: 'SLOT_SPIN_START',
                            winningGameId: data.winningGameId,
                            spinId: data.spinId
                        }, ws);
                    }
                    break;
                }
            }
        } catch (err) {
            console.error('Error handling WebSocket message:', err);
        }
    });

    ws.on('close', () => {
        room.handleDisconnect(ws);
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error in room ${roomCode}:`, err);
        room.handleDisconnect(ws);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 PartyHub WebSocket Server listening on port ${PORT}`);
});
