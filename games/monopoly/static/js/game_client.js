/**
 * Monopoly 3D Web Edition - Client Controller & WebSocket Protocol
 * Handles lobby, gameplay events, responsive UI interaction, and 3D board synchronization.
 */

(function(window) {
    'use strict';

    // Global client state
    let socket = null;
    let roomId = null;
    let playerId = null;
    let playerName = 'Spieler';
    let selectedToken = 'dog';
    let selectedColor = '#e74c3c';
    let isHost = false;
    let gameState = null;
    let squaresData = [];
    let viewedPlayerId = null;
    let isTokenInTransit = false;

    // Sound and Board instances
    const Sound = window.MonopolySound;
    const Board3D = window.MonopolyBoard3D;

    function resolveUrl(path) {
        if (window.MonopolyAssets && window.MonopolyAssets.resolveUrl) {
            return window.MonopolyAssets.resolveUrl(path);
        }
        let p = window.location.pathname;
        if (!p.endsWith('/')) p = p.substring(0, p.lastIndexOf('/') + 1);
        return p + (path.startsWith('/') ? path.substring(1) : path);
    }

    // Tokens metadata
    const TOKENS = (window.MonopolyAssets && window.MonopolyAssets.tokens) ? window.MonopolyAssets.tokens : [
        { id: 'dog', name: 'Hund', icon: '🐕', iconImg: 'static/assets/tokens/hund_icon.png' },
        { id: 'hat', name: 'Zylinder', icon: '🎩', iconImg: 'static/assets/tokens/zylinder_icon.png' },
        { id: 'car', name: 'Rennwagen', icon: '🏎️', iconImg: 'static/assets/tokens/rennwagen_icon.png' },
        { id: 'ship', name: 'Schiff', icon: '🚢', iconImg: 'static/assets/tokens/schlachtschiff_icon.png' },
        { id: 'boot', name: 'Stiefel', icon: '👢', iconImg: 'static/assets/tokens/schuh_icon.png' },
        { id: 'iron', name: 'Bügeleisen', icon: '🪙', iconImg: 'static/assets/tokens/buegeleisen_icon.png' },
        { id: 'thimble', name: 'Fingerhut', icon: '🧵', iconImg: 'static/assets/tokens/fingerhut_icon.png' },
        { id: 'wheelbarrow', name: 'Schubkarre', icon: '🛒', iconImg: 'static/assets/tokens/schubkarre_icon.png' }
    ];

    const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#e67e22', '#9b59b6', '#1abc9c', '#fd79a8'];

    // Group color mappings
    const GROUP_COLORS = {
        brown: '#8B4513',
        lightblue: '#87CEEB',
        pink: '#FF69B4',
        orange: '#FFA500',
        red: '#ED1B24',
        yellow: '#FFF200',
        green: '#1FB25A',
        darkblue: '#0072BB',
        station: '#2c3e50',
        utility: '#f39c12'
    };

    // Authentic Property Deed ROM Images (Extracted directly from Monopoly 2012 ROM)
    const DEED_CARD_IMAGES = {
        1: 'static/assets/cards/01_braun_badstrasse.png',
        3: 'static/assets/cards/02_braun_turmstrasse.png',
        5: 'static/assets/cards/03_bahnhof_suedbahnhof.png',
        6: 'static/assets/cards/04_hellblau_chausseestrasse.png',
        8: 'static/assets/cards/05_hellblau_elisenstrasse.png',
        9: 'static/assets/cards/06_hellblau_poststrasse.png',
        11: 'static/assets/cards/07_pink_seestrasse.png',
        12: 'static/assets/cards/08_werk_elektrizitaetswerk.png',
        13: 'static/assets/cards/09_pink_hafenstrasse.png',
        14: 'static/assets/cards/10_pink_neuestrasse.png',
        15: 'static/assets/cards/11_bahnhof_westbahnhof.png',
        16: 'static/assets/cards/12_orange_muenchenerstrasse.png',
        18: 'static/assets/cards/13_orange_wienerstrasse.png',
        19: 'static/assets/cards/14_orange_berlinerstrasse.png',
        21: 'static/assets/cards/15_rot_theaterstrasse.png',
        23: 'static/assets/cards/16_rot_museumstrasse.png',
        24: 'static/assets/cards/17_rot_opernplatz.png',
        25: 'static/assets/cards/18_bahnhof_nordbahnhof.png',
        26: 'static/assets/cards/19_gelb_lessingstrasse.png',
        27: 'static/assets/cards/20_gelb_schillerstrasse.png',
        28: 'static/assets/cards/21_werk_wasserwerk.png',
        29: 'static/assets/cards/22_gelb_goethestrasse.png',
        31: 'static/assets/cards/23_gruen_rathausplatz.png',
        32: 'static/assets/cards/24_gruen_hauptstrasse.png',
        34: 'static/assets/cards/25_gruen_bahnhofstrasse.png',
        35: 'static/assets/cards/26_bahnhof_hauptbahnhof.png',
        37: 'static/assets/cards/27_dunkelblau_parkstrasse.png',
        39: 'static/assets/cards/28_dunkelblau_schlossallee.png'
    };

    // Helper: Select authentic Uncle Pennybags ROM illustration matching card text
    function getCardIllustration(text) {
        const lower = (text || '').toLowerCase();
        if (lower.includes('gehe in das gefängnis') || (lower.includes('gefängnis') && !lower.includes('frei'))) {
            return 'static/assets/chance_chest/illustration_gefaengnis.png';
        }
        if (lower.includes('gefängnisfrei') || lower.includes('gefängnis frei')) {
            return 'static/assets/chance_chest/illustration_gefaengnisausbruch.png';
        }
        if (lower.includes('zahlen') || lower.includes('strafe') || lower.includes('steuer') || lower.includes('gebühr')) {
            return 'static/assets/chance_chest/illustration_zahlen.png';
        }
        if (lower.includes('erbe') || lower.includes('erhältst') || lower.includes('dividende') || lower.includes('bank') || lower.includes('geburtstag') || lower.includes('gewinn')) {
            return 'static/assets/chance_chest/illustration_geschenk.png';
        }
        if (lower.includes('haus') || lower.includes('häuser') || lower.includes('hotel') || lower.includes('renovierung') || lower.includes('reparatur')) {
            return 'static/assets/chance_chest/illustration_renovierung_bau.png';
        }
        if (lower.includes('rücke vor') || lower.includes('gehe zu') || lower.includes('bahnhof') || lower.includes('los')) {
            return 'static/assets/chance_chest/illustration_rennen.png';
        }
        return 'static/assets/chance_chest/illustration_monopoly_mann.png';
    }

    // Helper: URL Params
    function getQueryParam(key) {
        const params = new URLSearchParams(window.location.search);
        return params.get(key);
    }

    // Helper: Local Storage & URL params for seamless Game Hub Party embedding
    function initPlayerIdentity() {
        try {
            let storedId = sessionStorage.getItem('monopoly_player_id');
            if (!storedId) {
                storedId = 'p_' + Math.random().toString(36).substring(2, 9);
                sessionStorage.setItem('monopoly_player_id', storedId);
            }
            playerId = storedId;
        } catch (e) {
            playerId = 'p_' + Math.random().toString(36).substring(2, 9);
        }

        try {
            const urlName = getQueryParam('name') || getQueryParam('user') || getQueryParam('player');
            if (urlName) {
                playerName = urlName;
                localStorage.setItem('monopoly_player_name', urlName);
            } else {
                const storedName = localStorage.getItem('monopoly_player_name');
                if (storedName) playerName = storedName;
            }

            const urlToken = getQueryParam('token');
            if (urlToken && TOKENS.some(t => t.id === urlToken)) {
                selectedToken = urlToken;
            } else {
                const storedToken = localStorage.getItem('monopoly_player_token');
                if (storedToken) selectedToken = storedToken;
            }

            const urlColor = getQueryParam('color');
            if (urlColor) {
                selectedColor = urlColor.startsWith('#') ? urlColor : '#' + urlColor;
            } else {
                const storedColor = localStorage.getItem('monopoly_player_color');
                if (storedColor) selectedColor = storedColor;
            }
        } catch (e) {
            console.warn('Storage warning:', e);
        }

        // Room ID from URL query ?room=XYZ or ?lobby=XYZ or ?party=XYZ or generate
        roomId = window.__INITIAL_ROOM_ID__ || getQueryParam('room') || getQueryParam('lobby') || getQueryParam('party') || getQueryParam('roomId');
        if (!roomId) {
            roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
            try {
                const newUrl = window.location.pathname + '?room=' + roomId;
                window.history.replaceState({ path: newUrl }, '', newUrl);
            } catch (e) {}
        }
        roomId = roomId.toUpperCase();
        window.__INITIAL_ROOM_ID__ = roomId;

        // Update UI room code IMMEDIATELY on load so it NEVER shows '------'
        const headerRoomCode = document.getElementById('header-room-code');
        if (headerRoomCode) headerRoomCode.textContent = roomId;
        const lobbyRoomCode = document.getElementById('lobby-room-code');
        if (lobbyRoomCode) lobbyRoomCode.textContent = roomId;

        // Notify parent hub window if embedded in iframe
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'MONOPOLY_READY', roomId: roomId, playerId: playerId }, '*');
            }
        } catch (e) {}
    }

    // Connect WebSocket
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let basePath = window.location.pathname;
        if (!basePath.endsWith('/')) {
            basePath = basePath.substring(0, basePath.lastIndexOf('/') + 1);
        }
        const wsUrl = `${protocol}//${window.location.host}${basePath}ws/${roomId}/${playerId}`;

        socket = new WebSocket(wsUrl);

        socket.onopen = function() {
            console.log('WebSocket connected to room', roomId);
            // Join message
            sendWsMessage({
                action: 'JOIN',
                name: playerName,
                token: selectedToken,
                color: selectedColor
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
            console.log('WebSocket disconnected, reconnecting in 2s...');
            setTimeout(connectWebSocket, 2000);
        };
    }

    function sendWsMessage(msg) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(msg));
        }
    }

    // Message Dispatcher
    function handleServerMessage(msg) {
        console.log('Server message:', msg.type, msg);

        if (msg.state) {
            const prevState = gameState;
            gameState = msg.state;
            if (msg.state.squares) squaresData = msg.state.squares;

            updateLobbyUI();
            updateHUD();

            // Sync 3D Board
            if (window.MonopolyBoard3D) {
                window.MonopolyBoard3D.syncPlayers(gameState.players);
                window.MonopolyBoard3D.syncBuildings(gameState.board_state);
                window.MonopolyBoard3D.syncTableDeeds(gameState.board_state, gameState.players, playerId);
                if (!isTokenInTransit) {
                    if (gameState.last_card && window.MonopolyBoard3D.showDrawnCard) {
                        const lCardImg = gameState.last_card.image || (gameState.last_card.card && (gameState.last_card.card.image || gameState.last_card.card.card_image_filename));
                        window.MonopolyBoard3D.showDrawnCard(gameState.last_card.deck, (gameState.last_card.card && gameState.last_card.card.text) || '', lCardImg);
                    } else if (window.MonopolyBoard3D && window.MonopolyBoard3D.hideDrawnCards) {
                        window.MonopolyBoard3D.hideDrawnCards();
                    }
                }
            }

            // Detect Game Start
            if (prevState && prevState.status === 'LOBBY' && gameState.status === 'PLAYING') {
                closeModal('modal-lobby');
                if (Sound) Sound.playMoney();
            }

            // Hub embedding notification
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'MONOPOLY_UPDATE', state: gameState, event: msg.type }, '*');
            }
        }

        switch (msg.type) {
            case 'GAME_STARTED':
                closeModal('modal-lobby');
                if (Sound) Sound.playMoney();
                break;

            case 'DICE_ROLLED':
                handleDiceRollEvent(msg.result);
                break;

            case 'TURN_ENDED':
                if (window.MonopolyBoard3D && window.MonopolyBoard3D.hideDrawnCards) {
                    window.MonopolyBoard3D.hideDrawnCards();
                }
                break;

            case 'PROPERTY_BOUGHT':
                if (Sound) Sound.playMoney();
                closeModal('modal-deed');
                break;

            case 'AUCTION_UPDATED':
                closeModal('modal-deed');
                if (gameState && gameState.auction_state) {
                    showAuctionModal();
                } else {
                    closeModal('modal-auction');
                    if (Sound) Sound.playMoney();
                }
                break;

            case 'TAX_PAID':
                if (Sound) Sound.playMoney();
                closeModal('modal-tax');
                break;

            case 'HOUSE_BUILT':
                if (Sound) Sound.playBuild();
                break;

            case 'HOUSE_SOLD':
                if (Sound) Sound.playMoney();
                break;

            case 'BAIL_PAID':
                if (Sound) Sound.playMoney();
                break;

            case 'WENT_TO_JAIL':
                if (Sound) Sound.playJail();
                break;

            case 'CARD':
                if (!isTokenInTransit && msg.card) {
                    const dDeck = msg.deck || 'Ereignis';
                    const dText = msg.card.text;
                    const dImg = msg.card.image || msg.card.card_image_filename;
                    const engine = window.MonopolyBoard3D || Board3D;
                    if (engine && engine.showDrawnCard) {
                        engine.showDrawnCard(dDeck, dText, dImg);
                    }
                    const isMyTurn = (gameState && gameState.current_player && gameState.current_player.id === playerId);
                    if (isMyTurn) {
                        showCardModal(dDeck, dText, dImg, true);
                    }
                }
                break;

            case 'TRADE_PROPOSED':
                if (msg.state && msg.state.pending_trade) {
                    const trade = msg.state.pending_trade;
                    if (trade.target_id === playerId) {
                        showIncomingTradeModal(trade);
                    }
                }
                break;

            case 'TRADE_ACCEPTED':
                if (Sound) Sound.playMoney();
                closeModal('modal-incoming-trade');
                break;

            case 'TRADE_REJECTED':
                closeModal('modal-incoming-trade');
                break;
        }

        // Sync active Auction or Tax modal state
        if (gameState && gameState.auction_state) {
            showAuctionModal();
        } else {
            closeModal('modal-auction');
        }

        if (!isTokenInTransit && gameState && gameState.pending_action && gameState.pending_action.type === 'TAX_CHOICE') {
            const isMyTurn = (gameState.current_player && gameState.current_player.id === playerId);
            if (isMyTurn) {
                showTaxChoiceModal(gameState.pending_action);
            }
        } else {
            closeModal('modal-tax');
        }

        // Check if pending action is a drawn card
        if (!isTokenInTransit && gameState && gameState.pending_action && gameState.pending_action.type === 'CARD') {
            const cAct = gameState.pending_action;
            const cImg = cAct.card ? (cAct.card.image || cAct.card.card_image_filename) : null;
            const engine = window.MonopolyBoard3D || Board3D;
            if (engine && engine.showDrawnCard) {
                engine.showDrawnCard(cAct.deck, (cAct.card && cAct.card.text) || '', cImg);
            }
        }
    }

    // Dice Roll & Animated Token Hop sequence
    function handleDiceRollEvent(res) {
        if (!res || !res.dice) return;
        const [d1, d2] = res.dice;
        const isMyTurn = (res.player && res.player.id === playerId);
        isTokenInTransit = true;

        if (Board3D) {
            Board3D.rollDice(d1, d2, () => {
                if (res.old_pos !== undefined && res.new_pos !== undefined) {
                    Board3D.animateMoveToken(res.player.id, res.old_pos, res.new_pos, () => {
                        isTokenInTransit = false;
                        if (Sound && res.passed_go) {
                            Sound.playPassGo ? Sound.playPassGo() : Sound.playMoney();
                        }
                        if (res.action) {
                            if (res.action.type === 'CARD') {
                                const dDeck = res.action.deck || 'Ereignis';
                                const dText = (res.action.card && res.action.card.text) ? res.action.card.text : 'Karte';
                                const dImg = res.action.card ? (res.action.card.image || res.action.card.card_image_filename) : null;
                                const engine = window.MonopolyBoard3D || Board3D;
                                if (engine && engine.showDrawnCard) {
                                    engine.showDrawnCard(dDeck, dText, dImg);
                                }
                                if (isMyTurn) {
                                    showCardModal(dDeck, dText, dImg, true);
                                }
                            } else if (res.action.type === 'BUY_OR_AUCTION') {
                                if (isMyTurn && res.action.square) {
                                    showDeedModal(res.action.square.index);
                                }
                            } else if (res.action.type === 'TAX_CHOICE') {
                                if (isMyTurn) {
                                    showTaxChoiceModal(res.action);
                                }
                            }
                        } else if (!gameState || !gameState.last_card) {
                            if (window.MonopolyBoard3D && window.MonopolyBoard3D.hideDrawnCards) {
                                window.MonopolyBoard3D.hideDrawnCards();
                            }
                        }
                    }, true);
                } else {
                    isTokenInTransit = false;
                }
            }, true);
        } else {
            isTokenInTransit = false;
        }
    }

    // UI Updates: Lobby
    function updateLobbyUI() {
        if (!gameState) return;

        // Check status
        if (gameState.status === 'LOBBY') {
            openModal('modal-lobby');
        } else {
            closeModal('modal-lobby');
        }

        // Room Code
        const roomCodeEl = document.getElementById('lobby-room-code');
        if (roomCodeEl) roomCodeEl.textContent = gameState.room_id;

        const headerRoomCode = document.getElementById('header-room-code');
        if (headerRoomCode) headerRoomCode.textContent = gameState.room_id;

        // Is host
        isHost = (gameState.host_id === playerId);
        const startBtn = document.getElementById('btn-start-game');
        if (startBtn) {
            startBtn.style.display = isHost ? 'inline-block' : 'none';
            startBtn.disabled = (gameState.players.length < 2);
        }

        const addBotBtn = document.getElementById('btn-add-bot');
        if (addBotBtn) {
            addBotBtn.style.display = isHost ? 'inline-block' : 'none';
        }

        // Players list in lobby
        const listEl = document.getElementById('lobby-players-list');
        if (listEl) {
            listEl.innerHTML = gameState.players.map(p => {
                const tObj = TOKENS.find(t => t.id === p.token) || { icon: '♟️', name: p.token };
                const tokenGraphic = tObj.iconImg ? `<img src="${resolveUrl(tObj.iconImg)}" class="token-mini-img" alt="${tObj.name}" />` : tObj.icon;
                return `
                    <div class="lobby-player-row">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div class="player-dot" style="background:${p.color};"></div>
                            <span style="font-weight:700;">${p.name} ${p.id === playerId ? '(Du)' : ''}</span>
                            <span style="font-size:12px; color:var(--text-muted); display:inline-flex; align-items:center; gap:4px;">${tokenGraphic} ${tObj.name}</span>
                        </div>
                        <div>
                            ${p.id === gameState.host_id ? '<span style="font-size:10px; background:#f39c12; color:#000; padding:2px 6px; border-radius:4px; font-weight:700;">HOST</span>' : ''}
                            ${p.is_bot ? '<span style="font-size:10px; background:#7f8c8d; color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">BOT</span>' : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // UI Updates: HUD (Players, Controls, Action Bar)
    function updateHUD() {
        if (!gameState) return;

        const currPlayer = gameState.current_player;
        const isMyTurn = (currPlayer && currPlayer.id === playerId && gameState.status === 'PLAYING');

        // Turn Banner
        const turnBanner = document.getElementById('turn-banner');
        const turnDot = document.getElementById('turn-color-dot');
        const turnText = document.getElementById('turn-text');

        if (turnBanner && currPlayer) {
            turnDot.style.background = currPlayer.color;
            if (isMyTurn) {
                turnBanner.classList.add('my-turn');
                turnText.textContent = 'Du bist am Zug!';
            } else {
                turnBanner.classList.remove('my-turn');
                turnText.textContent = `${currPlayer.name} ist am Zug`;
            }
        }

        // Top Center 2012 Console Player Ribbon (4 Player Pods)
        const topHudEl = document.getElementById('top-player-hud');
        if (topHudEl && gameState.players) {
            topHudEl.innerHTML = gameState.players.map(p => {
                const isActive = (currPlayer && currPlayer.id === p.id);
                const isMe = (p.id === playerId);
                const tObj = TOKENS.find(t => t.id === p.token) || { icon: '♟️', name: p.token };
                const tokenGraphic = tObj.iconImg ? `<img src="${resolveUrl(tObj.iconImg)}" class="hud-pod-token-img" alt="${tObj.name}" />` : `<span class="hud-pod-token">${tObj.icon}</span>`;
                return `
                    <div class="hud-player-pod ${isActive ? 'active-turn' : ''} ${isMe ? 'is-me' : ''} ${p.is_bankrupt ? 'bankrupt' : ''}" 
                         onclick="window.MonopolyGame.focusPlayerSeat('${p.id}')"
                         title="${p.name}: Klicke für Tisch-Karten Nahansicht">
                        <div class="hud-pod-avatar" style="border-color:${p.color};">
                            ${tokenGraphic}
                            ${p.in_jail ? '<span class="hud-jail-tag">⛓️</span>' : ''}
                        </div>
                        <div class="hud-pod-details">
                            <div class="hud-pod-name">${p.name} ${isMe ? '(Du)' : ''}</div>
                            <div class="hud-pod-money">${p.money} DM</div>
                        </div>
                        <button class="hud-pod-inspect-btn" onclick="event.stopPropagation(); window.MonopolyGame.showPlayerPortfolio('${p.id}');" title="Besitzliste öffnen">📋</button>
                    </div>
                `;
            }).join('');
        }

        // Desktop Players Sidebar (if present)
        const playersListEl = document.getElementById('players-panel-list');
        if (playersListEl) {
            playersListEl.innerHTML = gameState.players.map(p => {
                const isActive = (currPlayer && currPlayer.id === p.id);
                const isMe = (p.id === playerId);
                const tObj = TOKENS.find(t => t.id === p.token) || { icon: '♟️', name: p.token };
                const sqName = squaresData[p.position] ? squaresData[p.position].name : 'LOS';
                const tokenGraphic = tObj.iconImg ? `<img src="${resolveUrl(tObj.iconImg)}" class="sidebar-token-img" alt="${tObj.name}" />` : `<span class="player-token-label">${tObj.icon}</span>`;

                return `
                    <div class="player-card ${isActive ? 'active' : ''} ${isMe ? 'is-me' : ''} ${p.is_bankrupt ? 'bankrupt' : ''}" onclick="window.MonopolyGame.showPlayerPortfolio('${p.id}')">
                        <div class="player-header">
                            <div class="player-identity">
                                <div class="player-dot" style="background:${p.color};"></div>
                                <span class="player-name">${p.name} ${isMe ? '(Du)' : ''}</span>
                            </div>
                            ${tokenGraphic}
                        </div>
                        <div class="player-cash">
                            <span>💵</span> ${p.money} DM
                        </div>
                        <div class="player-subinfo">
                            <span>Auf: ${sqName}</span>
                            <div>
                                ${p.in_jail ? '<span class="player-status-tag tag-jail">Gefängnis</span>' : ''}
                                ${p.is_bot ? '<span class="player-status-tag tag-bot">BOT</span>' : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Mobile Players Top Strip (if present)
        const mobileStripEl = document.getElementById('mobile-player-strip');
        if (mobileStripEl) {
            mobileStripEl.innerHTML = gameState.players.map(p => {
                const isActive = (currPlayer && currPlayer.id === p.id);
                const isMe = (p.id === playerId);
                return `
                    <div class="mobile-player-chip ${isActive ? 'active' : ''}" onclick="window.MonopolyGame.showPlayerPortfolio('${p.id}')">
                        <div class="player-dot" style="background:${p.color}; width:10px; height:10px;"></div>
                        <span>${p.name}${isMe ? '*' : ''}</span>
                        <span style="color:var(--accent-gold); font-weight:700;">${p.money} DM</span>
                    </div>
                `;
            }).join('');
        }

        // Update Player Wallet Cash in Cockpit Dock
        const myPlayer = gameState.players.find(p => p.id === playerId);
        const dockMoneyEl = document.getElementById('dock-money');
        const dockDeltaEl = document.getElementById('dock-money-delta');
        if (dockMoneyEl && myPlayer) {
            const prevMoneyStr = dockMoneyEl.getAttribute('data-prev-money');
            const prevMoney = (prevMoneyStr !== null) ? parseInt(prevMoneyStr) : myPlayer.money;
            const diff = myPlayer.money - prevMoney;
            dockMoneyEl.textContent = `${myPlayer.money.toLocaleString('de-DE')} DM`;
            dockMoneyEl.setAttribute('data-prev-money', myPlayer.money);

            if (diff !== 0 && dockDeltaEl) {
                dockDeltaEl.textContent = (diff > 0 ? `+${diff}` : `${diff}`) + ' DM';
                dockDeltaEl.className = 'cockpit-wallet-delta ' + (diff > 0 ? 'delta-plus' : 'delta-minus');
                setTimeout(() => {
                    if (dockDeltaEl) dockDeltaEl.className = 'cockpit-wallet-delta';
                }, 2200);
            }
        }

        // Update Physical Tabletop Card Rack (Tisch-Ablage)
        const tableCardsScroll = document.getElementById('table-cards-scroll');
        const tableRackCount = document.getElementById('table-rack-count');
        const tableRackTitle = document.getElementById('table-rack-title');

        const activeViewId = viewedPlayerId || playerId;
        const targetViewPlayer = gameState.players.find(p => p.id === activeViewId);
        const isViewingMe = (activeViewId === playerId);

        if (tableRackTitle) {
            if (isViewingMe) {
                tableRackTitle.innerHTML = `🗂️ Tisch-Ablage (Deine Straßen)`;
            } else {
                tableRackTitle.innerHTML = `🗂️ Tisch-Ablage (${targetViewPlayer ? targetViewPlayer.name : 'Mitspieler'}) <button onclick="window.MonopolyGame.viewMyTableCards()" style="margin-left:8px; font-size:10px; padding:2px 8px; background:var(--primary); color:#fff; border:none; border-radius:4px; cursor:pointer;">Zurück zu mir</button>`;
            }
        }

        if (tableCardsScroll && gameState && squaresData) {
            const ownedList = [];
            for (const [sqIdxStr, st] of Object.entries(gameState.board_state)) {
                if (st.owner === activeViewId) {
                    const sqIdx = parseInt(sqIdxStr);
                    const sq = squaresData[sqIdx];
                    if (sq) ownedList.push({ idx: sqIdx, state: st, sq: sq });
                }
            }

            if (tableRackCount) {
                tableRackCount.textContent = `${ownedList.length} Grundstücke`;
            }

            if (ownedList.length === 0) {
                tableCardsScroll.innerHTML = `<div class="table-empty-hint">${isViewingMe ? 'Noch keine Straßen im Besitz. Ziehe über das Spielfeld, um Straßen zu erwerben!' : 'Dieser Spieler besitzt noch keine Straßen.'}</div>`;
            } else {
                ownedList.sort((a, b) => a.idx - b.idx);
                tableCardsScroll.innerHTML = ownedList.map(item => {
                    const sq = item.sq;
                    const st = item.state;
                    const col = GROUP_COLORS[sq.group] || '#444';
                    let houseDots = '';
                    if (st.houses === 5) {
                        houseDots = `<span class="hotel-dot-mini" title="Hotel"></span>`;
                    } else if (st.houses > 0) {
                        houseDots = Array(st.houses).fill(0).map(() => `<span class="house-dot-mini"></span>`).join('');
                    }

                    return `
                        <div class="table-mini-card ${st.mortgaged ? 'mortgaged' : ''}" onclick="window.MonopolyGame.showDeedModal(${item.idx})" title="${sq.name} (Klicken für Aktionen)">
                            <div class="table-mini-card-bar" style="background:${col};"></div>
                            <div class="table-mini-card-name">${sq.name}</div>
                            <div class="table-mini-card-houses">${houseDots}</div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Activity Logs
        const logsListEl = document.getElementById('logs-list');
        if (logsListEl && gameState.logs) {
            logsListEl.innerHTML = gameState.logs.map(log => {
                let cls = '';
                if (log.includes('würfelt')) cls = 'log-dice';
                else if (log.includes('kauft')) cls = 'log-buy';
                else if (log.includes('Miete')) cls = 'log-rent';
                else if (log.includes('Karte')) cls = 'log-card';
                return `<div class="log-entry ${cls}">${log}</div>`;
            }).join('');
            logsListEl.scrollTop = logsListEl.scrollHeight;

            const btnToggleLogs = document.getElementById('btn-toggle-logs');
            const logsPanel = document.getElementById('logs-panel');
            if (btnToggleLogs && logsPanel && !logsPanel.classList.contains('open')) {
                btnToggleLogs.classList.add('has-new');
            }
        }

        // Action Buttons Enable/Disable
        const btnRoll = document.getElementById('btn-roll');
        const btnBuy = document.getElementById('btn-buy');
        const btnAuction = document.getElementById('btn-auction');
        const btnBankrupt = document.getElementById('btn-bankrupt');
        const btnEnd = document.getElementById('btn-end-turn');
        const btnBail = document.getElementById('btn-bail');
        const btnJailCard = document.getElementById('btn-jail-card');

        if (btnRoll) {
            const canRoll = isMyTurn && !gameState.rolled && !gameState.auction_state && (!myPlayer || !myPlayer.is_bankrupt);
            btnRoll.disabled = !canRoll;
            btnRoll.classList.toggle('can-roll', canRoll);
        }

        const isBuyOrAuction = isMyTurn && gameState.pending_action && gameState.pending_action.type === 'BUY_OR_AUCTION';

        if (btnBuy) {
            const canBuy = isBuyOrAuction && myPlayer && myPlayer.money >= gameState.pending_action.price;
            btnBuy.disabled = !canBuy;
            if (isBuyOrAuction) {
                btnBuy.textContent = `🏠 Kaufen (${gameState.pending_action.price} DM)`;
                btnBuy.style.display = 'inline-flex';
            } else {
                btnBuy.style.display = 'none';
            }
        }

        if (btnAuction) {
            if (isBuyOrAuction) {
                btnAuction.style.display = 'inline-flex';
                btnAuction.disabled = false;
            } else {
                btnAuction.style.display = 'none';
            }
        }

        if (btnBankrupt && myPlayer) {
            const inDebt = isMyTurn && myPlayer.money < 0 && !myPlayer.is_bankrupt;
            btnBankrupt.style.display = inDebt ? 'inline-flex' : 'none';
        }

        if (btnEnd) {
            const pendingType = (gameState.pending_action && gameState.pending_action.type) || null;
            const blockedByPending = (pendingType === 'BUY_OR_AUCTION' || pendingType === 'TAX_CHOICE' || !!gameState.auction_state);
            const inDebt = (myPlayer && myPlayer.money < 0);
            const canEnd = isMyTurn && gameState.rolled && !blockedByPending && !inDebt;
            btnEnd.disabled = !canEnd;
        }

        // Jail actions (only BEFORE rolling dice, per Parker rules page 2)
        if (btnBail && myPlayer) {
            const canBail = isMyTurn && !gameState.rolled && myPlayer.in_jail && myPlayer.money >= 50;
            btnBail.style.display = canBail ? 'inline-flex' : 'none';
        }
        if (btnJailCard && myPlayer) {
            const canCard = isMyTurn && !gameState.rolled && myPlayer.in_jail && myPlayer.jail_cards > 0;
            btnJailCard.style.display = canCard ? 'inline-flex' : 'none';
        }
    }

    // Show Auction Modal (Versteigerung)
    function showAuctionModal() {
        if (!gameState || !gameState.auction_state) {
            closeModal('modal-auction');
            return;
        }
        const auc = gameState.auction_state;
        const sq = auc.square;
        const modalBody = document.getElementById('auction-modal-body');
        if (!modalBody) return;

        const myPlayer = gameState.players.find(p => p.id === playerId);
        const amIActive = auc.active_bidders && auc.active_bidders.includes(playerId);
        const highBid = auc.high_bid || 0;
        const highBidder = auc.high_bidder_name || 'Noch kein Gebot';
        const minNextBid = highBid + 10;
        const canAfford10 = myPlayer && myPlayer.money >= highBid + 10;
        const canAfford50 = myPlayer && myPlayer.money >= highBid + 50;

        const deedImgSrc = DEED_CARD_IMAGES[sq.index];
        const imgHtml = deedImgSrc
            ? `<img src="${resolveUrl(deedImgSrc)}" alt="${sq.name}" style="max-height:170px; border-radius:8px; margin:0 auto 10px auto; display:block;" />`
            : '';

        modalBody.innerHTML = `
            ${imgHtml}
            <div style="text-align:center; margin-bottom:10px;">
                <div style="font-size:16px; font-weight:800;">${sq.name}</div>
                <div style="font-size:12px; color:var(--text-muted);">Regulärer Kaufpreis: ${sq.price} DM</div>
            </div>
            <div style="background:rgba(255,255,255,0.06); padding:10px 14px; border-radius:8px; margin-bottom:12px; font-size:13px; display:flex; justify-content:space-between; align-items:center;">
                <span>Höchstgebot: <strong style="color:var(--accent-gold); font-size:15px;">${highBid} DM</strong></span>
                <span>Bieter: <strong>${highBidder}</strong></span>
            </div>
            ${amIActive ? `
                <div style="display:flex; gap:8px; margin-bottom:8px;">
                    <button class="btn-action btn-buy" style="flex:1; font-size:12px;" ${canAfford10 ? '' : 'disabled'} onclick="window.MonopolyGame.placeAuctionBid(${highBid + 10})">
                        +10 DM (${highBid + 10} DM)
                    </button>
                    <button class="btn-action btn-buy" style="flex:1; font-size:12px;" ${canAfford50 ? '' : 'disabled'} onclick="window.MonopolyGame.placeAuctionBid(${highBid + 50})">
                        +50 DM (${highBid + 50} DM)
                    </button>
                </div>
                <div style="display:flex; gap:8px; margin-bottom:10px;">
                    <input type="number" id="auction-custom-bid" class="chat-input" min="${highBid + 1}" max="${myPlayer ? myPlayer.money : 1500}" value="${Math.min(myPlayer ? myPlayer.money : minNextBid, minNextBid)}" style="flex:1; padding:6px 10px;">
                    <button class="btn-action btn-trade" style="font-size:12px;" onclick="window.MonopolyGame.submitCustomBid()">Bieten</button>
                </div>
                <button class="btn-action" style="width:100%; background:#c0392b; color:#fff;" onclick="window.MonopolyGame.passAuction()">
                    🏳️ Aussteigen (Passen)
                </button>
            ` : `
                <div style="text-align:center; color:var(--text-muted); font-size:13px; padding:8px;">
                    Du bist aus dieser Versteigerung ausgestiegen. Warte auf die anderen Bieter...
                </div>
            `}
        `;
        openModal('modal-auction');
    }

    // Show Income Tax Choice Modal (Einkommensteuer: 200 DM oder 10%)
    function showTaxChoiceModal(actionData) {
        const modalBody = document.getElementById('tax-modal-body');
        if (!modalBody || !actionData) return;

        const flatTax = actionData.flat_tax || 200;
        const pctTax = actionData.percent_tax || 200;
        const wealth = actionData.wealth || 0;

        modalBody.innerHTML = `
            <p style="font-size:13px; line-height:1.45; margin-bottom:12px;">
                Laut Parker-Regelwerk kannst du bei der <strong>Einkommensteuer</strong> wählen, ob du den Festbetrag oder <strong>10 % deines gesamten Vermögens</strong> (Bargeld + Grundstückswerte + Gebäude = ${wealth} DM) an die Bank zahlst:
            </p>
            <div style="display:flex; flex-direction:column; gap:10px;">
                <button class="btn-action btn-buy" style="width:100%; justify-content:center;" onclick="window.MonopolyGame.payIncomeTax('flat')">
                    💵 Pauschalbetrag zahlen (${flatTax} DM)
                </button>
                <button class="btn-action btn-trade" style="width:100%; justify-content:center;" onclick="window.MonopolyGame.payIncomeTax('percent')">
                    📊 10 % des Vermögens zahlen (${pctTax} DM)
                </button>
            </div>
        `;
        openModal('modal-tax');
    }

    // Show Card Modal (Ereignis- / Gemeinschaftskarte with Authentic ROM Graphic or Illustration)
    function showCardModal(deckType, text, cardImage, playSound = false) {
        const titleEl = document.getElementById('card-modal-title');
        const containerEl = document.getElementById('card-modal-container');
        const textEl = document.getElementById('card-modal-text');
        const imgEl = document.getElementById('card-modal-img');
        const fullCardImgEl = document.getElementById('card-modal-full-img');

        const isChest = (deckType || '').toLowerCase().includes('gemein');
        if (titleEl) titleEl.textContent = isChest ? 'GEMEINSCHAFTSKARTE' : 'EREIGNISKARTE';

        if (cardImage && fullCardImgEl) {
            fullCardImgEl.src = resolveUrl('static/assets/chance_chest/cards/' + cardImage);
            fullCardImgEl.style.display = 'block';
            if (containerEl) containerEl.style.display = 'none';
        } else {
            if (fullCardImgEl) fullCardImgEl.style.display = 'none';
            if (containerEl) {
                containerEl.style.display = 'block';
                containerEl.className = 'chance-chest-card ' + (isChest ? 'chest' : 'chance');
            }
            if (textEl) textEl.textContent = text || '';
            if (imgEl) imgEl.src = getCardIllustration(text);
        }

        openModal('modal-card');
        if (playSound && Sound) Sound.playCard();
    }

    // Show Besitzurkunde (Property Deed Modal with Authentic ROM Card Graphics)
    function showDeedModal(sqIdx) {
        if (!squaresData || squaresData.length === 0) return;
        const sq = squaresData[sqIdx];
        if (!sq) return;

        // Non-buyable square
        if (!['property', 'station', 'utility'].includes(sq.type)) {
            return;
        }

        const st = gameState ? gameState.board_state[sqIdx] : null;
        const owner = (st && st.owner && gameState) ? gameState.players.find(p => p.id === st.owner) : null;
        const isMyProperty = (owner && owner.id === playerId);
        const myPlayer = gameState ? gameState.players.find(p => p.id === playerId) : null;
        const isMyTurn = (gameState && gameState.current_player && gameState.current_player.id === playerId);

        const bannerColor = GROUP_COLORS[sq.group] || '#333';
        const modalBody = document.getElementById('deed-modal-body');
        if (!modalBody) return;

        let rentHtml = '';
        if (sq.type === 'property') {
            rentHtml = `
                <div class="deed-row"><span>Miete Grundstück allein</span><span>${sq.rents[0]} DM</span></div>
                <div class="deed-row"><span>Mit 1 Haus</span><span>${sq.rents[1]} DM</span></div>
                <div class="deed-row"><span>Mit 2 Häusern</span><span>${sq.rents[2]} DM</span></div>
                <div class="deed-row"><span>Mit 3 Häusern</span><span>${sq.rents[3]} DM</span></div>
                <div class="deed-row"><span>Mit 4 Häusern</span><span>${sq.rents[4]} DM</span></div>
                <div class="deed-row bold"><span>Mit HOTEL</span><span>${sq.rents[5]} DM</span></div>
            `;
        } else if (sq.type === 'station') {
            rentHtml = `
                <div class="deed-row"><span>Miete 1 Bahnhof</span><span>25 DM</span></div>
                <div class="deed-row"><span>Miete 2 Bahnhöfe</span><span>50 DM</span></div>
                <div class="deed-row"><span>Miete 3 Bahnhöfe</span><span>100 DM</span></div>
                <div class="deed-row bold"><span>Miete 4 Bahnhöfe</span><span>200 DM</span></div>
            `;
        } else if (sq.type === 'utility') {
            rentHtml = `
                <div class="deed-row"><span>1 Werk besessen</span><span>4x Augen</span></div>
                <div class="deed-row bold"><span>2 Werke besessen</span><span>10x Augen</span></div>
            `;
        }

        let actionsHtml = '';

        // Direct Buy or Auction buttons when landing on unowned property
        if (!owner && isMyTurn && gameState && gameState.pending_action && gameState.pending_action.type === 'BUY_OR_AUCTION' && gameState.pending_action.square && gameState.pending_action.square.index === sqIdx) {
            const canBuy = myPlayer && myPlayer.money >= sq.price;
            actionsHtml += `
                <button class="btn-action btn-buy" style="font-size:13px; padding:8px 12px; flex:1;" ${canBuy ? '' : 'disabled'} onclick="window.MonopolyGame.buyProperty(${sqIdx})">
                    🏠 Kaufen (${sq.price} DM)
                </button>
                <button class="btn-action" style="font-size:13px; padding:8px 12px; flex:1; background:#e67e22; color:#fff;" onclick="window.MonopolyGame.startAuction(${sqIdx})">
                    🔨 Versteigern
                </button>
            `;
        } else if (isMyProperty) {
            const houses = st.houses || 0;
            const isMortgaged = st.mortgaged;

            // Build / Sell buttons (allowed anytime per Parker rules page 3)
            if (sq.type === 'property' && !isMortgaged) {
                const canBuild = houses < 5 && myPlayer && myPlayer.money >= sq.house_cost;
                const canSell = houses > 0;
                actionsHtml += `
                    <button class="btn-action btn-buy" style="font-size:12px; padding:6px 12px; flex:1;" ${canBuild ? '' : 'disabled'} onclick="window.MonopolyGame.buildHouse(${sqIdx})">
                        🔨 ${houses === 4 ? 'Hotel' : 'Haus'} bauen (${sq.house_cost} DM)
                    </button>
                    ${canSell ? `
                    <button class="btn-action" style="font-size:12px; padding:6px 12px; background:#e67e22; color:#fff;" onclick="window.MonopolyGame.sellHouse(${sqIdx})">
                        Verkaufen (+${sq.house_cost / 2} DM)
                    </button>` : ''}
                `;
            }

            // Mortgage button
            if (houses === 0) {
                const mortgageVal = sq.mortgage || (sq.price / 2);
                const unmortgageCost = Math.round(mortgageVal * 1.1);
                if (!isMortgaged) {
                    actionsHtml += `
                        <button class="btn-action" style="font-size:12px; padding:6px 12px; background:#d35400; color:#fff;" onclick="window.MonopolyGame.toggleMortgage(${sqIdx})">
                            Hypothek aufnehmen (+${mortgageVal} DM)
                        </button>
                    `;
                } else {
                    const canUnmortgage = (myPlayer && myPlayer.money >= unmortgageCost);
                    actionsHtml += `
                        <button class="btn-action" style="font-size:12px; padding:6px 12px; background:#27ae60; color:#fff;" ${canUnmortgage ? '' : 'disabled'} onclick="window.MonopolyGame.toggleMortgage(${sqIdx})">
                            Hypothek ablösen (-${unmortgageCost} DM)
                        </button>
                    `;
                }
            }
        }

        const deedImgSrc = DEED_CARD_IMAGES[sqIdx];
        const bankHouses = (gameState && gameState.bank_houses !== undefined) ? gameState.bank_houses : 32;
        const bankHotels = (gameState && gameState.bank_hotels !== undefined) ? gameState.bank_hotels : 12;
        let cardGraphicHtml = '';

        if (deedImgSrc) {
            cardGraphicHtml = `
                <div class="deed-image-wrap">
                    <img class="deed-card-img" src="${resolveUrl(deedImgSrc)}" alt="${sq.name}" />
                    ${st && st.mortgaged ? '<div class="mortgage-stamp-overlay">HYPOTHEK</div>' : ''}
                </div>
                <div style="background:rgba(255,255,255,0.06); padding:10px 14px; border-radius:8px; margin-top:10px; font-size:12px; display:flex; flex-direction:column; gap:4px;">
                    <div><strong>Kaufpreis:</strong> ${sq.price} DM | <strong>Hypothekenwert:</strong> ${sq.mortgage || sq.price / 2} DM</div>
                    ${sq.house_cost ? `<div><strong>Hausbau:</strong> je ${sq.house_cost} DM ${st && st.houses ? `(Aktuell: ${st.houses === 5 ? 'Hotel' : st.houses + ' Häuser'})` : ''}</div>` : ''}
                    ${sq.house_cost ? `<div style="font-size:11px; color:var(--text-muted);">Bank-Vorrat: ${bankHouses} Häuser, ${bankHotels} Hotels</div>` : ''}
                    <div style="margin-top:2px; font-weight:700; color:${owner ? owner.color : '#888'};">
                        Besitzer: ${owner ? owner.name + (isMyProperty ? ' (Du)' : '') : 'Niemand (Frei)'}
                        ${st && st.mortgaged ? ' - ⚠️ HYPOTHEK BELASTET' : ''}
                    </div>
                </div>
            `;
        } else {
            cardGraphicHtml = `
                <div class="deed-card">
                    <div class="deed-banner" style="background:${bannerColor};">
                        <div class="deed-subtitle">BESITZURKUNDE</div>
                        <div class="deed-street-name">${sq.name}</div>
                    </div>
                    <div class="deed-content">${rentHtml}</div>
                    <div class="deed-footer">
                        <div><strong>Kaufpreis:</strong> ${sq.price} DM</div>
                        <div><strong>Hypothekenwert:</strong> ${sq.mortgage || sq.price / 2} DM</div>
                        ${sq.house_cost ? `<div><strong>Hauskosten:</strong> je ${sq.house_cost} DM</div>` : ''}
                        <div style="margin-top:4px; font-weight:700; color:${owner ? owner.color : '#666'};">
                            Besitzer: ${owner ? owner.name + (isMyProperty ? ' (Du)' : '') : 'Niemand (Frei)'}
                            ${st && st.mortgaged ? ' - ⚠️ MIT HYPOTHEK BELASTET' : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        modalBody.innerHTML = `
            ${cardGraphicHtml}
            ${actionsHtml ? `<div class="deed-actions-row" style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">${actionsHtml}</div>` : ''}
        `;

        openModal('modal-deed');
    }

    // Show Player Portfolio (All owned streets)
    function showPlayerPortfolio(targetPlayerId) {
        if (!gameState) return;
        const target = gameState.players.find(p => p.id === targetPlayerId);
        if (!target) return;

        const isMe = (target.id === playerId);
        const titleEl = document.getElementById('portfolio-modal-title');
        if (titleEl) titleEl.textContent = `Besitz von ${target.name} ${isMe ? '(Dein Vermögen)' : ''}`;

        const gridEl = document.getElementById('portfolio-grid');
        const ownedSquares = [];
        for (const [sqIdxStr, st] of Object.entries(gameState.board_state)) {
            if (st.owner === target.id) {
                ownedSquares.push({ idx: parseInt(sqIdxStr), state: st, square: squaresData[parseInt(sqIdxStr)] });
            }
        }

        if (ownedSquares.length === 0) {
            gridEl.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:20px;">Keine Grundstücke im Besitz.</p>`;
        } else {
            gridEl.innerHTML = ownedSquares.map(item => {
                const sq = item.square;
                const st = item.state;
                const col = GROUP_COLORS[sq.group] || '#444';
                let houseBadges = '';
                if (st.houses === 5) {
                    houseBadges = `<span class="hotel-dot" title="Hotel"></span>`;
                } else if (st.houses > 0) {
                    houseBadges = Array(st.houses).fill(0).map(() => `<span class="house-dot"></span>`).join('');
                }

                return `
                    <div class="portfolio-card-mini ${st.mortgaged ? 'mortgaged' : ''}" onclick="window.MonopolyGame.showDeedModal(${item.idx})">
                        <div class="portfolio-mini-header" style="background:${col};"></div>
                        <div class="portfolio-mini-body">
                            <div class="portfolio-mini-title">${sq.name}</div>
                            <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Wert: ${sq.price} DM</div>
                            <div class="portfolio-mini-houses">${houseBadges}</div>
                            ${st.mortgaged ? '<div style="color:#e74c3c; font-size:10px; font-weight:700;">HYPOTHEK</div>' : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        openModal('modal-portfolio');
    }

    // Trade Modal (Builder)
    function showTradeModal() {
        if (!gameState) return;
        const otherPlayers = gameState.players.filter(p => p.id !== playerId && !p.is_bankrupt);
        if (otherPlayers.length === 0) {
            alert('Keine anderen aktiven Spieler zum Handeln vorhanden.');
            return;
        }

        const partnerSelect = document.getElementById('trade-partner-select');
        partnerSelect.innerHTML = otherPlayers.map(p => `<option value="${p.id}">${p.name} (${p.money} DM)</option>`).join('');

        partnerSelect.onchange = updateTradeBuilderProps;
        updateTradeBuilderProps();
        openModal('modal-trade');
    }

    function updateTradeBuilderProps() {
        const partnerSelect = document.getElementById('trade-partner-select');
        const targetId = partnerSelect.value;

        const myPlayer = gameState.players.find(p => p.id === playerId);
        const targetPlayer = gameState.players.find(p => p.id === targetId);
        const offerJcInput = document.getElementById('trade-offer-jail-cards');
        const reqJcInput = document.getElementById('trade-req-jail-cards');
        if (offerJcInput) {
            offerJcInput.max = myPlayer ? (myPlayer.jail_cards || 0) : 0;
            offerJcInput.value = 0;
        }
        if (reqJcInput) {
            reqJcInput.max = targetPlayer ? (targetPlayer.jail_cards || 0) : 0;
            reqJcInput.value = 0;
        }

        // My properties
        const myPropsWrap = document.getElementById('trade-my-props');
        const myProps = [];
        for (const [sqIdxStr, st] of Object.entries(gameState.board_state)) {
            if (st.owner === playerId) {
                myProps.push({ idx: parseInt(sqIdxStr), sq: squaresData[parseInt(sqIdxStr)] });
            }
        }
        myPropsWrap.innerHTML = myProps.map(p => `
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; margin-bottom:4px; cursor:pointer;">
                <input type="checkbox" name="trade_my_prop" value="${p.idx}">
                <span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:${GROUP_COLORS[p.sq.group] || '#777'};"></span>
                ${p.sq.name}
            </label>
        `).join('') || '<div style="font-size:11px; color:#888;">Keine Grundstücke</div>';

        // Target properties
        const targetPropsWrap = document.getElementById('trade-target-props');
        const targetProps = [];
        for (const [sqIdxStr, st] of Object.entries(gameState.board_state)) {
            if (st.owner === targetId) {
                targetProps.push({ idx: parseInt(sqIdxStr), sq: squaresData[parseInt(sqIdxStr)] });
            }
        }
        targetPropsWrap.innerHTML = targetProps.map(p => `
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; margin-bottom:4px; cursor:pointer;">
                <input type="checkbox" name="trade_target_prop" value="${p.idx}">
                <span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:${GROUP_COLORS[p.sq.group] || '#777'};"></span>
                ${p.sq.name}
            </label>
        `).join('') || '<div style="font-size:11px; color:#888;">Keine Grundstücke</div>';
    }

    function submitTradeProposal() {
        const partnerSelect = document.getElementById('trade-partner-select');
        const targetId = partnerSelect.value;
        const offerMoney = parseInt(document.getElementById('trade-offer-money').value) || 0;
        const reqMoney = parseInt(document.getElementById('trade-req-money').value) || 0;
        const offerJcEl = document.getElementById('trade-offer-jail-cards');
        const reqJcEl = document.getElementById('trade-req-jail-cards');
        const offerJailCards = offerJcEl ? (parseInt(offerJcEl.value) || 0) : 0;
        const reqJailCards = reqJcEl ? (parseInt(reqJcEl.value) || 0) : 0;

        const offerProps = Array.from(document.querySelectorAll('input[name="trade_my_prop"]:checked')).map(cb => parseInt(cb.value));
        const reqProps = Array.from(document.querySelectorAll('input[name="trade_target_prop"]:checked')).map(cb => parseInt(cb.value));

        sendWsMessage({
            action: 'PROPOSE_TRADE',
            target_id: targetId,
            offer_money: offerMoney,
            offer_props: offerProps,
            req_money: reqMoney,
            req_props: reqProps,
            offer_jail_cards: offerJailCards,
            req_jail_cards: reqJailCards
        });

        closeModal('modal-trade');
    }

    function showIncomingTradeModal(trade) {
        const sender = gameState.players.find(p => p.id === trade.sender_id);
        const modalBody = document.getElementById('incoming-trade-body');

        const offerPropNames = trade.offer_props.map(idx => squaresData[idx].name).join(', ') || 'Keine';
        const reqPropNames = trade.req_props.map(idx => squaresData[idx].name).join(', ') || 'Keine';
        const offerJcText = trade.offer_jail_cards ? `, ${trade.offer_jail_cards}x Gefängnisfrei` : '';
        const reqJcText = trade.req_jail_cards ? `, ${trade.req_jail_cards}x Gefängnisfrei` : '';

        modalBody.innerHTML = `
            <p><strong>${sender ? sender.name : 'Mitspieler'}</strong> bietet dir folgenden Tausch an:</p>
            <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:8px; margin:10px 0; font-size:13px; display:flex; flex-direction:column; gap:8px;">
                <div><strong style="color:var(--primary);">Du erhältst:</strong> ${trade.offer_money} DM${offerJcText}, Grundstücke: ${offerPropNames}</div>
                <div><strong style="color:var(--accent-red);">Du gibst:</strong> ${trade.req_money} DM${reqJcText}, Grundstücke: ${reqPropNames}</div>
            </div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button class="btn-action btn-buy" style="flex:1;" onclick="window.MonopolyGame.acceptTrade()">Annehmen</button>
                <button class="btn-action" style="flex:1; background:#c0392b; color:#fff;" onclick="window.MonopolyGame.rejectTrade()">Ablehnen</button>
            </div>
        `;
        openModal('modal-incoming-trade');
    }

    // Modal Helpers
    function openModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('open');
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('open');
    }

    // Public controller API
    const GameClient = {
        init: function() {
            console.log('GameClient.init called!');
            initPlayerIdentity();

            // Connect WebSocket immediately
            connectWebSocket();

            // Open lobby modal immediately
            openModal('modal-lobby');

            // Setup Lobby Token selection
            const tokenGrid = document.getElementById('lobby-token-grid');
            if (tokenGrid) {
                tokenGrid.innerHTML = TOKENS.map(t => `
                    <div class="token-choice ${t.id === selectedToken ? 'selected' : ''}" data-token="${t.id}" onclick="window.MonopolyGame.selectToken('${t.id}')">
                        ${t.iconImg ? `<img src="${resolveUrl(t.iconImg)}" class="token-choice-img" alt="${t.name}" />` : `<span class="token-icon-3d">${t.icon}</span>`}
                        <span>${t.name}</span>
                    </div>
                `).join('');
            }

            // Setup Color selection
            const colorRow = document.getElementById('color-palette-row');
            if (colorRow) {
                colorRow.innerHTML = COLORS.map(c => `
                    <div class="color-dot-pick ${c === selectedColor ? 'selected' : ''}" style="background:${c};" onclick="window.MonopolyGame.selectColor('${c}')"></div>
                `).join('');
            }

            // Bind lobby input
            const nameInput = document.getElementById('input-player-name');
            if (nameInput) {
                nameInput.value = playerName;
                nameInput.oninput = (e) => {
                    playerName = e.target.value.trim() || 'Spieler';
                    try { localStorage.setItem('monopoly_player_name', playerName); } catch (e) {}
                };
            }

            // Copy room link
            const copyBtn = document.getElementById('btn-copy-link');
            if (copyBtn) {
                copyBtn.onclick = () => {
                    const url = window.location.href;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(url).then(() => {
                            alert('Einladungslink in die Zwischenablage kopiert!\n' + url);
                        }).catch(() => {
                            prompt('Kopiere diesen Einladungslink:', url);
                        });
                    } else {
                        prompt('Kopiere diesen Einladungslink:', url);
                    }
                };
            }

            // Bind action buttons
            const btnRoll = document.getElementById('btn-roll');
            if (btnRoll) {
                btnRoll.onclick = () => sendWsMessage({ action: 'ROLL_DICE' });
            }

            const btnBuy = document.getElementById('btn-buy');
            if (btnBuy) {
                btnBuy.onclick = () => {
                    if (gameState && gameState.pending_action && gameState.pending_action.square) {
                        sendWsMessage({ action: 'BUY_PROPERTY', sq_idx: gameState.pending_action.square.index });
                    }
                };
            }

            const btnAuction = document.getElementById('btn-auction');
            if (btnAuction) {
                btnAuction.onclick = () => {
                    const sqIdx = (gameState && gameState.pending_action && gameState.pending_action.square) ? gameState.pending_action.square.index : null;
                    sendWsMessage({ action: 'START_AUCTION', sq_idx: sqIdx });
                };
            }

            const btnBankrupt = document.getElementById('btn-bankrupt');
            if (btnBankrupt) {
                btnBankrupt.onclick = () => {
                    if (confirm('Möchtest du wirklich den Bankrott erklären und aus dem Spiel ausscheiden?')) {
                        sendWsMessage({ action: 'BANKRUPTCY' });
                    }
                };
            }

            const btnEnd = document.getElementById('btn-end-turn');
            if (btnEnd) {
                btnEnd.onclick = () => sendWsMessage({ action: 'END_TURN' });
            }

            const btnBail = document.getElementById('btn-bail');
            if (btnBail) {
                btnBail.onclick = () => sendWsMessage({ action: 'PAY_BAIL' });
            }

            const btnJailCard = document.getElementById('btn-jail-card');
            if (btnJailCard) {
                btnJailCard.onclick = () => sendWsMessage({ action: 'USE_JAIL_CARD' });
            }

            const btnPortfolio = document.getElementById('btn-portfolio');
            if (btnPortfolio) {
                btnPortfolio.onclick = () => showPlayerPortfolio(playerId);
            }

            const btnTrade = document.getElementById('btn-trade');
            if (btnTrade) {
                btnTrade.onclick = showTradeModal;
            }

            const btnSubmitTrade = document.getElementById('btn-submit-trade');
            if (btnSubmitTrade) {
                btnSubmitTrade.onclick = submitTradeProposal;
            }

            const btnAddBot = document.getElementById('btn-add-bot');
            if (btnAddBot) {
                btnAddBot.onclick = () => sendWsMessage({ action: 'ADD_BOT' });
            }

            const btnStart = document.getElementById('btn-start-game');
            if (btnStart) {
                btnStart.onclick = () => sendWsMessage({ action: 'START_GAME' });
            }

            // Camera Controls & Active State Indicator
            const camButtons = {
                '2d': document.getElementById('btn-cam-2d'),
                '2.5d': document.getElementById('btn-cam-25d'),
                '3d': document.getElementById('btn-cam-3d')
            };

            function updateCamActiveState(mode) {
                const normalized = (mode === 'topdown') ? '2d' : (mode === 'table' ? '2.5d' : (mode === 'free3d' ? '3d' : mode));
                for (const [key, btn] of Object.entries(camButtons)) {
                    if (btn) btn.classList.toggle('active', key === normalized);
                }
            }

            const initialCam = (window.innerWidth <= 850) ? '2d' : '2.5d';
            updateCamActiveState(initialCam);

            if (camButtons['2d']) {
                camButtons['2d'].onclick = () => {
                    const engine = window.MonopolyBoard3D || Board3D;
                    if (engine) engine.setCameraPreset('2d');
                    updateCamActiveState('2d');
                };
            }
            if (camButtons['2.5d']) {
                camButtons['2.5d'].onclick = () => {
                    const engine = window.MonopolyBoard3D || Board3D;
                    if (engine) engine.setCameraPreset('2.5d');
                    updateCamActiveState('2.5d');
                };
            }
            if (camButtons['3d']) {
                camButtons['3d'].onclick = () => {
                    const engine = window.MonopolyBoard3D || Board3D;
                    if (engine) engine.setCameraPreset('3d');
                    updateCamActiveState('3d');
                };
            }

            const btnRotL = document.getElementById('btn-rot-left');
            if (btnRotL) btnRotL.onclick = () => {
                const engine = window.MonopolyBoard3D || Board3D;
                if (engine) engine.rotateBoardBy(-90);
            };

            const btnRotR = document.getElementById('btn-rot-right');
            if (btnRotR) btnRotR.onclick = () => {
                const engine = window.MonopolyBoard3D || Board3D;
                if (engine) engine.rotateBoardBy(90);
            };

            // Mute toggle (SFX)
            const btnMute = document.getElementById('btn-sound-toggle');
            if (btnMute && Sound) {
                btnMute.textContent = Sound.isMuted() ? '🔇' : '🔊';
                btnMute.onclick = () => {
                    const isMuted = Sound.toggleMute();
                    btnMute.textContent = isMuted ? '🔇' : '🔊';
                };
            }

            // Music toggle (BGM)
            const btnMusic = document.getElementById('btn-music-toggle');
            if (btnMusic && Sound) {
                const updateMusicBtn = () => {
                    const active = Sound.isMusicEnabled();
                    btnMusic.textContent = active ? '🎵' : '🔇';
                    btnMusic.title = active ? 'Musik stummschalten' : 'Hintergrundmusik abspielen';
                };
                updateMusicBtn();
                btnMusic.onclick = () => {
                    Sound.toggleMusic();
                    updateMusicBtn();
                };
            }

            // Collapsible Logs Panel toggle
            const logsPanel = document.getElementById('logs-panel');
            const btnToggleLogs = document.getElementById('btn-toggle-logs');
            const btnCloseLogs = document.getElementById('btn-close-logs');
            if (btnToggleLogs && logsPanel) {
                btnToggleLogs.onclick = () => {
                    logsPanel.classList.toggle('open');
                    btnToggleLogs.classList.remove('has-new');
                };
            }
            if (btnCloseLogs && logsPanel) {
                btnCloseLogs.onclick = () => logsPanel.classList.remove('open');
            }

            // Square & Table Card Click Raycasting callback
            const registerSquareCallback = () => {
                const engine = window.MonopolyBoard3D || Board3D;
                if (engine && engine.setSquareClickCallback) {
                    engine.setSquareClickCallback(sqIdx => showDeedModal(sqIdx));
                }
            };
            registerSquareCallback();
            setTimeout(registerSquareCallback, 500);
            setTimeout(registerSquareCallback, 1500);

            // Chat input
            const chatInput = document.getElementById('chat-input');
            const chatSendBtn = document.getElementById('chat-send-btn');
            if (chatInput && chatSendBtn) {
                const sendChat = () => {
                    const txt = chatInput.value.trim();
                    if (txt) {
                        sendWsMessage({ action: 'CHAT', message: txt });
                        chatInput.value = '';
                    }
                };
                chatSendBtn.onclick = sendChat;
                chatInput.onkeydown = (e) => {
                    if (e.key === 'Enter') sendChat();
                };
            }

        },

        selectToken: function(tokenId) {
            selectedToken = tokenId;
            localStorage.setItem('monopoly_player_token', tokenId);
            document.querySelectorAll('.token-choice').forEach(el => {
                el.classList.toggle('selected', el.getAttribute('data-token') === tokenId);
            });
            sendWsMessage({ action: 'JOIN', name: playerName, token: selectedToken, color: selectedColor });
        },

        selectColor: function(hex) {
            selectedColor = hex;
            localStorage.setItem('monopoly_player_color', hex);
            document.querySelectorAll('.color-dot-pick').forEach(el => {
                el.classList.toggle('selected', el.style.background.includes(hex) || el.style.backgroundColor === hex);
            });
            sendWsMessage({ action: 'JOIN', name: playerName, token: selectedToken, color: selectedColor });
        },

        showDeedModal: showDeedModal,
        showPlayerPortfolio: showPlayerPortfolio,

        focusPlayerSeat: function(targetId) {
            if (!gameState || !gameState.players) return;
            const myIdx = gameState.players.findIndex(p => p.id === playerId);
            const baseOffset = (myIdx >= 0) ? myIdx : 0;
            const pIdx = gameState.players.findIndex(p => p.id === targetId);
            if (pIdx >= 0) {
                const seatIdx = (pIdx - baseOffset + 4) % 4;
                if (Board3D && Board3D.focusSeatCards) {
                    Board3D.focusSeatCards(seatIdx);
                }
            }
        },

        viewMyTableCards: function() {
            viewedPlayerId = null;
            updateHUD();
        },

        viewPlayerTableCards: function(targetId) {
            viewedPlayerId = targetId;
            updateHUD();
        },

        buyProperty: function(sqIdx) {
            sendWsMessage({ action: 'BUY_PROPERTY', sq_idx: sqIdx });
            closeModal('modal-deed');
        },

        startAuction: function(sqIdx) {
            sendWsMessage({ action: 'START_AUCTION', sq_idx: sqIdx });
            closeModal('modal-deed');
        },

        placeAuctionBid: function(amount) {
            sendWsMessage({ action: 'AUCTION_BID', amount: parseInt(amount) || 0 });
        },

        submitCustomBid: function() {
            const el = document.getElementById('auction-custom-bid');
            if (el) {
                sendWsMessage({ action: 'AUCTION_BID', amount: parseInt(el.value) || 0 });
            }
        },

        passAuction: function() {
            sendWsMessage({ action: 'AUCTION_PASS' });
        },

        payIncomeTax: function(mode) {
            sendWsMessage({ action: 'PAY_INCOME_TAX', mode: mode });
            closeModal('modal-tax');
        },

        buildHouse: function(sqIdx) {
            sendWsMessage({ action: 'BUILD_HOUSE', sq_idx: sqIdx });
            closeModal('modal-deed');
        },

        sellHouse: function(sqIdx) {
            sendWsMessage({ action: 'SELL_HOUSE', sq_idx: sqIdx });
            closeModal('modal-deed');
        },

        toggleMortgage: function(sqIdx) {
            sendWsMessage({ action: 'TOGGLE_MORTGAGE', sq_idx: sqIdx });
            closeModal('modal-deed');
        },

        acceptTrade: function() {
            sendWsMessage({ action: 'ACCEPT_TRADE' });
            closeModal('modal-incoming-trade');
        },

        rejectTrade: function() {
            sendWsMessage({ action: 'REJECT_TRADE' });
            closeModal('modal-incoming-trade');
        },

        showCardModal: showCardModal,
        getMyPlayerId: function() { return playerId; },
        getCardIllustration: getCardIllustration,
        closeModal: closeModal
    };

    window.getCardIllustration = getCardIllustration;
    window.MonopolyGame = GameClient;
})(window);
