// Client game controller for Mensch ärgere dich nicht
(function(window) {
    'use strict';

    let socket = null;
    let roomId = null;
    let playerId = null;
    let playerName = 'Spieler';
    let gameState = null;
    let isMyTurn = false;

    // Helper: URL Params
    function getQueryParam(key) {
        const params = new URLSearchParams(window.location.search);
        return params.get(key);
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
        const wsUrl = `${protocol}//${window.location.host}${basePath}ws/${roomId}/${playerId}`;

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
                const data = JSON.parse(event.data);
                handleServerMessage(data);
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

    let pieceElements = {}; // key `${color}_${piece_id}` -> HTMLElement
    let isAnimatingMove = false;

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
            if (goals && goals[pPos]) {
                return { x: goals[pPos].x, y: goals[pPos].y };
            }
        }
        return { x: 0, y: 0 };
    }

    async function animateStepByStep(color, pieceId, path, beatenPiece) {
        const key = `${color}_${pieceId}`;
        const pieceEl = pieceElements[key];
        if (!pieceEl || !path || path.length === 0) return;

        isAnimatingMove = true;

        for (let i = 0; i < path.length; i++) {
            const step = path[i];
            const pt = getPixelForPiecePos(color, step.state, step.pos, pieceId);
            const leftPct = (pt.x / 1024) * 100;
            const topPct = (pt.y / 1024) * 100;

            pieceEl.classList.add('hopping');
            pieceEl.style.left = `${leftPct}%`;
            pieceEl.style.top = `${topPct}%`;

            // Wait for step hop transition
            await new Promise(r => setTimeout(r, 200));
            pieceEl.classList.remove('hopping');
            await new Promise(r => setTimeout(r, 40));
        }

        // If a piece was beaten, animate it retreating to base
        if (beatenPiece) {
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

    function handleServerMessage(msg) {
        if (msg.type === 'ERROR') {
            alert(msg.message || 'Fehler aufgetreten!');
            return;
        }

        if (msg.type === 'PIECE_MOVED') {
            const move = msg.result && msg.result.move;
            const beaten = msg.result && msg.result.beaten;
            const movingPlayer = gameState ? gameState.players.find(p => p.pieces.some(x => x.piece_id === (move ? move.piece_id : null))) : null;
            const movingColor = (msg.state && msg.state.current_player_idx !== undefined) 
                ? (gameState ? gameState.current_player.color : 'yellow') 
                : 'yellow';

            const runAnimationAndRender = async () => {
                if (move && move.path && move.path.length > 0) {
                    await animateStepByStep(movingColor, move.piece_id, move.path, beaten);
                }
                const prevStatus = gameState ? gameState.status : null;
                gameState = msg.state;
                renderGame();
                if (prevStatus === 'LOBBY' && gameState.status === 'PLAYING') {
                    closeModal('modal-lobby');
                }
                if (gameState.status === 'GAME_OVER') {
                    showGameOverModal();
                }
            };
            runAnimationAndRender();
            return;
        }

        if (msg.type === 'STATE_UPDATE' && msg.bot_action && msg.bot_action.type === 'BOT_MOVED') {
            const botMove = msg.bot_action.move;
            const beaten = msg.bot_action.result && msg.bot_action.result.beaten;
            const movingColor = gameState ? gameState.current_player.color : 'yellow';

            const runBotAnimationAndRender = async () => {
                if (botMove && botMove.path && botMove.path.length > 0) {
                    await animateStepByStep(movingColor, botMove.piece_id, botMove.path, beaten);
                }
                const prevStatus = gameState ? gameState.status : null;
                gameState = msg.state;
                renderGame();
                if (prevStatus === 'LOBBY' && gameState.status === 'PLAYING') {
                    closeModal('modal-lobby');
                }
                if (gameState.status === 'GAME_OVER') {
                    showGameOverModal();
                }
            };
            runBotAnimationAndRender();
            return;
        }

        if (msg.state) {
            const prevStatus = gameState ? gameState.status : null;
            gameState = msg.state;
            renderGame();

            if (prevStatus === 'LOBBY' && gameState.status === 'PLAYING') {
                closeModal('modal-lobby');
            }
            if (gameState.status === 'GAME_OVER') {
                showGameOverModal();
            }
        }
    }

    // Render pieces and board state
    function renderGame() {
        if (!gameState) return;

        const curr = gameState.current_player;
        isMyTurn = (curr && curr.id === playerId && gameState.status === 'PLAYING');

        // Render Lobby or Game
        if (gameState.status === 'LOBBY') {
            openModal('modal-lobby');
            renderLobbyUI();
            return;
        }

        // Turn banner
        const turnBanner = document.getElementById('turn-banner');
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
                        turnSub.textContent = 'Du bist dran! Bitte würfeln.';
                    } else if (gameState.valid_moves && gameState.valid_moves.length > 0) {
                        turnSub.textContent = 'Klicke auf eine deiner blinkenden Spielfiguren!';
                    } else {
                        turnSub.textContent = 'Kein gültiger Zug möglich.';
                    }
                } else {
                    turnSub.textContent = curr.name + ' ist am Zug...';
                }
            }
        }

        // Dice
        const diceFace = document.getElementById('dice-face');
        const rollBtn = document.getElementById('roll-btn');
        const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        if (diceFace) {
            diceFace.textContent = DICE_FACES[gameState.dice] || '🎲';
        }
        if (rollBtn) {
            rollBtn.disabled = !isMyTurn || (gameState.has_rolled && gameState.valid_moves && gameState.valid_moves.length > 0);
            if (gameState.rolls_left > 1 && !gameState.has_rolled) {
                rollBtn.textContent = `🎲 Würfeln (${gameState.rolls_left}x Versuche)`;
            } else {
                rollBtn.textContent = '🎲 Würfeln';
            }
        }

        // Pieces on board
        if (!isAnimatingMove) {
            renderPiecesOnBoard();
        }

        // Player list
        const playerListEl = document.getElementById('players-list');
        if (playerListEl) {
            playerListEl.innerHTML = gameState.players.map(p => {
                const meta = gameState.color_meta[p.color] || { name: p.color, hex: '#fff' };
                const inGoal = p.pieces.filter(x => x.state === 'GOAL').length;
                const inBase = p.pieces.filter(x => x.state === 'BASE').length;
                const isCurrent = curr && curr.id === p.id;
                return `
                    <div class="player-item ${isCurrent ? 'active' : ''}">
                        <div class="player-identity">
                            <div class="player-dot" style="background:${meta.hex};"></div>
                            <span style="font-weight:700;">${p.name} ${p.id === playerId ? '(Du)' : ''}</span>
                        </div>
                        <div class="player-stats">
                            <span>🏠 ${inGoal}/4</span> | <span>Base: ${inBase}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Activity log
        const logsEl = document.getElementById('logs-box');
        if (logsEl && gameState.logs) {
            logsEl.innerHTML = gameState.logs.map(l => `<div class="log-entry">${l}</div>`).join('');
            logsEl.scrollTop = logsEl.scrollHeight;
        }
    }

    function renderPiecesOnBoard() {
        const overlay = document.getElementById('board-overlay');
        if (!overlay || !gameState) return;

        const validPieceIds = (isMyTurn && gameState.valid_moves) ? new Set(gameState.valid_moves.map(m => m.piece_id)) : new Set();

        gameState.players.forEach(pl => {
            pl.pieces.forEach(p => {
                const key = `${pl.color}_${p.piece_id}`;
                let pieceEl = pieceElements[key];

                if (!pieceEl) {
                    pieceEl = document.createElement('div');
                    pieceEl.className = `piece piece-${pl.color}`;
                    pieceElements[key] = pieceEl;
                    overlay.appendChild(pieceEl);
                }

                const pt = getPixelForPiecePos(pl.color, p.state, (p.state === 'TRACK' ? p.track_pos : p.goal_pos), p.piece_id);
                const leftPct = (pt.x / 1024) * 100;
                const topPct = (pt.y / 1024) * 100;

                pieceEl.style.left = `${leftPct}%`;
                pieceEl.style.top = `${topPct}%`;

                const canMoveThis = isMyTurn && pl.id === playerId && validPieceIds.has(p.piece_id);
                if (canMoveThis) {
                    pieceEl.classList.add('can-move');
                    pieceEl.onclick = () => {
                        sendWsMessage({ action: 'MOVE_PIECE', piece_id: p.piece_id });
                    };
                } else {
                    pieceEl.classList.remove('can-move');
                    pieceEl.onclick = null;
                }
            });
        });
    }

    function renderLobbyUI() {
        if (!gameState) return;
        const listEl = document.getElementById('lobby-player-list');
        if (listEl) {
            listEl.innerHTML = gameState.players.map(p => {
                const meta = gameState.color_meta[p.color] || { name: p.color, hex: '#fff' };
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(255,255,255,0.06); border-radius:8px; margin-bottom:6px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:12px; height:12px; border-radius:50%; background:${meta.hex};"></div>
                            <strong>${p.name} ${p.id === playerId ? '(Du)' : ''}</strong>
                            <span style="font-size:12px; color:#94a3b8;">(${meta.name})</span>
                        </div>
                        <div>
                            ${p.id === gameState.host_id ? '<span style="font-size:10px; background:#f39c12; color:#000; padding:2px 6px; border-radius:4px; font-weight:800;">HOST</span>' : ''}
                            ${p.is_bot ? '<span style="font-size:10px; background:#7f8c8d; color:#fff; padding:2px 6px; border-radius:4px; font-weight:800;">BOT</span>' : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        const isHost = (gameState.host_id === playerId);
        const startBtn = document.getElementById('lobby-start-btn');
        const addBotBtn = document.getElementById('lobby-add-bot-btn');

        if (startBtn) {
            startBtn.style.display = isHost ? 'inline-block' : 'none';
            startBtn.disabled = gameState.players.length < 2;
        }
        if (addBotBtn) {
            addBotBtn.style.display = isHost ? 'inline-block' : 'none';
            addBotBtn.disabled = gameState.players.length >= 4;
            addBotBtn.textContent = gameState.players.length >= 4 ? 'Max. 4 Spieler erreicht' : '+ Bot hinzufügen';
        }
    }

    function showGameOverModal() {
        const modal = document.getElementById('modal-gameover');
        const titleEl = document.getElementById('gameover-winner-title');
        if (modal && gameState && gameState.winner) {
            if (titleEl) {
                titleEl.textContent = `🎉 ${gameState.winner.name} hat gewonnen!`;
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
            if (rollBtn) {
                rollBtn.onclick = () => {
                    sendWsMessage({ action: 'ROLL_DICE' });
                };
            }

            const startBtn = document.getElementById('lobby-start-btn');
            if (startBtn) {
                startBtn.onclick = () => {
                    sendWsMessage({ action: 'START_GAME' });
                };
            }

            const addBotBtn = document.getElementById('lobby-add-bot-btn');
            if (addBotBtn) {
                addBotBtn.onclick = () => {
                    sendWsMessage({ action: 'ADD_BOT' });
                };
            }

            const restartBtn = document.getElementById('gameover-restart-btn');
            if (restartBtn) {
                restartBtn.onclick = () => {
                    closeModal('modal-gameover');
                    sendWsMessage({ action: 'RESET_LOBBY' });
                };
            }
        },

        createRoom: function() {
            const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            roomId = newCode;
            try {
                const newUrl = window.location.pathname + '?room=' + roomId;
                window.history.replaceState({}, '', newUrl);
            } catch(e) {}
            closeModal('modal-select-room');
            openModal('modal-lobby');
            connectWebSocket();
        },

        joinRoom: function(code) {
            if (!code) return;
            roomId = code.trim().toUpperCase();
            try {
                const newUrl = window.location.pathname + '?room=' + roomId;
                window.history.replaceState({}, '', newUrl);
            } catch(e) {}
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
                            <strong style="color:#f1c40f;">#${r.room_id}</strong>
                            <span style="font-size:12px; color:#94a3b8; margin-left:6px;">👥 ${r.player_count}/4 Spieler</span>
                        </div>
                        <button class="tool-btn" style="padding:4px 10px; font-size:12px;" onclick="window.MenschGame.joinRoom('${r.room_id}')">
                            Beitreten →
                        </button>
                    </div>
                `).join('');
            })
            .catch(() => {});
    }

})(window);
