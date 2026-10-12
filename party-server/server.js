import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '3001', 10);

const SOLO_ROOM_TTL_MS = 60000; // 60 seconds for unused rooms with <= 1 player

class Room {
    constructor(code) {
        this.code = code;
        this.players = new Map(); // id -> player object
        this.sockets = new Map(); // id -> WebSocket
        this.socketToPlayerId = new Map(); // ws -> playerId
        this.votes = { skribbol: 0, uno: 0, codenames: 0, price_guess: 0, monopoly: 0 };
        this.userVotes = new Map(); // playerId -> gameId
        this.isVotingActive = false;
        this.activeModalGameId = null;
        this.activeGame = null;
        this.gameSettings = {};
        this.hostId = null;
        this.creatorId = null;
        this.hostTransferred = false;
        this.disconnectTimers = new Map(); // playerId -> timer
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

    addPlayer(user, ws) {
        if (!user || !user.id) return;

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
            name: user.name || "Gast",
            avatar: user.avatar || "🐶",
            color: user.color || "#6366f1",
            isHost: isHost,
            isReady: user.isReady ?? true,
            status: user.status || "Bereit",
            joinedAt: user.joinedAt || Date.now(),
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
    }

    updateUser(user) {
        if (!user || !user.id) return;
        const player = this.players.get(user.id);
        if (player) {
            if (user.name) player.name = user.name;
            if (user.avatar) player.avatar = user.avatar;
            if (user.color) player.color = user.color;
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
        this.sockets.delete(playerId);

        // Grace period of 15 seconds before removing player (handles app switching on mobile to share room code, page refresh, etc.)
        const timer = setTimeout(() => {
            this.disconnectTimers.delete(playerId);
            const player = this.players.get(playerId);
            if (!player) return;

            console.log(`[Room ${this.code}] Player left: ${player.name} (${playerId})`);
            this.players.delete(playerId);
            this.userVotes.delete(playerId);
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
        const counts = { skribbol: 0, uno: 0, codenames: 0, price_guess: 0, monopoly: 0 };
        for (const gameId of this.userVotes.values()) {
            if (counts[gameId] !== undefined) {
                counts[gameId]++;
            }
        }
        this.votes = counts;
    }

    castVote(playerId, gameId) {
        if (!this.isVotingActive) return;
        const current = this.userVotes.get(playerId);
        if (current === gameId) {
            this.userVotes.delete(playerId);
        } else {
            this.userVotes.set(playerId, gameId);
        }
        this.recalcVotes();
        this.broadcastVotes();
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

    isSenderHost(ws, data) {
        const senderId = this.socketToPlayerId.get(ws) || (data && (data.userId || data.playerId));
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
        this.broadcast({
            type: "ROSTER_SYNC",
            players: playerList,
            hostId: this.hostId,
            isVotingActive: this.isVotingActive,
            votes: this.votes,
            activeModalGameId: this.activeModalGameId,
            activeGame: this.activeGame,
            gameSettings: this.gameSettings,
            expiresAt: this.expiresAt,
            remainingMs: this.expiresAt ? Math.max(0, this.expiresAt - now) : null,
            ttlTotalMs: SOLO_ROOM_TTL_MS
        });
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

// HTTP Server for Healthchecks & Open Rooms Listing
const server = http.createServer((req, res) => {
    try {
        const reqUrl = new URL(req.url, 'http://localhost');
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
                        hostAvatar: host ? host.avatar : '👑',
                        playerCount: playerList.length,
                        players: playerList.map(p => ({ name: p.name, avatar: p.avatar })),
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
    const room = getOrCreateRoom(roomCode);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (!data || !data.type) return;

            switch (data.type) {
                case 'JOIN':
                    room.addPlayer(data.user, ws);
                    break;

                case 'UPDATE_USER':
                    room.updateUser(data.user);
                    break;

                case 'HEARTBEAT':
                    if (data.playerId) {
                        const p = room.players.get(data.playerId);
                        if (p) p.lastSeen = Date.now();
                    }
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'PONG' }));
                    }
                    break;

                case 'READY_STATE_CHANGED':
                    room.setReadyState(data.playerId, data.isReady);
                    break;

                case 'OPEN_GAME_MODAL': {
                    if (!room.isSenderHost(ws, data)) {
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
                    if (!room.isSenderHost(ws, data)) {
                        break;
                    }
                    room.activeModalGameId = null;
                    room.broadcast({ type: 'CLOSE_GAME_MODAL' }, ws);
                    break;
                }

                case 'GAME_SETTINGS_UPDATE': {
                    if (!room.isSenderHost(ws, data)) {
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
                    if (!room.isSenderHost(ws, data)) {
                        console.warn(`[Room ${room.code}] Non-host tried to transfer host.`);
                        break;
                    }
                    if (data.targetPlayerId) {
                        room.transferHost(data.targetPlayerId);
                    }
                    break;
                }

                case 'VOTE_CAST':
                    room.castVote(data.playerId, data.gameId);
                    break;

                case 'VOTE_TOGGLE':
                    room.toggleVoting(data.isVotingActive);
                    break;

                case 'LAUNCH_GAME': {
                    if (!room.isSenderHost(ws, data)) {
                        console.warn(`[Room ${room.code}] Non-host tried to launch game.`);
                        break;
                    }
                    const senderId = room.socketToPlayerId.get(ws) || (data && (data.userId || data.playerId));
                    if (senderId) {
                        room.hostId = senderId;
                    }
                    room.activeGame = {
                        gameId: data.gameId,
                        lobbyId: data.lobbyId || null
                    };
                    room.activeModalGameId = null;
                    room.broadcast({
                        type: 'LAUNCH_GAME',
                        gameId: data.gameId,
                        lobbyId: data.lobbyId || null
                    });
                    room.broadcastRoster();
                    break;
                }

                case 'EXIT_GAME': {
                    if (room.isSenderHost(ws, data)) {
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
                    if (room.isSenderHost(ws, data)) {
                        room.broadcast({
                            type: 'SLOT_MODAL_SYNC',
                            action: data.action
                        }, ws);
                    }
                    break;
                }

                case 'SLOT_SPIN_START': {
                    if (room.isSenderHost(ws, data)) {
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
