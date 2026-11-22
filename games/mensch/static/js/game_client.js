// Client game controller for Mensch ärgere dich nicht
(function(window) {
    'use strict';

    let socket = null;
    let roomId = null;
    let playerId = null;
    let playerName = 'Spieler';
    let gameState = null;
    let isMyTurn = false;
    let isMuted = false;
    let audioCtx = null;
    let pieceElements = {}; // key `${color}_${piece_id}` -> HTMLElement
    let isAnimatingMove = false;
    let toastTimer = null;

    function esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function showToast(msg) {
        const el = document.getElementById('mensch-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
    }

    // Synthetische Web-Audio-Effekte (keine externen Dateien nötig)
    function getAudioCtx() {
        if (isMuted) return null;
        if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    function playTone(freq, dur, type = 'sine', vol = 0.16, delay = 0) {
        const ctx = getAudioCtx();
        if (!ctx) return;
        try {
            const t = ctx.currentTime + delay;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(vol, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + dur + 0.02);
        } catch (_) {}
    }

    const SoundFX = {
        dice: () => { playTone(320, 0.06, 'triangle', 0.12, 0); playTone(460, 0.06, 'triangle', 0.12, 0.07); playTone(580, 0.08, 'triangle', 0.14, 0.14); },
        hop: () => playTone(240 + Math.random() * 40, 0.07, 'triangle', 0.14),
        beat: () => { playTone(220, 0.12, 'sawtooth', 0.16, 0); playTone(120, 0.18, 'sawtooth', 0.14, 0.09); },
        goal: () => { playTone(523, 0.12, 'sine', 0.15, 0); playTone(659, 0.16, 'sine', 0.15, 0.1); },
        win: () => { [523, 659, 784, 1046].forEach((f, i) => playTone(f, 0.22, 'triangle', 0.16, i * 0.11)); }
    };

    function getQueryParam(key) {
        return new URLSearchParams(window.location.search).get(key);
    }

    function initIdentity() {
        try {
            let storedId = sessionStorage.getItem('mensch_player_id');
            if (!storedId) {
                storedId = 'p_' + Math.random().toString(36).substring(2, 9);
                sessionStorage.setItem('mensch_player_id', storedId);
            }
            playerId = storedId;
        } catch (e) {
            playerId = 'p_' + Math.random().toString(36).substring(2, 9);
        }

        const urlName = getQueryParam('name') || getQueryParam('user') || getQueryParam('player');
        if (urlName) {
            playerName = urlName;
        } else {
            const stored = localStorage.getItem('mensch_player_name');
            if (stored) playerName = stored;
        }

        const urlRoom = getQueryParam('room') || getQueryParam('party') || getQueryParam('lobby');
        roomId = urlRoom ? urlRoom.trim().toUpperCase() : null;

        const roomEl = document.getElementById('header-room-code');
        if (roomEl) roomEl.textContent = roomId || 'WAHL';
    }

    function connectWebSocket() {
        if (!roomId) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let basePath = window.location.pathname;
        if (!basePath.endsWith('/')) {
            basePath = basePath.substring(0, basePath.lastIndexOf('/') + 1);
        }
        const wsUrl = `${protocol}//${window.location.host}${basePath}ws/${encodeURIComponent(roomId)}/${encodeURIComponent(playerId)}`;

        socket = new WebSocket(wsUrl);

        socket.onopen = function() {
            sendWsMessage({
                action: 'JOIN',
                name: playerName,
                is_host: (getQueryParam('host') === '1')
            });
        };

        socket.onmessage = function(event) {
            try {
                handleServerMessage(JSON.parse(event.data));
            } catch (err) {
                console.error('WebSocket parse error:', err);
            }
        };

        socket.onclose = function() {
            if (!roomId) return;
            setTimeout(connectWebSocket, 2000);
        };
    }

    function sendWsMessage(msg) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(msg));
        }
    }

    function getPixelForPiecePos(color, pState, pPos, pieceId) {
        if (!gameState) return { x: 0, y: 0 };
        const meta = gameState.color_meta[color];
        if (!meta) return { x: 0, y: 0 };

        if (pState === 'BASE') {
            return {
                x: meta.home_x[pieceId] !== undefined ? meta.home_x[pieceId] : 84,
                y: meta.home_y[pieceId] !== undefined ? meta.home_y[pieceId] : 84
            };
        } else if (pState === 'TRACK') {
            const coord = gameState.track_pixels[pPos];
            return coord ? { x: coord.x, y: coord.y } : { x: 0, y: 0 };
        } else if (pState === 'GOAL') {
            const goals = gameState.goal_pixels[color];
            if (goals && goals[pPos]) return { x: goals[pPos].x, y: goals[pPos].y };
        }
        return { x: 0, y: 0 };
    }

    function showTargetPreview(move) {
        const overlay = document.getElementById('board-overlay');
        if (!overlay || !gameState || !move) return;
        let ring = document.getElementById('target-preview-ring');
        if (!ring) {
            ring = document.createElement('div');
            ring.id = 'target-preview-ring';
            ring.className = 'target-preview-ring';
            overlay.appendChild(ring);
        }
        const color = gameState.current_player ? gameState.current_player.color : 'yellow';
        const pt = getPixelForPiecePos(color, move.to_state, move.to_pos, move.piece_id);
        ring.style.left = `${(pt.x / 1024) * 100}%`;
        ring.style.top = `${(pt.y / 1024) * 100}%`;
        ring.classList.toggle('beat', !!move.beats_piece);
        ring.textContent = move.beats_piece ? '💥' : '';
        ring.style.display = 'flex';
    }

    function hideTargetPreview() {
        const ring = document.getElementById('target-preview-ring');
        if (ring) ring.style.display = 'none';
    }

    async function animateStepByStep(color, pieceId, path, beatenPiece, moveType) {
        const key = `${color}_${pieceId}`;
        const pieceEl = pieceElements[key];
        if (!pieceEl || !path || path.length === 0) return;

        isAnimatingMove = true;
        hideTargetPreview();

        for (let i = 0; i < path.length; i++) {
            const step = path[i];
            const pt = getPixelForPiecePos(color, step.state, step.pos, pieceId);
            pieceEl.classList.add('hopping');
            pieceEl.style.left = `${(pt.x / 1024) * 100}%`;
            pieceEl.style.top = `${(pt.y / 1024) * 100}%`;
            SoundFX.hop();
            await new Promise(r => setTimeout(r, 175));
            pieceEl.classList.remove('hopping');
            await new Promise(r => setTimeout(r, 35));
        }

        if (moveType === 'ENTER_GOAL') SoundFX.goal();

        if (beatenPiece) {
            SoundFX.beat();
            const beatenKey = `${beatenPiece.color}_${beatenPiece.piece_id}`;
            const beatenEl = pieceElements[beatenKey];
            if (beatenEl) {
                const basePt = getPixelForPiecePos(beatenPiece.color, 'BASE', -1, beatenPiece.piece_id);
                beatenEl.classList.add('hopping');
                beatenEl.style.left = `${(basePt.x / 1024) * 100}%`;
                beatenEl.style.top = `${(basePt.y / 1024) * 100}%`;
                await new Promise(r => setTimeout(r, 220));
                beatenEl.classList.remove('hopping');
            }
        }

        isAnimatingMove = false;
    }

    function animateDiceRollUI() {
        const diceFace = document.getElementById('dice-face');
        if (!diceFace) return;
        SoundFX.dice();
        diceFace.classList.remove('rolling');
        void diceFace.offsetWidth;
        diceFace.classList.add('rolling');
    }

    function applyStateAndCheckModals(newState) {
        const prevStatus = gameState ? gameState.status : null;
        gameState = newState;
        renderGame();
        if (prevStatus === 'LOBBY' && gameState.status === 'PLAYING') {
            closeModal('modal-lobby');
        }
        if (gameState.status === 'GAME_OVER') {
            SoundFX.win();
            showGameOverModal();
        }
    }

    function handleServerMessage(msg) {
        if (msg.type === 'ERROR') {
            showToast('⚠️ ' + (msg.message || 'Fehler aufgetreten!'));
            return;
        }
        if (msg.type === 'ROOM_EXPIRED') {
            showToast(msg.message || 'Raum abgelaufen.');
            return;
        }
        if (msg.type === 'DICE_ROLLED') {
            animateDiceRollUI();
        }

        if (msg.type === 'PIECE_MOVED') {
            const move = msg.result && msg.result.move;
            const beaten = msg.result && msg.result.beaten;
            const movingColor = (msg.result && msg.result.player_color) || (gameState && gameState.current_player ? gameState.current_player.color : 'yellow');

            (async () => {
                if (move && move.path && move.path.length > 0) {
                    await animateStepByStep(movingColor, move.piece_id, move.path, beaten, move.type);
                }
                applyStateAndCheckModals(msg.state);
            })();
            return;
        }

        if (msg.type === 'STATE_UPDATE' && msg.bot_action && msg.bot_action.type === 'BOT_MOVED') {
            const botMove = msg.bot_action.move;
            const beaten = msg.bot_action.result && msg.bot_action.result.beaten;
            const movingColor = msg.bot_action.player_color || (gameState && gameState.current_player ? gameState.current_player.color : 'yellow');

            (async () => {
                if (botMove && botMove.path && botMove.path.length > 0) {
                    await animateStepByStep(movingColor, botMove.piece_id, botMove.path, beaten, botMove.type);
                }
                applyStateAndCheckModals(msg.state);
            })();
            return;
        }

        if (msg.state) {
            applyStateAndCheckModals(msg.state);
        }
    }

    function renderGame() {
        if (!gameState) return;

        const curr = gameState.current_player;
        isMyTurn = (curr && curr.id === playerId && gameState.status === 'PLAYING');

        if (gameState.status === 'LOBBY') {
            closeModal('modal-gameover');
            openModal('modal-lobby');
            renderLobbyUI();
            return;
        }

        const turnName = document.getElementById('turn-player-name');
        const turnAvatar = document.getElementById('turn-avatar');
        const turnSub = document.getElementById('turn-subtitle');

        if (curr) {
            const meta = gameState.color_meta[curr.color] || { name: curr.color, hex: '#fff' };
            if (turnName) turnName.textContent = curr.name + (isMyTurn ? ' (Du)' : '');
            if (turnAvatar) {
                turnAvatar.style.background = meta.hex;
                turnAvatar.textContent = curr.is_bot ? '🤖' : '♟️';
            }
            if (turnSub) {
                if (isMyTurn) {
                    if (!gameState.has_rolled) {
                        turnSub.textContent = 'Du bist dran! Bitte würfeln (oder Leertaste).';
                    } else if (gameState.valid_moves && gameState.valid_moves.length > 0) {
                        turnSub.textContent = 'Klicke auf eine deiner blinkenden Spielfiguren!';
                    } else {
                        turnSub.textContent = 'Kein gültiger Zug möglich.';
                    }
                } else {
                    turnSub.textContent = `${curr.name} ist am Zug...`;
                }
            }
        }

        const diceFace = document.getElementById('dice-face');
        const rollBtn = document.getElementById('roll-btn');
        const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        if (diceFace) diceFace.textContent = DICE_FACES[gameState.dice] || '🎲';
        if (rollBtn) {
            rollBtn.disabled = !isMyTurn || (gameState.has_rolled && gameState.valid_moves && gameState.valid_moves.length > 0);
            if (gameState.rolls_left > 1 && !gameState.has_rolled) {
                rollBtn.textContent = `🎲 Würfeln (${gameState.rolls_left}x Versuche)`;
            } else {
                rollBtn.textContent = '🎲 Würfeln';
            }
        }

        if (!isAnimatingMove) {
            renderPiecesOnBoard();
        }

        const playerListEl = document.getElementById('players-list');
        if (playerListEl) {
            const awaySet = new Set(gameState.away_players || []);
            playerListEl.innerHTML = gameState.players.map(p => {
                const meta = gameState.color_meta[p.color] || { name: p.color, hex: '#fff' };
                const inGoal = p.pieces.filter(x => x.state === 'GOAL').length;
                const inBase = p.pieces.filter(x => x.state === 'BASE').length;
                const isCurrent = curr && curr.id === p.id;
                const awayTag = (!p.is_bot && awaySet.has(p.id)) ? ' 💤' : '';
                const rankTag = p.won ? ` 🏆#${p.rank}` : '';
                return `
                    <div class="player-item ${isCurrent ? 'active' : ''}">
                        <div class="player-identity">
                            <div class="player-dot" style="background:${esc(meta.hex)};"></div>
                            <span style="font-weight:700;">${esc(p.name)}${p.id === playerId ? ' (Du)' : ''}${awayTag}${rankTag}</span>
                        </div>
                        <div class="player-stats">
                            <span>🏠 ${inGoal}/4</span> | <span>Haus: ${inBase}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const logsEl = document.getElementById('logs-box');
        if (logsEl && gameState.logs) {
            logsEl.innerHTML = gameState.logs.map(l => `<div class="log-entry">${esc(l)}</div>`).join('');
            logsEl.scrollTop = logsEl.scrollHeight;
        }
    }

    function renderPiecesOnBoard() {
        const overlay = document.getElementById('board-overlay');
        if (!overlay || !gameState) return;

        const validMoveMap = new Map();
        if (isMyTurn && gameState.valid_moves) {
            gameState.valid_moves.forEach(m => validMoveMap.set(m.piece_id, m));
        }

        const activeKeys = new Set();
        gameState.players.forEach(pl => {
            pl.pieces.forEach(p => {
                const key = `${pl.color}_${p.piece_id}`;
                activeKeys.add(key);
                let pieceEl = pieceElements[key];

                if (!pieceEl) {
                    pieceEl = document.createElement('div');
                    pieceEl.className = `piece piece-${pl.color}`;
                    pieceElements[key] = pieceEl;
                    overlay.appendChild(pieceEl);
                }

                const pt = getPixelForPiecePos(pl.color, p.state, (p.state === 'TRACK' ? p.track_pos : p.goal_pos), p.piece_id);
                pieceEl.style.left = `${(pt.x / 1024) * 100}%`;
                pieceEl.style.top = `${(pt.y / 1024) * 100}%`;

                const move = (pl.id === playerId) ? validMoveMap.get(p.piece_id) : null;
                if (move) {
                    pieceEl.classList.add('can-move');
                    pieceEl.title = move.description || '';
                    pieceEl.onmouseenter = () => showTargetPreview(move);
                    pieceEl.onmouseleave = hideTargetPreview;
                    pieceEl.onclick = () => {
                        hideTargetPreview();
                        sendWsMessage({ action: 'MOVE_PIECE', piece_id: p.piece_id });
                    };
                } else {
                    pieceEl.classList.remove('can-move');
                    pieceEl.title = '';
                    pieceEl.onmouseenter = null;
                    pieceEl.onmouseleave = null;
                    pieceEl.onclick = null;
                }
            });
        });

        // Veraltete Figuren-Elemente entfernen (z. B. nach Farbwechsel oder Lobby-Reset)
        Object.keys(pieceElements).forEach(k => {
            if (!activeKeys.has(k)) {
                pieceElements[k].remove();
                delete pieceElements[k];
            }
        });
    }

    function renderLobbyUI() {
        if (!gameState) return;
        const isHost = (gameState.host_id === playerId);
        const listEl = document.getElementById('lobby-player-list');
        if (listEl) {
            listEl.innerHTML = gameState.players.map(p => {
                const meta = gameState.color_meta[p.color] || { name: p.color, hex: '#fff' };
                const removeBtn = (isHost && p.is_bot)
                    ? `<button class="tool-btn" style="padding:2px 8px; font-size:11px; margin-left:8px;" onclick="window.MenschGame.removeBot('${esc(p.id)}')">✕</button>`
                    : '';
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(255,255,255,0.06); border-radius:8px; margin-bottom:6px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:12px; height:12px; border-radius:50%; background:${esc(meta.hex)};"></div>
                            <span style="font-weight:700;">${esc(p.name)} ${p.id === playerId ? '(Du)' : ''}</span>
                        </div>
                        <div style="display:flex; align-items:center;">
                            <span style="font-size:12px; color:#94a3b8;">${p.is_bot ? '🤖 Bot' : (p.id === gameState.host_id ? '👑 Host' : '👤 Gast')}</span>
                            ${removeBtn}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Farbauswahl in der Lobby
        const pickerWrap = document.getElementById('lobby-color-picker');
        const dotsEl = document.getElementById('lobby-color-dots');
        const myPlayer = gameState.players.find(p => p.id === playerId);
        if (pickerWrap && dotsEl && myPlayer) {
            pickerWrap.style.display = 'flex';
            const taken = new Set(gameState.players.filter(p => p.id !== playerId).map(p => p.color));
            dotsEl.innerHTML = Object.entries(gameState.color_meta).map(([cKey, meta]) => {
                const isSel = myPlayer.color === cKey;
                const isTaken = taken.has(cKey);
                return `<button type="button" class="color-dot-btn ${isSel ? 'selected' : ''} ${isTaken ? 'taken' : ''}"
                    style="background:${esc(meta.hex)};" title="${esc(meta.name)}"
                    ${isTaken ? 'disabled' : `onclick="window.MenschGame.setColor('${esc(cKey)}')"`}></button>`;
            }).join('');
        }

        // Regel-Toggle
        const ruleWrap = document.getElementById('lobby-rule-clear-start-wrap');
        const ruleChk = document.getElementById('lobby-rule-clear-start');
        if (ruleWrap && ruleChk && gameState.settings) {
            ruleWrap.style.display = 'flex';
            ruleChk.checked = !!gameState.settings.clear_start;
            ruleChk.disabled = !isHost;
            ruleChk.onchange = () => sendWsMessage({ action: 'SET_SETTINGS', settings: { clear_start: ruleChk.checked } });
        }

        const startBtn = document.getElementById('lobby-start-btn');
        const addBotBtn = document.getElementById('lobby-add-bot-btn');
        if (startBtn) {
            startBtn.style.display = isHost ? 'inline-block' : 'none';
            startBtn.disabled = gameState.players.length < 2;
        }
        if (addBotBtn) {
            addBotBtn.style.display = isHost ? 'inline-block' : 'none';
            addBotBtn.disabled = gameState.players.length >= 4;
            addBotBtn.textContent = gameState.players.length >= 4 ? 'Max. 4 Spieler' : '🤖 + Bot';
        }
    }

    function showGameOverModal() {
        const modal = document.getElementById('modal-gameover');
        const titleEl = document.getElementById('gameover-winner-title');
        const rankEl = document.getElementById('gameover-ranking');
        if (modal && gameState && gameState.winner) {
            if (titleEl) titleEl.textContent = `🎉 ${gameState.winner.name} hat gewonnen!`;
            if (rankEl) {
                const sorted = [...gameState.players].sort((a, b) => (a.rank || 99) - (b.rank || 99));
                rankEl.innerHTML = sorted.map((p, idx) => `
                    <div style="display:flex; justify-content:space-between; padding:6px 10px; background:rgba(255,255,255,0.06); border-radius:8px; margin-bottom:4px;">
                        <span>${idx === 0 ? '🥇' : (idx === 1 ? '🥈' : '🥉')} ${esc(p.name)}</span>
                        <span style="color:#94a3b8;">${p.pieces.filter(x => x.state === 'GOAL').length}/4 im Ziel</span>
                    </div>
                `).join('');
            }
            openModal('modal-gameover');
        }
    }

    function openModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('open');
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('open');
    }

    function sendChat() {
        const inp = document.getElementById('chat-input');
        if (!inp) return;
        const txt = inp.value.trim();
        if (!txt) return;
        sendWsMessage({ action: 'CHAT', message: txt });
        inp.value = '';
    }

    window.MenschGame = {
        init: function() {
            initIdentity();
            if (roomId) {
                connectWebSocket();
            } else {
                openModal('modal-select-room');
                refreshOpenRooms();
            }

            const rollBtn = document.getElementById('roll-btn');
            if (rollBtn) rollBtn.onclick = () => sendWsMessage({ action: 'ROLL_DICE' });

            const startBtn = document.getElementById('lobby-start-btn');
            if (startBtn) startBtn.onclick = () => sendWsMessage({ action: 'START_GAME' });

            const addBotBtn = document.getElementById('lobby-add-bot-btn');
            if (addBotBtn) addBotBtn.onclick = () => sendWsMessage({ action: 'ADD_BOT' });

            const restartBtn = document.getElementById('gameover-restart-btn');
            if (restartBtn) {
                restartBtn.onclick = () => {
                    closeModal('modal-gameover');
                    sendWsMessage({ action: 'RESET_LOBBY' });
                };
            }

            const soundBtn = document.getElementById('sound-toggle-btn');
            if (soundBtn) {
                soundBtn.onclick = () => {
                    isMuted = !isMuted;
                    soundBtn.textContent = isMuted ? '🔇' : '🔊';
                };
            }

            const chatBtn = document.getElementById('chat-send-btn');
            const chatInp = document.getElementById('chat-input');
            if (chatBtn) chatBtn.onclick = sendChat;
            if (chatInp) {
                chatInp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') sendChat();
                });
            }

            // Leertaste: Würfeln oder einzigen gültigen Zug ausführen
            document.addEventListener('keydown', (e) => {
                if (e.code !== 'Space' || e.target.tagName === 'INPUT' || !isMyTurn) return;
                e.preventDefault();
                if (!gameState.has_rolled || (gameState.valid_moves && gameState.valid_moves.length === 0)) {
                    sendWsMessage({ action: 'ROLL_DICE' });
                } else if (gameState.valid_moves && gameState.valid_moves.length === 1) {
                    sendWsMessage({ action: 'MOVE_PIECE', piece_id: gameState.valid_moves[0].piece_id });
                }
            });
        },

        setColor: (color) => sendWsMessage({ action: 'SET_COLOR', color }),
        removeBot: (botId) => sendWsMessage({ action: 'REMOVE_BOT', bot_id: botId }),
        copyRoomLink: () => {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href).then(() => showToast('📋 Raum-Link kopiert!')).catch(() => {});
            }
        },

        createRoom: function() {
            roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
            try { window.history.replaceState({}, '', window.location.pathname + '?room=' + roomId); } catch (_) {}
            const roomEl = document.getElementById('header-room-code');
            if (roomEl) roomEl.textContent = roomId;
            closeModal('modal-select-room');
            openModal('modal-lobby');
            connectWebSocket();
        },

        joinRoom: function(code) {
            if (!code) return;
            roomId = code.trim().toUpperCase();
            try { window.history.replaceState({}, '', window.location.pathname + '?room=' + roomId); } catch (_) {}
            const roomEl = document.getElementById('header-room-code');
            if (roomEl) roomEl.textContent = roomId;
            closeModal('modal-select-room');
            openModal('modal-lobby');
            connectWebSocket();
        }
    };

    function refreshOpenRooms() {
        const listEl = document.getElementById('open-rooms-list');
        if (!listEl) return;
        fetch('api/rooms')
            .then(res => res.json())
            .then(data => {
                const rooms = (data && data.rooms) ? data.rooms : [];
                if (rooms.length === 0) {
                    listEl.innerHTML = '<div style="font-size:12px; color:#94a3b8; text-align:center; padding:12px;">Keine aktiven Räume. Erstelle oben einfach einen neuen!</div>';
                    return;
                }
                listEl.innerHTML = rooms.map(r => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:rgba(255,255,255,0.06); border-radius:8px; margin-bottom:6px;">
                        <div>
                            <strong style="color:#f1c40f;">#${esc(r.room_id)}</strong>
                            <span style="font-size:12px; color:#94a3b8; margin-left:6px;">👥 ${Number(r.player_count)}/4 Spieler</span>
                        </div>
                        <button class="tool-btn" style="padding:4px 10px; font-size:12px;" onclick="window.MenschGame.joinRoom('${esc(r.room_id)}')">
                            Beitreten →
                        </button>
                    </div>
                `).join('');
            })
            .catch(() => {});
    }

})(window);
