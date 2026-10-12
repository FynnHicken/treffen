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
    let yourTurnPopupTimeout = null;
    let endTurnTimerInterval = null;
    let endTurnTimerMode = null; // 'ROLL' or 'END_TURN'
    let endTurnSecondsLeft = 0;
    const END_TURN_TIMEOUT_SEC = 10;

    // Auction 5s Hammer Countdown state
    let auctionCountdownInterval = null;
    let auctionDeadlineMs = 0;
    let lastAuctionBidSeq = null;
    let lastAuctionSqIdx = null;
    let auctionTimeoutSentForSeq = null;

    // Sound and Board instances
    const Sound = window.MonopolySound;
    const Board3D = window.MonopolyBoard3D;

    function showYourTurnPopup(titleText = 'DU BIST DRAN!', subText = 'Würfle jetzt oder verwalte deine Straßen') {
        const popup = document.getElementById('your-turn-popup');
        const titleEl = document.getElementById('your-turn-popup-title');
        const subEl = document.getElementById('your-turn-popup-sub');
        if (!popup) return;

        if (titleEl) titleEl.textContent = titleText;
        if (subEl) subEl.textContent = subText;

        if (yourTurnPopupTimeout) {
            clearTimeout(yourTurnPopupTimeout);
            yourTurnPopupTimeout = null;
        }

        popup.classList.remove('hiding');
        popup.style.display = 'block';

        const durationMs = (titleText && titleText.includes('⚠️')) ? 4200 : 2600;
        yourTurnPopupTimeout = setTimeout(() => {
            hideYourTurnPopup();
        }, durationMs);
    }

    function hideYourTurnPopup() {
        const popup = document.getElementById('your-turn-popup');
        if (!popup || popup.style.display === 'none') return;
        if (yourTurnPopupTimeout) {
            clearTimeout(yourTurnPopupTimeout);
            yourTurnPopupTimeout = null;
        }
        popup.classList.add('hiding');
        setTimeout(() => {
            if (popup.classList.contains('hiding')) {
                popup.style.display = 'none';
                popup.classList.remove('hiding');
            }
        }, 250);
    }

    let rentPopupTimeout = null;

    function showRentPopup(rentData, fallbackPayer) {
        if (!rentData || !rentData.rent) return;
        const popup = document.getElementById('rent-toast-popup');
        const cardEl = document.getElementById('rent-toast-card');
        const iconEl = document.getElementById('rent-toast-icon');
        const titleEl = document.getElementById('rent-toast-title');
        const subEl = document.getElementById('rent-toast-sub');
        const amtEl = document.getElementById('rent-toast-amount');
        if (!popup || !cardEl) return;

        const rent = rentData.rent;
        const payerId = rentData.payer_id || (fallbackPayer && fallbackPayer.id);
        const payerName = rentData.payer || (fallbackPayer && fallbackPayer.name) || 'Spieler';
        const ownerId = rentData.owner_id;
        const ownerName = rentData.owner || 'Besitzer';
        const sqName = rentData.square_name || (rentData.square_idx !== undefined && squaresData[rentData.square_idx] ? squaresData[rentData.square_idx].name : 'Grundstück');

        const amIPayer = (payerId === playerId);
        const amIOwner = (ownerId === playerId);

        cardEl.classList.remove('rent-paid', 'rent-received');
        if (amIPayer) {
            cardEl.classList.add('rent-paid');
            if (iconEl) iconEl.textContent = '💸';
            if (titleEl) titleEl.textContent = 'MIETE FÄLLIG!';
            if (subEl) subEl.textContent = `Du zahlst Miete für ${sqName} an ${ownerName}`;
            if (amtEl) amtEl.textContent = `-${rent} DM`;
        } else if (amIOwner) {
            cardEl.classList.add('rent-received');
            if (iconEl) iconEl.textContent = '💰';
            if (titleEl) titleEl.textContent = 'MIETE ERHALTEN!';
            if (subEl) subEl.textContent = `${payerName} zahlt dir Miete für ${sqName}`;
            if (amtEl) amtEl.textContent = `+${rent} DM`;
        } else {
            if (iconEl) iconEl.textContent = '🏠';
            if (titleEl) titleEl.textContent = 'MIETZAHLUNG';
            if (subEl) subEl.textContent = `${payerName} zahlt Miete für ${sqName} an ${ownerName}`;
            if (amtEl) amtEl.textContent = `${rent} DM`;
        }

        if (Sound) Sound.playMoney();

        if (rentPopupTimeout) {
            clearTimeout(rentPopupTimeout);
            rentPopupTimeout = null;
        }

        popup.classList.remove('hiding');
        popup.style.display = 'block';

        rentPopupTimeout = setTimeout(() => {
            hideRentPopup();
        }, 3800);
    }

    function hideRentPopup() {
        const popup = document.getElementById('rent-toast-popup');
        if (!popup || popup.style.display === 'none') return;
        if (rentPopupTimeout) {
            clearTimeout(rentPopupTimeout);
            rentPopupTimeout = null;
        }
        popup.classList.add('hiding');
        setTimeout(() => {
            if (popup.classList.contains('hiding')) {
                popup.style.display = 'none';
                popup.classList.remove('hiding');
            }
        }, 250);
    }

    let cardModalAutoCloseTimer = null;
    let cardModalSecondsLeft = 0;
    const CARD_MODAL_TIMEOUT_SEC = 5;

    let buyOrAuctionTimerInterval = null;
    let buyOrAuctionSecondsLeft = 0;
    let buyOrAuctionSqIdx = null;
    const BUY_OR_AUCTION_TIMEOUT_SEC = 10;

    function clearCardModalTimer() {
        if (cardModalAutoCloseTimer) {
            clearInterval(cardModalAutoCloseTimer);
            clearTimeout(cardModalAutoCloseTimer);
            cardModalAutoCloseTimer = null;
        }
        cardModalSecondsLeft = 0;
    }

    function updateBuyOrAuctionButtonLabels() {
        const deedAuctionBtn = document.getElementById('deed-btn-auction');
        const dockAuctionBtn = document.getElementById('btn-auction');
        const labelSuffix = (buyOrAuctionTimerInterval && buyOrAuctionSecondsLeft > 0) ? ` (${buyOrAuctionSecondsLeft}s)` : '';
        if (deedAuctionBtn) {
            deedAuctionBtn.textContent = `🔨 Versteigern${labelSuffix}`;
        }
        if (dockAuctionBtn) {
            dockAuctionBtn.innerHTML = `<span>🔨</span><span>Versteigern${labelSuffix}</span>`;
        }
    }

    function clearBuyOrAuctionTimer() {
        if (buyOrAuctionTimerInterval) {
            clearInterval(buyOrAuctionTimerInterval);
            buyOrAuctionTimerInterval = null;
        }
        buyOrAuctionSecondsLeft = 0;
        buyOrAuctionSqIdx = null;
        updateBuyOrAuctionButtonLabels();
    }

    function isPendingBuyOrAuctionForMe() {
        if (!gameState || gameState.status !== 'PLAYING' || isTokenInTransit || gameState.auction_state) return false;
        const currPlayer = gameState.current_player;
        if (!currPlayer || currPlayer.id !== playerId) return false;
        return !!(gameState.pending_action && gameState.pending_action.type === 'BUY_OR_AUCTION' && gameState.pending_action.square);
    }

    function syncBuyOrAuctionTimer() {
        if (!isPendingBuyOrAuctionForMe()) {
            clearBuyOrAuctionTimer();
            return;
        }
        const targetSqIdx = gameState.pending_action.square.index;
        if (!buyOrAuctionTimerInterval || buyOrAuctionSqIdx !== targetSqIdx) {
            if (buyOrAuctionTimerInterval) {
                clearInterval(buyOrAuctionTimerInterval);
                buyOrAuctionTimerInterval = null;
            }
            buyOrAuctionSqIdx = targetSqIdx;
            buyOrAuctionSecondsLeft = BUY_OR_AUCTION_TIMEOUT_SEC;
            updateBuyOrAuctionButtonLabels();
            buyOrAuctionTimerInterval = setInterval(() => {
                if (!isPendingBuyOrAuctionForMe()) {
                    clearBuyOrAuctionTimer();
                    return;
                }
                buyOrAuctionSecondsLeft -= 1;
                if (buyOrAuctionSecondsLeft <= 0) {
                    const sqToAuction = buyOrAuctionSqIdx;
                    clearBuyOrAuctionTimer();
                    closeModal('modal-deed');
                    sendWsMessage({ action: 'START_AUCTION', sq_idx: sqToAuction });
                } else {
                    updateBuyOrAuctionButtonLabels();
                }
            }, 1000);
        } else {
            updateBuyOrAuctionButtonLabels();
        }
    }

    let lastUserActivityAt = 0;
    let lastPointerCoords = { x: 0, y: 0 };

    function recordUserActivity() {
        lastUserActivityAt = Date.now();
        if (endTurnTimerInterval) {
            endTurnSecondsLeft = END_TURN_TIMEOUT_SEC;
            updateEndTurnButtonLabel();
        }
    }

    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(evtName => {
        window.addEventListener(evtName, recordUserActivity, { passive: true });
    });
    window.addEventListener('pointermove', (e) => {
        if (Math.hypot(e.clientX - lastPointerCoords.x, e.clientY - lastPointerCoords.y) > 3) {
            lastPointerCoords.x = e.clientX;
            lastPointerCoords.y = e.clientY;
            recordUserActivity();
        }
    }, { passive: true });

    function isManagementModalOpen() {
        const modalIds = ['modal-card', 'modal-deed', 'modal-trade', 'modal-portfolio', 'modal-incoming-trade', 'modal-auction', 'modal-tax', 'modal-gameover'];
        return modalIds.some(id => {
            const el = document.getElementById(id);
            return el && el.classList.contains('open');
        });
    }

    function canPlayerRollNow() {
        if (!gameState || gameState.status !== 'PLAYING' || isTokenInTransit) return false;
        const currPlayer = gameState.current_player;
        const isMyTurn = (currPlayer && currPlayer.id === playerId);
        if (!isMyTurn || gameState.rolled) return false;
        const myPlayer = gameState.players ? gameState.players.find(p => p.id === playerId) : null;
        if (myPlayer && myPlayer.is_bankrupt) return false;
        const pendingCard = (gameState.pending_action && gameState.pending_action.type === 'CARD_DRAWN');
        if (pendingCard || gameState.auction_state) return false;
        return true;
    }

    function canPlayerEndTurnNow() {
        if (!gameState || gameState.status !== 'PLAYING' || isTokenInTransit) return false;
        const currPlayer = gameState.current_player;
        const isMyTurn = (currPlayer && currPlayer.id === playerId);
        if (!isMyTurn || !gameState.rolled) return false;
        const myPlayer = gameState.players ? gameState.players.find(p => p.id === playerId) : null;
        if (myPlayer && (myPlayer.money < 0 || myPlayer.is_bankrupt)) return false;
        const pendingType = (gameState.pending_action && gameState.pending_action.type) || null;
        const blockedByPending = (pendingType === 'BUY_OR_AUCTION' || pendingType === 'TAX_CHOICE' || pendingType === 'CARD_DRAWN' || !!gameState.auction_state);
        return !blockedByPending;
    }

    function getActiveTurnTimerMode() {
        if (canPlayerRollNow()) return 'ROLL';
        if (canPlayerEndTurnNow()) return 'END_TURN';
        return null;
    }

    function updateEndTurnButtonLabel() {
        const btnRoll = document.getElementById('btn-roll');
        const rollLabelEl = document.getElementById('btn-roll-label');
        const btnEnd = document.getElementById('btn-end-turn');
        const endLabelEl = document.getElementById('btn-end-turn-label');

        const isActivelyInteracting = isManagementModalOpen() || ((Date.now() - lastUserActivityAt) < 1200);

        if (btnRoll && rollLabelEl) {
            const myPlayer = (gameState && gameState.players) ? gameState.players.find(p => p.id === playerId) : null;
            const isMyTurn = (gameState && gameState.current_player && gameState.current_player.id === playerId);
            const inJailRolling = (isMyTurn && myPlayer && myPlayer.in_jail && !gameState.rolled);
            const attemptNum = inJailRolling ? Math.min(3, (myPlayer.jail_rolls_this_turn || 0) + 1) : 0;
            const baseRollText = inJailRolling ? `Würfeln (${attemptNum}/3)` : 'Würfeln';

            if (endTurnTimerInterval && endTurnTimerMode === 'ROLL' && endTurnSecondsLeft > 0 && !isActivelyInteracting) {
                rollLabelEl.textContent = `${baseRollText} (${endTurnSecondsLeft}s)`;
                btnRoll.classList.add('countdown-active');
            } else {
                rollLabelEl.textContent = baseRollText;
                btnRoll.classList.remove('countdown-active');
            }
        }

        if (btnEnd && endLabelEl) {
            if (endTurnTimerInterval && endTurnTimerMode === 'END_TURN' && endTurnSecondsLeft > 0 && !isActivelyInteracting) {
                endLabelEl.textContent = `Zug beenden (${endTurnSecondsLeft}s)`;
                btnEnd.classList.add('countdown-active');
            } else {
                endLabelEl.textContent = 'Zug beenden';
                btnEnd.classList.remove('countdown-active');
            }
        }
    }

    function clearEndTurnTimer() {
        if (endTurnTimerInterval) {
            clearInterval(endTurnTimerInterval);
            endTurnTimerInterval = null;
        }
        endTurnTimerMode = null;
        endTurnSecondsLeft = 0;
        updateEndTurnButtonLabel();
    }

    function resetEndTurnTimer() {
        if (endTurnTimerInterval) {
            endTurnSecondsLeft = END_TURN_TIMEOUT_SEC;
            updateEndTurnButtonLabel();
        }
    }

    function syncEndTurnTimer() {
        const targetMode = getActiveTurnTimerMode();
        if (!targetMode) {
            clearEndTurnTimer();
            return;
        }

        if (!endTurnTimerInterval || endTurnTimerMode !== targetMode) {
            if (endTurnTimerInterval) {
                clearInterval(endTurnTimerInterval);
                endTurnTimerInterval = null;
            }
            endTurnTimerMode = targetMode;
            endTurnSecondsLeft = END_TURN_TIMEOUT_SEC;
            updateEndTurnButtonLabel();
            endTurnTimerInterval = setInterval(() => {
                const currentMode = getActiveTurnTimerMode();
                if (!currentMode || currentMode !== endTurnTimerMode) {
                    syncEndTurnTimer();
                    return;
                }
                // Only count down when the player is idle (no open modals and no mouse/keyboard/touch activity)
                if (isManagementModalOpen() || (Date.now() - lastUserActivityAt) < 1000) {
                    endTurnSecondsLeft = END_TURN_TIMEOUT_SEC;
                    updateEndTurnButtonLabel();
                    return;
                }
                endTurnSecondsLeft -= 1;
                if (endTurnSecondsLeft <= 0) {
                    const firedMode = endTurnTimerMode;
                    clearEndTurnTimer();
                    if (firedMode === 'ROLL') {
                        hideYourTurnPopup();
                        sendWsMessage({ action: 'ROLL_DICE' });
                    } else {
                        closeModal('modal-card');
                        sendWsMessage({ action: 'END_TURN' });
                    }
                } else {
                    updateEndTurnButtonLabel();
                }
            }, 1000);
        } else {
            updateEndTurnButtonLabel();
        }
    }

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

    // In-memory Image Preload Cache for all 28 Property Deeds & 32 Chance/Community Chest Cards
    const preloadedCardImages = {};

    function preloadImageUrl(relPath) {
        if (!relPath) return null;
        const resolved = resolveUrl(relPath);
        if (!preloadedCardImages[resolved]) {
            const img = new Image();
            img.decoding = 'async';
            img.src = resolved;
            preloadedCardImages[resolved] = img;
        }
        return preloadedCardImages[resolved];
    }

    function isImageReady(relPath) {
        if (!relPath) return false;
        const resolved = resolveUrl(relPath);
        const img = preloadedCardImages[resolved];
        return !!(img && img.complete && img.naturalWidth > 0);
    }

    function preloadAllCardAssets() {
        const urls = [];
        // 1. All 28 Property Deed Cards
        Object.values(DEED_CARD_IMAGES).forEach(p => urls.push(p));
        // 2. All 16 Ereigniskarten & 16 Gemeinschaftskarten
        for (let i = 1; i <= 16; i++) {
            const num = String(i).padStart(2, '0');
            urls.push(`static/assets/chance_chest/cards/ereignis_${num}.png`);
            urls.push(`static/assets/chance_chest/cards/gemeinschaft_${num}.png`);
        }
        // 3. Fallback Uncle Pennybags illustrations & token icons
        [
            'illustration_monopoly_mann.png',
            'illustration_gefaengnis.png',
            'illustration_gefaengnisausbruch.png',
            'illustration_zahlen.png',
            'illustration_geschenk.png',
            'illustration_renovierung_bau.png',
            'illustration_rennen.png',
            'illustration_daumen_hoch.png',
            'illustration_ueberraschung.png'
        ].forEach(f => urls.push(`static/assets/chance_chest/${f}`));
        TOKENS.forEach(t => { if (t.iconImg) urls.push(t.iconImg); });

        // Stagger preloading slightly so initial WebSocket & 3D board load stays priority #1
        let idx = 0;
        function loadBatch() {
            const end = Math.min(idx + 6, urls.length);
            for (; idx < end; idx++) {
                preloadImageUrl(urls[idx]);
            }
            if (idx < urls.length) {
                setTimeout(loadBatch, 40);
            }
        }
        setTimeout(loadBatch, 150);
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

        // Room ID from URL query ?room=XYZ or ?lobby=XYZ or ?party=XYZ (null if none -> show Room Selector!)
        const urlRoom = window.__INITIAL_ROOM_ID__ || getQueryParam('room') || getQueryParam('lobby') || getQueryParam('party') || getQueryParam('roomId');
        roomId = urlRoom ? urlRoom.trim().toUpperCase() : null;
        window.__INITIAL_ROOM_ID__ = roomId;

        const headerRoomCode = document.getElementById('header-room-code');
        if (headerRoomCode) headerRoomCode.textContent = roomId || 'WAHL';
        const lobbyRoomCode = document.getElementById('lobby-room-code');
        if (lobbyRoomCode) lobbyRoomCode.textContent = roomId || '------';

        // Notify parent hub window if embedded in iframe
        try {
            if (window.parent && window.parent !== window && roomId) {
                window.parent.postMessage({ type: 'MONOPOLY_READY', roomId: roomId, playerId: playerId }, '*');
            }
        } catch (e) {}
    }

    let openRoomsPollInterval = null;
    let openRoomsAnimInterval = null;

    function stopOpenRoomsPolling() {
        if (openRoomsPollInterval) {
            clearInterval(openRoomsPollInterval);
            openRoomsPollInterval = null;
        }
        if (openRoomsAnimInterval) {
            clearInterval(openRoomsAnimInterval);
            openRoomsAnimInterval = null;
        }
    }

    function tickOpenRoomsExpiryBars() {
        const now = Date.now();
        document.querySelectorAll('.mono-room-expiry-bar').forEach(bar => {
            const target = parseInt(bar.getAttribute('data-expires-at') || '0', 10);
            const ttl = parseInt(bar.getAttribute('data-ttl') || '60000', 10);
            if (!target) return;
            const remMs = Math.max(0, target - now);
            const pct = Math.max(0, Math.min(100, (remMs / ttl) * 100));
            bar.style.width = `${pct}%`;
            bar.style.background = remMs <= 15000 ? '#ef4444' : (remMs <= 30000 ? '#f59e0b' : '#2ecc71');
            const badge = bar.parentElement && bar.parentElement.parentElement
                ? bar.parentElement.parentElement.querySelector('.mono-room-expiry-sec')
                : null;
            if (badge) {
                badge.textContent = `⏳ ${Math.ceil(remMs / 1000)}s`;
                badge.style.color = remMs <= 15000 ? '#f87171' : '#fbbf24';
            }
        });
    }

    async function refreshOpenRooms() {
        const listEl = document.getElementById('open-rooms-list');
        if (!listEl) return;
        try {
            const resp = await fetch(resolveUrl('api/rooms'), { cache: 'no-store' });
            const data = await resp.json();
            const rooms = (data && data.rooms) ? data.rooms : [];
            if (rooms.length === 0) {
                listEl.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:14px;">Aktuell keine offenen Räume – erstelle oben einfach einen neuen Raum!</div>`;
                return;
            }
            const now = Date.now();
            listEl.innerHTML = rooms.map(r => {
                const isLobby = (r.status === 'LOBBY');
                const statusBadge = isLobby
                    ? `<span style="font-size:10px; background:#2ecc71; color:#000; padding:2px 6px; border-radius:4px; font-weight:800;">LOBBY</span>`
                    : `<span style="font-size:10px; background:#e67e22; color:#fff; padding:2px 6px; border-radius:4px; font-weight:800;">LÄUFT</span>`;
                const hasExpiry = typeof r.remaining_ms === 'number' && r.remaining_ms > 0;
                const ttl = r.ttl_ms || 60000;
                const targetTs = hasExpiry ? (now + r.remaining_ms) : 0;
                const remSec = hasExpiry ? Math.ceil(r.remaining_ms / 1000) : 0;
                const pct = hasExpiry ? Math.max(0, Math.min(100, (r.remaining_ms / ttl) * 100)) : 100;
                const expiryBadge = hasExpiry
                    ? `<span class="mono-room-expiry-sec" style="font-size:10px; font-weight:700; color:#fbbf24; background:rgba(245,158,11,0.14); padding:2px 6px; border-radius:4px;">⏳ ${remSec}s</span>`
                    : '';
                const expiryBar = hasExpiry
                    ? `<div style="width:100%; height:3px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden; margin-top:4px;">
                           <div class="mono-room-expiry-bar" data-expires-at="${targetTs}" data-ttl="${ttl}" style="width:${pct}%; height:100%; background:#2ecc71; transition:width 0.2s linear, background-color 0.3s ease;"></div>
                       </div>`
                    : '';
                return `
                    <div class="lobby-player-row" style="padding:8px 10px; flex-direction:column; align-items:stretch; gap:4px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                            <div style="display:flex; flex-direction:column; gap:2px;">
                                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    <strong style="color:var(--accent-gold); font-size:14px; letter-spacing:1px;">#${r.room_id}</strong>
                                    ${statusBadge}
                                    <span style="font-size:12px; color:#cbd5e1;">Host: <strong>${r.host_name}</strong></span>
                                    ${expiryBadge}
                                </div>
                                <div style="font-size:11px; color:var(--text-muted);">
                                    👥 ${r.player_count} Spieler (${(r.players || []).join(', ')})
                                </div>
                            </div>
                            <button class="btn-action btn-buy" style="font-size:12px; padding:6px 12px;" onclick="window.MonopolyGame.connectToRoom('${r.room_id}')">
                                Beitreten →
                            </button>
                        </div>
                        ${expiryBar}
                    </div>
                `;
            }).join('');
        } catch (err) {
            listEl.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:12px;">Räume konnten nicht geladen werden.</div>`;
        }
    }

    function showRoomSelector() {
        if (socket) {
            try {
                socket.onclose = null;
                socket.close();
            } catch (e) {}
            socket = null;
        }
        roomId = null;
        gameState = null;
        window.__INITIAL_ROOM_ID__ = null;
        try {
            window.history.replaceState({}, '', window.location.pathname);
        } catch (e) {}

        const titleEl = document.getElementById('lobby-modal-title');
        if (titleEl) titleEl.textContent = 'Monopoly 3D — Raum wählen';

        const chipEl = document.getElementById('lobby-room-chip');
        if (chipEl) chipEl.style.display = 'none';

        const switchBtn = document.getElementById('btn-switch-room');
        if (switchBtn) switchBtn.style.display = 'none';

        const headerRoomCode = document.getElementById('header-room-code');
        if (headerRoomCode) headerRoomCode.textContent = 'WAHL';

        const stepSelect = document.getElementById('lobby-step-select');
        const stepRoom = document.getElementById('lobby-step-room');
        if (stepSelect) stepSelect.style.display = 'flex';
        if (stepRoom) stepRoom.style.display = 'none';

        const welcomeNameInput = document.getElementById('input-welcome-name');
        if (welcomeNameInput) welcomeNameInput.value = playerName;

        openModal('modal-lobby');
        refreshOpenRooms();
        stopOpenRoomsPolling();
        openRoomsPollInterval = setInterval(refreshOpenRooms, 3000);
        openRoomsAnimInterval = setInterval(tickOpenRoomsExpiryBars, 200);
    }

    function showRoomLobbyStep() {
        stopOpenRoomsPolling();
        const titleEl = document.getElementById('lobby-modal-title');
        if (titleEl) titleEl.textContent = 'Monopoly Spiellobby';

        const chipEl = document.getElementById('lobby-room-chip');
        if (chipEl) chipEl.style.display = 'inline-flex';

        const switchBtn = document.getElementById('btn-switch-room');
        if (switchBtn) switchBtn.style.display = 'inline-flex';

        const stepSelect = document.getElementById('lobby-step-select');
        const stepRoom = document.getElementById('lobby-step-room');
        if (stepSelect) stepSelect.style.display = 'none';
        if (stepRoom) stepRoom.style.display = 'flex';

        const headerRoomCode = document.getElementById('header-room-code');
        if (headerRoomCode) headerRoomCode.textContent = roomId || '------';
        const lobbyRoomCode = document.getElementById('lobby-room-code');
        if (lobbyRoomCode) lobbyRoomCode.textContent = roomId || '------';

        const nameInput = document.getElementById('input-player-name');
        if (nameInput) nameInput.value = playerName;
    }

    function connectToRoom(targetRoomId) {
        const cleanCode = (targetRoomId || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (!cleanCode) return;

        const welcomeNameInput = document.getElementById('input-welcome-name');
        if (welcomeNameInput && welcomeNameInput.value.trim()) {
            playerName = welcomeNameInput.value.trim();
            try { localStorage.setItem('monopoly_player_name', playerName); } catch (e) {}
        }

        if (socket) {
            try {
                socket.onclose = null;
                socket.close();
            } catch (e) {}
            socket = null;
        }

        roomId = cleanCode;
        window.__INITIAL_ROOM_ID__ = roomId;
        try {
            const newUrl = window.location.pathname + '?room=' + roomId;
            window.history.replaceState({ path: newUrl }, '', newUrl);
        } catch (e) {}

        showRoomLobbyStep();
        openModal('modal-lobby');
        connectWebSocket();
    }

    function createNewRoom() {
        const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        connectToRoom(newCode);
    }

    function joinRoomByInput() {
        const codeInput = document.getElementById('input-join-room-code');
        if (!codeInput) return;
        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
            codeInput.focus();
            return;
        }
        connectToRoom(code);
    }

    // Connect WebSocket
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
            console.log('WebSocket connected to room', roomId);
            // Join message
            sendWsMessage({
                action: 'JOIN',
                name: playerName,
                token: selectedToken,
                color: selectedColor,
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

        if (msg.type === 'ROOM_EXPIRED') {
            showToast(msg.message || 'Raum wurde nach 60s Inaktivität automatisch geschlossen.', 'warning');
            showRoomSelector();
            return;
        }

        if (msg.type === 'DICE_ROLLED') {
            isTokenInTransit = true;
            clearEndTurnTimer();
        } else if (msg.type === 'CARD_APPLIED') {
            if (msg.result && msg.result.moved && !(msg.result.player && msg.result.player.in_jail)) {
                isTokenInTransit = true;
            }
            clearEndTurnTimer();
        }

        if (msg.state) {
            const prevState = gameState;
            const wasMyTurn = (prevState && prevState.status === 'PLAYING' && prevState.current_player && prevState.current_player.id === playerId);
            const prevRolled = prevState ? !!prevState.rolled : false;
            gameState = msg.state;
            if (msg.state.squares) squaresData = msg.state.squares;
            const nowMyTurn = (gameState && gameState.status === 'PLAYING' && gameState.current_player && gameState.current_player.id === playerId);

            updateLobbyUI();
            if (!isTokenInTransit) {
                updateHUD();
            } else {
                const btnRoll = document.getElementById('btn-roll');
                if (btnRoll) {
                    btnRoll.disabled = true;
                    btnRoll.classList.remove('can-roll');
                }
                const btnEnd = document.getElementById('btn-end-turn');
                if (btnEnd) {
                    btnEnd.disabled = true;
                }
            }

            if (nowMyTurn && !wasMyTurn) {
                showYourTurnPopup('DU BIST DRAN!', 'Würfle jetzt oder verwalte deine Straßen');
            } else if (nowMyTurn && wasMyTurn && prevRolled && !gameState.rolled && msg.type !== 'DICE_ROLLED' && msg.type !== 'CARD_APPLIED') {
                showYourTurnPopup('PASCH! NOCHMAL DRAN!', 'Du darfst direkt noch einmal würfeln!');
            } else if (!nowMyTurn) {
                hideYourTurnPopup();
            }

            // Sync 3D Board
            if (window.MonopolyBoard3D) {
                if (!isTokenInTransit) {
                    window.MonopolyBoard3D.syncPlayers(gameState.players);
                }
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
                closeModal('modal-gameover');
                if (Sound) Sound.playMoney();
            }

            // Detect Game Over / Victory
            if (gameState.status === 'GAME_OVER') {
                clearEndTurnTimer();
                hideYourTurnPopup();
                const wasGameOver = (prevState && prevState.status === 'GAME_OVER');
                const winObj = gameState.winner || (gameState.players ? gameState.players.find(p => !p.is_bankrupt) : null);
                if (!wasGameOver && Sound) {
                    if (winObj && winObj.id === playerId && Sound.playWin) {
                        Sound.playWin();
                    } else if (Sound.playLose) {
                        Sound.playLose();
                    }
                }
                showGameOverModal();
            } else {
                closeModal('modal-gameover');
            }

            // Hub embedding notification
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'MONOPOLY_UPDATE', state: gameState, event: msg.type }, '*');
            }
        }

        switch (msg.type) {
            case 'GAME_STARTED':
                closeModal('modal-lobby');
                closeModal('modal-gameover');
                if (Sound) Sound.playMoney();
                break;

            case 'LOBBY_RESET':
                closeModal('modal-gameover');
                openModal('modal-lobby');
                break;

            case 'DICE_ROLLED':
                handleDiceRollEvent(msg.result);
                break;

            case 'CARD_APPLIED':
                handleCardAppliedEvent(msg.result);
                break;

            case 'TURN_ENDED':
                clearEndTurnTimer();
                clearBuyOrAuctionTimer();
                break;

            case 'PROPERTY_BOUGHT':
                if (Sound) Sound.playMoney();
                clearBuyOrAuctionTimer();
                closeModal('modal-deed');
                resetEndTurnTimer();
                break;

            case 'AUCTION_UPDATED':
                clearBuyOrAuctionTimer();
                closeModal('modal-deed');
                if (gameState && gameState.auction_state) {
                    showAuctionModal();
                } else {
                    clearAuctionCountdownTicker();
                    closeModal('modal-auction');
                    if (msg.result && msg.result.sold && msg.result.winner) {
                        if (Sound) Sound.playMoney();
                        const sqTitle = (msg.result.square && msg.result.square.name) ? msg.result.square.name : 'das Grundstück';
                        showYourTurnPopup(
                            '🔨 ZUM DRITTEN – VERKAUFT!',
                            `${msg.result.winner.name} ersteigert ${sqTitle} für ${msg.result.amount} DM!`
                        );
                    } else if (msg.result && msg.result.auction_ended && msg.result.square) {
                        showYourTurnPopup(
                            '🔨 KEINE GEBOTE',
                            `${msg.result.square.name} bleibt unverkauft bei der Bank.`
                        );
                    } else if (Sound) {
                        Sound.playMoney();
                    }
                }
                syncEndTurnTimer();
                break;

            case 'TAX_PAID':
                if (Sound) Sound.playMoney();
                closeModal('modal-tax');
                syncEndTurnTimer();
                break;

            case 'HOUSE_BUILT':
                if (msg.result && msg.result.error) {
                    if (!msg.result.actor_id || msg.result.actor_id === playerId) {
                        showDeedErrorBanner(msg.result.error, '⚠️ HAUSBAU NICHT MÖGLICH');
                    }
                } else {
                    if (Sound) Sound.playBuild();
                    closeModal('modal-deed');
                    resetEndTurnTimer();
                }
                break;

            case 'HOUSE_SOLD':
                if (msg.result && msg.result.error) {
                    if (!msg.result.actor_id || msg.result.actor_id === playerId) {
                        showDeedErrorBanner(msg.result.error, '⚠️ VERKAUF NICHT MÖGLICH');
                    }
                } else {
                    if (Sound) Sound.playMoney();
                    closeModal('modal-deed');
                    resetEndTurnTimer();
                }
                break;

            case 'MORTGAGE_TOGGLED':
                if (msg.result && msg.result.error) {
                    if (!msg.result.actor_id || msg.result.actor_id === playerId) {
                        showDeedErrorBanner(msg.result.error, '⚠️ HYPOTHEK NICHT MÖGLICH');
                    }
                } else {
                    if (Sound) Sound.playMoney();
                    closeModal('modal-deed');
                    resetEndTurnTimer();
                }
                break;

            case 'BAIL_PAID':
                if (msg.result && msg.result.error) {
                    if (!msg.result.actor_id || msg.result.actor_id === playerId) {
                        showYourTurnPopup('⚠️ KAUTION NICHT MÖGLICH', msg.result.error);
                    }
                } else {
                    if (Sound) Sound.playMoney();
                }
                break;

            case 'JAIL_CARD_USED':
                if (msg.result && msg.result.error) {
                    if (!msg.result.actor_id || msg.result.actor_id === playerId) {
                        showYourTurnPopup('⚠️ KARTE NICHT EINLÖSBAR', msg.result.error);
                    }
                } else {
                    if (Sound) Sound.playCard();
                    closeModal('modal-deed');
                }
                break;

            case 'WENT_TO_JAIL':
                if (Sound) Sound.playJail();
                syncEndTurnTimer();
                break;

            case 'CARD':
                if (!isTokenInTransit && msg.card) {
                    const dDeck = msg.card || msg.deck ? (msg.deck || 'Ereignis') : 'Ereignis';
                    const dText = msg.card.text;
                    const dImg = msg.card.image || msg.card.card_image_filename;
                    const drawerName = msg.player || (gameState && gameState.current_player && gameState.current_player.name) || '';
                    const engine = window.MonopolyBoard3D || Board3D;
                    if (engine && engine.showDrawnCard) {
                        engine.showDrawnCard(dDeck, dText, dImg);
                    }
                    showCardModal(dDeck, dText, dImg, true, drawerName);
                }
                break;

            case 'TRADE_PROPOSED':
                if (msg.result && msg.result.error) {
                    if (!msg.result.actor_id || msg.result.actor_id === playerId) {
                        showYourTurnPopup('⚠️ HANDEL UNGÜLTIG', msg.result.error);
                    }
                } else if (msg.state && msg.state.pending_trade) {
                    const trade = msg.state.pending_trade;
                    if (trade.target_id === playerId) {
                        showIncomingTradeModal(trade);
                    }
                }
                break;

            case 'TRADE_ACCEPTED':
                if (Sound) Sound.playMoney();
                closeModal('modal-incoming-trade');
                resetEndTurnTimer();
                break;

            case 'TRADE_REJECTED':
                closeModal('modal-incoming-trade');
                resetEndTurnTimer();
                break;

            case 'ANIM_CONFIG_UPDATED':
                if (msg.anim_config && window.MonopolyBoard3D && window.MonopolyBoard3D.setAnimConfig) {
                    window.MonopolyBoard3D.setAnimConfig(msg.anim_config, true);
                    syncDebugModalSliders();
                }
                break;
        }

        // Sync active Auction or Tax modal state
        if (gameState && gameState.auction_state) {
            showAuctionModal();
        } else {
            clearAuctionCountdownTicker();
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
        if (!isTokenInTransit && gameState && gameState.pending_action && (gameState.pending_action.type === 'CARD_DRAWN' || gameState.pending_action.type === 'CARD')) {
            const cAct = gameState.pending_action;
            const cImg = cAct.card ? (cAct.card.image || cAct.card.card_image_filename) : null;
            const engine = window.MonopolyBoard3D || Board3D;
            if (engine && engine.showDrawnCard) {
                engine.showDrawnCard(cAct.deck, (cAct.card && cAct.card.text) || '', cImg);
            }
        }
    }

    function confirmCard() {
        clearCardModalTimer();
        closeModal('modal-card');
        const isMyTurn = (gameState && gameState.current_player && gameState.current_player.id === playerId);
        if (isMyTurn && gameState && gameState.pending_action && gameState.pending_action.type === 'CARD_DRAWN') {
            sendWsMessage({ action: 'CONFIRM_CARD' });
        }
    }

    function handleCardAppliedEvent(res) {
        if (!res || res.error) {
            isTokenInTransit = false;
            updateHUD();
            return;
        }
        clearCardModalTimer();
        closeModal('modal-card');

        const isMyTurn = (res.player && res.player.id === playerId);

        function finishAfterCardEffect() {
            isTokenInTransit = false;
            if (window.MonopolyBoard3D && gameState) {
                window.MonopolyBoard3D.syncPlayers(gameState.players);
            }
            if (res.passed_go && Sound) {
                Sound.playPassGo ? Sound.playPassGo() : Sound.playMoney();
            } else if (!res.moved && Sound) {
                Sound.playMoney();
            }

            if (res.action) {
                if (res.action.type === 'CARD_DRAWN' || res.action.type === 'CARD') {
                    const cCard = res.action.card || res.action;
                    const cDeck = res.action.deck || 'Ereignis';
                    const cText = (cCard && cCard.text) ? cCard.text : '';
                    const cImg = cCard ? (cCard.image || cCard.card_image_filename) : null;
                    const drawerName = res.action.player || (res.player && res.player.name) || '';
                    const engine = window.MonopolyBoard3D || Board3D;
                    if (engine && engine.showDrawnCard) {
                        engine.showDrawnCard(cDeck, cText, cImg);
                    }
                    showCardModal(cDeck, cText, cImg, true, drawerName);
                } else if (res.action.type === 'RENT_PAID') {
                    showRentPopup(res.action, res.player);
                } else if (res.action.type === 'BUY_OR_AUCTION') {
                    if (isMyTurn && res.action.square) {
                        showDeedModal(res.action.square.index);
                    }
                } else if (res.action.type === 'TAX_CHOICE') {
                    if (isMyTurn) {
                        showTaxChoiceModal(res.action);
                    }
                } else if (res.action.type === 'WENT_TO_JAIL') {
                    if (Sound) Sound.playJail();
                    showYourTurnPopup(
                        '🚔 AB INS GEFÄNGNIS!',
                        isMyTurn ? 'Du wanderst direkt ins Gefängnis!' : `${res.player.name} wandert direkt ins Gefängnis!`
                    );
                }
            }

            if (isMyTurn && gameState && !gameState.rolled && !(res.player && res.player.in_jail) && (!res.action || res.action.type !== 'CARD_DRAWN')) {
                showYourTurnPopup('PASCH! NOCHMAL DRAN!', 'Du hast einen Pasch gewürfelt und darfst direkt nochmal!');
            }

            updateHUD();
            syncEndTurnTimer();
        }

        if (res.moved && Board3D && !(res.player && res.player.in_jail)) {
            isTokenInTransit = true;
            Board3D.animateMoveToken(res.player.id, res.old_pos, res.new_pos, () => {
                finishAfterCardEffect();
            }, true);
        } else {
            finishAfterCardEffect();
        }
    }

    // Dice Roll & Animated Token Hop sequence
    function handleDiceRollEvent(res) {
        if (!res || !res.dice) {
            isTokenInTransit = false;
            updateHUD();
            return;
        }
        const [d1, d2] = res.dice;
        const isMyTurn = (res.player && res.player.id === playerId);
        isTokenInTransit = true;
        clearEndTurnTimer();
        closeModal('modal-card');

        const drawnCardObj = (res.action && (res.action.type === 'CARD_DRAWN' || res.action.type === 'CARD'))
            ? res.action
            : (res.action && res.action.drawn_card ? res.action.drawn_card : null);
        let cardModalShownForRoll = false;

        function presentDrawnCardIfAny() {
            if (!drawnCardObj || cardModalShownForRoll) return;
            cardModalShownForRoll = true;
            const dDeck = drawnCardObj.deck || 'Ereignis';
            const cardInner = drawnCardObj.card || drawnCardObj;
            const dText = (cardInner && cardInner.text) ? cardInner.text : (drawnCardObj.text || 'Karte');
            const dImg = cardInner ? (cardInner.image || cardInner.card_image_filename || drawnCardObj.image) : null;
            const drawerName = drawnCardObj.player || (res.player && res.player.name) || '';
            const engine = window.MonopolyBoard3D || Board3D;
            if (engine && engine.showDrawnCard) {
                engine.showDrawnCard(dDeck, dText, dImg);
            }
            showCardModal(dDeck, dText, dImg, true, drawerName);
        }

        function finalizeLandingSequence() {
            isTokenInTransit = false;
            if (window.MonopolyBoard3D && gameState) {
                window.MonopolyBoard3D.syncPlayers(gameState.players);
            }
            if (Sound && res.passed_go) {
                Sound.playPassGo ? Sound.playPassGo() : Sound.playMoney();
            }
            if (res.action) {
                presentDrawnCardIfAny();
                if (res.action.type === 'CARD' || res.action.type === 'CARD_DRAWN') {
                    if (res.action.rent_event) {
                        showRentPopup(res.action.rent_event, res.player);
                    }
                } else if (res.action.type === 'RENT_PAID') {
                    showRentPopup(res.action, res.player);
                } else if (res.action.type === 'BUY_OR_AUCTION') {
                    if (isMyTurn && res.action.square) {
                        showDeedModal(res.action.square.index);
                    }
                } else if (res.action.type === 'TAX_CHOICE') {
                    if (isMyTurn) {
                        showTaxChoiceModal(res.action);
                    }
                } else if (res.action.type === 'WENT_TO_JAIL') {
                    if (Sound) Sound.playJail();
                    showYourTurnPopup(
                        '🚔 AB INS GEFÄNGNIS!',
                        isMyTurn ? 'Du wanderst direkt ins Gefängnis!' : `${res.player.name} wandert direkt ins Gefängnis!`
                    );
                }
            } else if (!gameState || !gameState.last_card) {
                if (window.MonopolyBoard3D && window.MonopolyBoard3D.hideDrawnCards) {
                    window.MonopolyBoard3D.hideDrawnCards();
                }
            }
            if (isMyTurn && res.jail_reroll) {
                const rem = 3 - (res.jail_attempt || 1);
                showYourTurnPopup(
                    `🔒 KEIN PASCH (VERSUCH ${res.jail_attempt}/3)`,
                    `Würfle direkt noch einmal! Du hast noch ${rem} ${rem === 1 ? 'Versuch' : 'Versuche'}, um einen Pasch zu schaffen.`
                );
            } else if (isMyTurn && res.jail_attempt === 3 && !res.double && res.player && res.player.in_jail) {
                showYourTurnPopup(
                    '🔒 3x KEIN PASCH',
                    'Alle 3 Versuche verbraucht – du bleibst diese Runde im Gefängnis.'
                );
            } else if (isMyTurn && gameState && !gameState.rolled && d1 === d2 && !(res.player && res.player.in_jail) && (!res.action || res.action.type !== 'CARD_DRAWN')) {
                showYourTurnPopup('PASCH! NOCHMAL DRAN!', 'Du hast einen Pasch gewürfelt und darfst direkt nochmal!');
            }
            updateHUD();
            syncEndTurnTimer();
        }

        if (Board3D) {
            Board3D.rollDice(d1, d2, () => {
                if (res.old_pos !== undefined && res.new_pos !== undefined) {
                    Board3D.animateMoveToken(res.player.id, res.old_pos, res.new_pos, () => {
                        const finalPos = (res.final_pos !== undefined) ? res.final_pos : (res.player ? res.player.position : res.new_pos);
                        if (finalPos !== res.new_pos) {
                            presentDrawnCardIfAny();
                            if (res.player && res.player.in_jail) {
                                // Directly move token into Jail immediately after landing on tile 30
                                finalizeLandingSequence();
                            } else {
                                Board3D.animateMoveToken(res.player.id, res.new_pos, finalPos, () => {
                                    finalizeLandingSequence();
                                }, true);
                            }
                        } else {
                            finalizeLandingSequence();
                        }
                    }, true);
                } else {
                    // e.g. 3 doubles in a row -> straight to jail, or stayed in jail
                    if (res.double && res.player && res.player.in_jail) {
                        if (Sound) Sound.playJail();
                        showYourTurnPopup(
                            '🚔 3x PASCH = GEFÄNGNIS!',
                            isMyTurn ? '3x Pasch! Du gehst direkt ins Gefängnis!' : `${res.player.name} geht wegen 3x Pasch ins Gefängnis!`
                        );
                    }
                    finalizeLandingSequence();
                }
            }, true);
        } else {
            finalizeLandingSequence();
        }
    }

    // UI Updates: Lobby
    function updateLobbyUI() {
        if (!gameState) return;

        // Check status
        if (gameState.status === 'LOBBY') {
            showRoomLobbyStep();
            openModal('modal-lobby');
        } else {
            stopOpenRoomsPolling();
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

        const myPlayer = gameState.players.find(p => p.id === playerId);
        if (myPlayer) {
            if (myPlayer.token && myPlayer.token !== selectedToken) {
                selectedToken = myPlayer.token;
            }
            if (myPlayer.color && myPlayer.color !== selectedColor) {
                selectedColor = myPlayer.color;
            }
            document.querySelectorAll('.token-choice').forEach(el => {
                el.classList.toggle('selected', el.getAttribute('data-token') === selectedToken);
            });
            document.querySelectorAll('.color-dot-pick').forEach(el => {
                const cAttr = el.getAttribute('data-color');
                el.classList.toggle('selected', cAttr ? cAttr.toLowerCase() === selectedColor.toLowerCase() : el.style.background.includes(selectedColor));
            });
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
                const sqName = (p.position === 10 && !p.in_jail)
                    ? 'Gefängnis (Nur zu Besuch)'
                    : (squaresData[p.position] ? squaresData[p.position].name : 'LOS');
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
            const jailCardCount = (targetViewPlayer && targetViewPlayer.jail_cards) ? parseInt(targetViewPlayer.jail_cards) || 0 : 0;

            if (tableRackCount) {
                tableRackCount.textContent = `${ownedList.length} Grundstücke${jailCardCount > 0 ? ` + ${jailCardCount} 🗝️` : ''}`;
            }

            if (ownedList.length === 0 && jailCardCount === 0) {
                tableCardsScroll.innerHTML = `<div class="table-empty-hint">${isViewingMe ? 'Noch keine Straßen im Besitz. Ziehe über das Spielfeld, um Straßen zu erwerben!' : 'Dieser Spieler besitzt noch keine Straßen.'}</div>`;
            } else {
                ownedList.sort((a, b) => a.idx - b.idx);
                const streetCardsHtml = ownedList.map(item => {
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

                let jailCardsHtml = '';
                for (let j = 0; j < jailCardCount; j++) {
                    const barCol = (j % 2 === 0) ? '#f39c12' : '#3498db';
                    jailCardsHtml += `
                        <div class="table-mini-card" style="border-color:rgba(241,196,15,0.5); background:rgba(241,196,15,0.1);" onclick="window.MonopolyGame.showOwnedJailCardModal('${activeViewId}', ${j})" title="Du kommst aus dem Gefängnis frei! (Klicken zum Ansehen / Einlösen)">
                            <div class="table-mini-card-bar" style="background:${barCol};"></div>
                            <div class="table-mini-card-name">🗝️ Gefängnisfrei</div>
                            <div class="table-mini-card-houses"><span style="font-size:9px; color:#f1c40f; font-weight:800;">KARTE</span></div>
                        </div>
                    `;
                }

                tableCardsScroll.innerHTML = streetCardsHtml + jailCardsHtml;
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
            const pendingCard = (gameState.pending_action && gameState.pending_action.type === 'CARD_DRAWN');
            const canRoll = isMyTurn && !gameState.rolled && !isTokenInTransit && !pendingCard && !gameState.auction_state && (!myPlayer || !myPlayer.is_bankrupt);
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
            const blockedByPending = (pendingType === 'BUY_OR_AUCTION' || pendingType === 'TAX_CHOICE' || pendingType === 'CARD_DRAWN' || !!gameState.auction_state);
            const inDebt = (myPlayer && myPlayer.money < 0);
            const canEnd = isMyTurn && gameState.rolled && !isTokenInTransit && !blockedByPending && !inDebt;
            btnEnd.disabled = !canEnd;
        }

        // Jail actions (only BEFORE first roll attempt of the turn)
        if (btnBail && myPlayer) {
            const canBail = isMyTurn && !gameState.rolled && !(myPlayer.jail_rolls_this_turn > 0) && myPlayer.in_jail && myPlayer.money >= 50;
            btnBail.style.display = canBail ? 'inline-flex' : 'none';
        }
        if (btnJailCard && myPlayer) {
            const canCard = isMyTurn && !gameState.rolled && !(myPlayer.jail_rolls_this_turn > 0) && myPlayer.in_jail && myPlayer.jail_cards > 0;
            btnJailCard.style.display = canCard ? 'inline-flex' : 'none';
        }

        syncBuyOrAuctionTimer();
        syncEndTurnTimer();
    }

    function clearAuctionCountdownTicker() {
        if (auctionCountdownInterval) {
            clearInterval(auctionCountdownInterval);
            auctionCountdownInterval = null;
        }
        lastAuctionBidSeq = null;
        lastAuctionSqIdx = null;
        auctionTimeoutSentForSeq = null;
    }

    function updateAuctionCountdownUI() {
        if (!gameState || !gameState.auction_state) return;
        const auc = gameState.auction_state;
        const boxEl = document.getElementById('auction-hammer-box');
        const textEl = document.getElementById('auction-hammer-text');
        const barEl = document.getElementById('auction-hammer-bar');
        if (!boxEl || !textEl || !barEl) return;

        const msLeft = Math.max(0, auctionDeadlineMs - Date.now());
        const secLeft = Math.ceil(msLeft / 1000);
        const pct = Math.max(0, Math.min(100, (msLeft / 5000) * 100));

        let label = '';
        let color = '#2ecc71';
        let border = 'rgba(46, 204, 113, 0.45)';

        if (msLeft <= 0) {
            label = (auc.high_bid > 0) ? '🎉 ZUM DRITTEN – VERKAUFT!' : '🔨 Keine Gebote – Zurück an die Bank!';
            color = '#e74c3c';
            border = 'rgba(231, 76, 60, 0.9)';
        } else if (secLeft === 1) {
            label = '🔨🔨🔨 Zum Dritten... (1s)';
            color = '#e74c3c';
            border = 'rgba(231, 76, 60, 0.9)';
        } else if (secLeft === 2) {
            label = '🔨🔨 Zum Zweiten... (2s)';
            color = '#e67e22';
            border = 'rgba(230, 126, 34, 0.8)';
        } else if (secLeft === 3) {
            label = '🔨 Zum Ersten... (3s)';
            color = '#f1c40f';
            border = 'rgba(241, 196, 15, 0.7)';
        } else {
            label = `⏱️ Gebotszeit läuft... (${secLeft}s)`;
            color = '#2ecc71';
            border = 'rgba(46, 204, 113, 0.45)';
        }

        textEl.textContent = label;
        textEl.style.color = (secLeft <= 3) ? color : '#e2e8f0';
        barEl.style.width = `${pct}%`;
        barEl.style.background = color;
        boxEl.style.borderColor = border;

        const curSeq = auc.bid_seq || 1;
        if (msLeft <= 0 && (Date.now() - auctionDeadlineMs) > 350 && auctionTimeoutSentForSeq !== curSeq) {
            auctionTimeoutSentForSeq = curSeq;
            sendWsMessage({ action: 'AUCTION_TIMEOUT' });
        }
    }

    function startAuctionCountdownTicker() {
        if (!auctionCountdownInterval) {
            auctionCountdownInterval = setInterval(updateAuctionCountdownUI, 100);
        }
        updateAuctionCountdownUI();
    }

    // Show Auction Modal (Versteigerung mit 5s "Zum Ersten, zum Zweiten, Verkauft!" Hammer-Countdown)
    function showAuctionModal() {
        if (!gameState || !gameState.auction_state) {
            clearAuctionCountdownTicker();
            closeModal('modal-auction');
            return;
        }
        const auc = gameState.auction_state;
        const sq = auc.square;
        const modalBody = document.getElementById('auction-modal-body');
        if (!modalBody) return;

        const bidSeq = auc.bid_seq || 1;
        if (lastAuctionBidSeq !== bidSeq || lastAuctionSqIdx !== auc.sq_idx || !auctionCountdownInterval) {
            if (lastAuctionBidSeq !== null && lastAuctionBidSeq !== bidSeq && Sound) {
                Sound.playCard();
            }
            lastAuctionBidSeq = bidSeq;
            lastAuctionSqIdx = auc.sq_idx;
            auctionTimeoutSentForSeq = null;
            auctionDeadlineMs = Date.now() + ((auc.timeout_sec || 5) * 1000);
        }

        const myPlayer = gameState.players.find(p => p.id === playerId);
        const amIActive = auc.active_bidders && auc.active_bidders.includes(playerId);
        const highBid = auc.high_bid || 0;
        const highBidder = auc.high_bidder_name || 'Noch kein Gebot';
        const minNextBid = highBid + 10;
        const canAfford10 = myPlayer && myPlayer.money >= highBid + 10;
        const canAfford50 = myPlayer && myPlayer.money >= highBid + 50;

        // Preserve user's custom input if they were typing
        const existingInput = document.getElementById('auction-custom-bid');
        const wasFocused = (existingInput && document.activeElement === existingInput);
        const prevCustomVal = existingInput ? parseInt(existingInput.value) : null;
        const defaultCustomVal = Math.min(myPlayer ? myPlayer.money : minNextBid, minNextBid);
        const customValToUse = (wasFocused && prevCustomVal && prevCustomVal > highBid) ? prevCustomVal : defaultCustomVal;

        const deedImgSrc = DEED_CARD_IMAGES[sq.index];
        const imgHtml = deedImgSrc
            ? `<img src="${resolveUrl(deedImgSrc)}" alt="${sq.name}" style="max-height:155px; border-radius:8px; margin:0 auto 8px auto; display:block;" />`
            : '';

        modalBody.innerHTML = `
            ${imgHtml}
            <div style="text-align:center; margin-bottom:8px;">
                <div style="font-size:16px; font-weight:800;">${sq.name}</div>
                <div style="font-size:12px; color:var(--text-muted);">Regulärer Kaufpreis: ${sq.price} DM</div>
            </div>
            <div id="auction-hammer-box" style="background:rgba(15,23,42,0.75); border:1px solid rgba(46,204,113,0.45); border-radius:10px; padding:8px 12px; margin-bottom:10px; text-align:center; transition:border-color 0.2s;">
                <div id="auction-hammer-text" style="font-size:14px; font-weight:800; letter-spacing:0.3px; margin-bottom:6px; color:#e2e8f0;">
                    ⏱️ Gebotszeit läuft... (5s)
                </div>
                <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
                    <div id="auction-hammer-bar" style="width:100%; height:100%; background:#2ecc71; transition:width 0.1s linear, background 0.2s;"></div>
                </div>
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
                    <input type="number" id="auction-custom-bid" class="chat-input" min="${highBid + 1}" max="${myPlayer ? myPlayer.money : 1500}" value="${customValToUse}" style="flex:1; padding:6px 10px;">
                    <button class="btn-action btn-trade" style="font-size:12px;" onclick="window.MonopolyGame.submitCustomBid()">Bieten</button>
                </div>
                <button class="btn-action" style="width:100%; background:#c0392b; color:#fff;" onclick="window.MonopolyGame.passAuction()">
                    🏳️ Aussteigen (Passen)
                </button>
            ` : `
                <div style="text-align:center; color:var(--text-muted); font-size:13px; padding:8px;">
                    Du bist aus dieser Versteigerung ausgestiegen. Warte auf den Hammer-Zuschlag...
                </div>
            `}
        `;
        if (wasFocused) {
            const newInput = document.getElementById('auction-custom-bid');
            if (newInput) newInput.focus();
        }
        openModal('modal-auction');
        startAuctionCountdownTicker();
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

    // Show Game Over / Victory Modal (Siegerehrung)
    function showGameOverModal() {
        const modalBody = document.getElementById('gameover-modal-body');
        if (!modalBody || !gameState) return;

        const winner = gameState.winner || (gameState.players ? gameState.players.find(p => !p.is_bankrupt) : null) || gameState.current_player;
        if (!winner) return;

        const didIWin = (winner.id === playerId);
        const tObj = TOKENS.find(t => t.id === winner.token) || { icon: '🏆', name: winner.token || 'Spielfigur' };
        const tokenGraphic = tObj.iconImg
            ? `<img src="${resolveUrl(tObj.iconImg)}" alt="${tObj.name}" style="width:52px; height:52px; object-fit:contain;" />`
            : `<span style="font-size:42px;">${tObj.icon}</span>`;

        const propsCount = (winner.properties_count !== undefined)
            ? winner.properties_count
            : (gameState.board_state ? Object.values(gameState.board_state).filter(st => st.owner === winner.id).length : 0);
        const wealth = (winner.wealth !== undefined) ? winner.wealth : winner.money;

        modalBody.innerHTML = `
            <div style="font-size:56px; line-height:1; margin-bottom:8px; filter:drop-shadow(0 6px 18px rgba(241,196,15,0.6));">
                🏆
            </div>
            <div style="font-size:26px; font-weight:900; letter-spacing:0.6px; color:#f1c40f; text-shadow:0 2px 12px rgba(241,196,15,0.45); margin-bottom:6px;">
                ${didIWin ? 'DU HAST GEWONNEN!' : `${winner.name.toUpperCase()} HAT GEWONNEN!`}
            </div>
            <div style="font-size:13px; color:#cbd5e1; margin-bottom:18px; line-height:1.45;">
                ${didIWin
                    ? 'Alle Mitspieler sind bankrott – du bist als Letzter übrig und beherrschst das Monopoly-Imperium!'
                    : `Alle anderen Mitspieler sind bankrott – <strong>${winner.name}</strong> ist als Letzter übrig geblieben!`}
            </div>
            <div style="background:rgba(255,255,255,0.06); border:1px solid rgba(241,196,15,0.35); border-radius:14px; padding:14px 16px; margin-bottom:18px; display:flex; align-items:center; gap:14px; text-align:left;">
                <div style="width:64px; height:64px; border-radius:50%; border:3px solid ${winner.color || '#f1c40f'}; background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    ${tokenGraphic}
                </div>
                <div style="flex:1;">
                    <div style="font-size:17px; font-weight:800; color:#fff; margin-bottom:4px;">
                        ${winner.name} ${didIWin ? '(Du)' : ''}
                    </div>
                    <div style="font-size:12px; color:#94a3b8; display:flex; flex-direction:column; gap:2px;">
                        <span>💵 Bargeld: <strong style="color:#2ecc71;">${(winner.money || 0).toLocaleString('de-DE')} DM</strong></span>
                        <span>🏠 Grundstücke im Besitz: <strong style="color:#f8fafc;">${propsCount}</strong></span>
                        <span>💎 Gesamtvermögen: <strong style="color:#f1c40f;">${(wealth || 0).toLocaleString('de-DE')} DM</strong></span>
                    </div>
                </div>
            </div>
            <button class="btn-action btn-buy" style="width:100%; justify-content:center; font-size:14px; padding:12px;" onclick="window.MonopolyGame.resetToLobby()">
                🔄 Neue Runde (Zurück zur Lobby)
            </button>
        `;
        openModal('modal-gameover');
    }

    // Show Card Modal (Ereignis- / Gemeinschaftskarte with Instant Text Fallback + Cached ROM Graphic)
    function showCardModal(deckType, text, cardImage, playSound = false, drawerName = null) {
        const titleEl = document.getElementById('card-modal-title');
        const subtitleEl = document.getElementById('card-modal-subtitle');
        const captionEl = document.getElementById('card-modal-caption');
        const containerEl = document.getElementById('card-modal-container');
        const textEl = document.getElementById('card-modal-text');
        const imgEl = document.getElementById('card-modal-img');
        const fullCardImgEl = document.getElementById('card-modal-full-img');
        const confirmBtnEl = document.getElementById('btn-card-confirm');

        clearCardModalTimer();

        const isChest = (deckType || '').toLowerCase().includes('gemein');
        if (titleEl) titleEl.textContent = isChest ? 'GEMEINSCHAFTSKARTE' : 'EREIGNISKARTE';

        const activeDrawer = drawerName || (gameState && gameState.last_card && gameState.last_card.player) || '';
        if (subtitleEl) {
            if (activeDrawer) {
                subtitleEl.textContent = `Gezogen von: ${activeDrawer}`;
                subtitleEl.style.display = 'block';
            } else {
                subtitleEl.style.display = 'none';
            }
        }

        const cleanText = (text || '').replace(/£\s*(\d+)/g, '$1 DM');

        // Always populate the instant text card first so there is never a blank loading delay
        if (containerEl) {
            containerEl.className = 'chance-chest-card ' + (isChest ? 'chest' : 'chance');
        }
        if (textEl) textEl.textContent = cleanText;
        if (imgEl) imgEl.src = resolveUrl(getCardIllustration(text));

        if (cardImage && fullCardImgEl) {
            const relCardPath = 'static/assets/chance_chest/cards/' + cardImage;
            const resolvedCardUrl = resolveUrl(relCardPath);
            preloadImageUrl(relCardPath);

            if (captionEl && cleanText) {
                captionEl.textContent = cleanText;
                captionEl.style.display = 'block';
            } else if (captionEl) {
                captionEl.style.display = 'none';
            }

            if (isImageReady(relCardPath)) {
                fullCardImgEl.onload = null;
                fullCardImgEl.src = resolvedCardUrl;
                fullCardImgEl.style.display = 'block';
                if (containerEl) containerEl.style.display = 'none';
            } else {
                // Show crisp text card immediately while the image loads in the background
                fullCardImgEl.style.display = 'none';
                if (containerEl) containerEl.style.display = 'block';
                fullCardImgEl.onload = function() {
                    fullCardImgEl.style.display = 'block';
                    if (containerEl) containerEl.style.display = 'none';
                };
                fullCardImgEl.src = resolvedCardUrl;
            }
        } else {
            if (fullCardImgEl) {
                fullCardImgEl.onload = null;
                fullCardImgEl.style.display = 'none';
            }
            if (captionEl) captionEl.style.display = 'none';
            if (containerEl) containerEl.style.display = 'block';
        }

        const isMyTurn = (gameState && gameState.current_player && gameState.current_player.id === playerId);
        const isPendingCardConfirm = (gameState && gameState.pending_action && gameState.pending_action.type === 'CARD_DRAWN');
        const baseBtnLabel = (isMyTurn && isPendingCardConfirm) ? 'OK — Ausführen' : 'OK';

        cardModalSecondsLeft = CARD_MODAL_TIMEOUT_SEC;
        if (confirmBtnEl) {
            confirmBtnEl.textContent = `${baseBtnLabel} (${cardModalSecondsLeft}s)`;
        }

        openModal('modal-card');
        if (playSound && Sound) Sound.playCard();

        cardModalAutoCloseTimer = setInterval(() => {
            cardModalSecondsLeft -= 1;
            if (cardModalSecondsLeft <= 0) {
                clearCardModalTimer();
                confirmCard();
            } else if (confirmBtnEl) {
                const stillMyTurn = (gameState && gameState.current_player && gameState.current_player.id === playerId);
                const stillPending = (gameState && gameState.pending_action && gameState.pending_action.type === 'CARD_DRAWN');
                const curBase = (stillMyTurn && stillPending) ? 'OK — Ausführen' : 'OK';
                confirmBtnEl.textContent = `${curBase} (${cardModalSecondsLeft}s)`;
            }
        }, 1000);
    }

    function getBuildHouseRestriction(sqIdx) {
        if (!gameState || !squaresData || !squaresData[sqIdx]) return 'Spielfeld-Daten noch nicht geladen.';
        const sq = squaresData[sqIdx];
        if (sq.type !== 'property') return 'Auf Bahnhöfen und Werken können keine Häuser gebaut werden.';
        const st = gameState.board_state ? gameState.board_state[sqIdx] : null;
        if (!st || st.owner !== playerId) return 'Dieses Grundstück gehört dir nicht.';
        if (st.mortgaged) return 'Auf einem mit Hypothek belasteten Grundstück kann nicht gebaut werden!';

        const groupSquares = squaresData.filter(s => s && s.group === sq.group);
        const missingStreets = groupSquares.filter(s => {
            const gst = gameState.board_state ? gameState.board_state[s.index] : null;
            return !gst || gst.owner !== playerId;
        });
        if (missingStreets.length > 0) {
            const missingNames = missingStreets.map(s => s.name).join(', ');
            return `Du musst erst alle Straßen dieser Farbgruppe besitzen! Dir fehlt noch: ${missingNames}.`;
        }

        const mortgagedInGroup = groupSquares.filter(s => {
            const gst = gameState.board_state ? gameState.board_state[s.index] : null;
            return gst && gst.mortgaged;
        });
        if (mortgagedInGroup.length > 0) {
            return `Hausbau nicht möglich, solange eine Straße dieser Farbgruppe mit einer Hypothek belastet ist (${mortgagedInGroup.map(s => s.name).join(', ')})!`;
        }

        const houses = st.houses || 0;
        if (houses >= 5) return 'Auf dieser Straße steht bereits ein Hotel (Maximalausbau)!';

        const minHouses = Math.min(...groupSquares.map(s => {
            const gst = gameState.board_state ? gameState.board_state[s.index] : null;
            return (gst && gst.houses) ? gst.houses : 0;
        }));
        if (houses > minHouses) {
            const laggingNames = groupSquares
                .filter(s => {
                    const gst = gameState.board_state ? gameState.board_state[s.index] : null;
                    return ((gst && gst.houses) ? gst.houses : 0) === minHouses;
                })
                .map(s => s.name)
                .join(', ');
            return `Gleichmäßiges Bauen erforderlich! Baue zuerst auf: ${laggingNames}.`;
        }

        const bankHouses = (gameState.bank_houses !== undefined) ? gameState.bank_houses : 32;
        const bankHotels = (gameState.bank_hotels !== undefined) ? gameState.bank_hotels : 12;
        if (houses < 4 && bankHouses <= 0) {
            return 'Die Bank hat aktuell keine Häuser mehr auf Vorrat (alle 32 Häuser sind verbaut)!';
        }
        if (houses === 4 && bankHotels <= 0) {
            return 'Die Bank hat aktuell keine Hotels mehr auf Vorrat (alle 12 Hotels sind verbaut)!';
        }

        const myPlayer = gameState.players ? gameState.players.find(p => p.id === playerId) : null;
        if (!myPlayer || myPlayer.money < sq.house_cost) {
            return `Nicht genügend Bargeld! Ein ${houses === 4 ? 'Hotel' : 'Haus'} kostet ${sq.house_cost} DM (Du hast ${myPlayer ? myPlayer.money : 0} DM).`;
        }

        return null;
    }

    function getSellHouseRestriction(sqIdx) {
        if (!gameState || !squaresData || !squaresData[sqIdx]) return 'Spielfeld-Daten noch nicht geladen.';
        const sq = squaresData[sqIdx];
        const st = gameState.board_state ? gameState.board_state[sqIdx] : null;
        if (!st || st.owner !== playerId) return 'Dieses Grundstück gehört dir nicht.';
        const houses = st.houses || 0;
        if (houses <= 0) return 'Auf dieser Straße stehen keine Häuser zum Verkaufen.';

        const groupSquares = squaresData.filter(s => s && s.group === sq.group);
        const maxHouses = Math.max(...groupSquares.map(s => {
            const gst = gameState.board_state ? gameState.board_state[s.index] : null;
            return (gst && gst.houses) ? gst.houses : 0;
        }));
        if (houses < maxHouses) {
            const higherNames = groupSquares
                .filter(s => {
                    const gst = gameState.board_state ? gameState.board_state[s.index] : null;
                    return ((gst && gst.houses) ? gst.houses : 0) === maxHouses;
                })
                .map(s => s.name)
                .join(', ');
            return `Gleichmäßiger Abbau erforderlich! Verkaufe zuerst ein Gebäude von: ${higherNames}.`;
        }

        const bankHouses = (gameState.bank_houses !== undefined) ? gameState.bank_houses : 32;
        if (houses === 5 && bankHouses < 4) {
            return `In der Bank sind nur noch ${bankHouses} Häuser verfügbar (4 benötigt, um das Hotel abzubauen).`;
        }

        return null;
    }

    function getMortgageRestriction(sqIdx) {
        if (!gameState || !squaresData || !squaresData[sqIdx]) return 'Spielfeld-Daten noch nicht geladen.';
        const sq = squaresData[sqIdx];
        const st = gameState.board_state ? gameState.board_state[sqIdx] : null;
        if (!st || st.owner !== playerId) return 'Dieses Grundstück gehört dir nicht.';
        const myPlayer = gameState.players ? gameState.players.find(p => p.id === playerId) : null;

        if (!st.mortgaged) {
            if ((st.houses || 0) > 0) {
                return 'Vor einer Hypothek müssen erst alle Häuser auf dieser Straße verkauft werden!';
            }
            const groupSquares = squaresData.filter(s => s && s.group === sq.group);
            const builtInGroup = groupSquares.filter(s => {
                const gst = gameState.board_state ? gameState.board_state[s.index] : null;
                return gst && (gst.houses || 0) > 0;
            });
            if (builtInGroup.length > 0) {
                return `Alle Häuser dieser Farbgruppe müssen zuerst verkauft werden (${builtInGroup.map(s => s.name).join(', ')})!`;
            }
        } else {
            const mortgageVal = sq.mortgage || (sq.price / 2);
            const unmortgageCost = Math.round(mortgageVal * 1.1);
            if (!myPlayer || myPlayer.money < unmortgageCost) {
                return `Nicht genügend Bargeld zum Ablösen der Hypothek (${unmortgageCost} DM inkl. 10% Zinsen benötigt)!`;
            }
        }
        return null;
    }

    function showDeedErrorBanner(message, popupTitle = '⚠️ AKTION NICHT MÖGLICH') {
        const bannerEl = document.getElementById('deed-error-banner');
        if (bannerEl) {
            bannerEl.innerHTML = `<span style="font-size:15px; flex-shrink:0;">⚠️</span><span>${message}</span>`;
            bannerEl.style.display = 'flex';
            bannerEl.style.animation = 'none';
            void bannerEl.offsetWidth;
            bannerEl.style.animation = 'monoShakeError 0.38s ease';
        }
        showYourTurnPopup(popupTitle, message);
    }

    // Show Owned "Du kommst aus dem Gefängnis frei" Card Modal
    function showOwnedJailCardModal(ownerId, jailIdx = 0) {
        const owner = (gameState && gameState.players) ? gameState.players.find(p => p.id === ownerId) : null;
        const isMe = (owner && owner.id === playerId);
        const isMyTurn = (gameState && gameState.current_player && gameState.current_player.id === playerId);

        const titleEl = document.getElementById('deed-modal-title');
        if (titleEl) titleEl.textContent = '🗝️ Gefängnisfrei-Karte';

        const modalBody = document.getElementById('deed-modal-body');
        if (!modalBody) return;

        const isSecond = ((jailIdx || 0) % 2 === 1);
        const cardImgRel = isSecond
            ? 'static/assets/chance_chest/cards/gemeinschaft_16.png'
            : 'static/assets/chance_chest/cards/ereignis_16.png';
        const deckLabel = isSecond ? 'GEMEINSCHAFTSKARTE' : 'EREIGNISKARTE';
        preloadImageUrl(cardImgRel);

        const canUseNow = isMe && owner && owner.in_jail && isMyTurn && (!gameState.pending_action);

        modalBody.innerHTML = `
            <div class="deed-image-wrap" style="display:block; text-align:center;">
                <img class="deed-card-img" src="${resolveUrl(cardImgRel)}" alt="Du kommst aus dem Gefängnis frei" style="width:100%; max-width:340px; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.45);" />
            </div>
            <div style="background:rgba(255,255,255,0.06); padding:10px 14px; border-radius:8px; margin-top:10px; font-size:12px; display:flex; flex-direction:column; gap:5px;">
                <div style="font-weight:800; color:#f1c40f; font-size:13px;">🗝️ Du kommst aus dem Gefängnis frei! (${deckLabel})</div>
                <div style="color:#cbd5e1; line-height:1.4;">Diese Karte liegt offen bei deinen Straßen und darf aufbewahrt werden, bis du sie im Gefängnis einsetzt oder im Handel an einen Mitspieler verkaufst.</div>
                <div style="margin-top:2px; font-weight:700; color:${owner ? owner.color : '#888'};">
                    Besitzer: ${owner ? owner.name + (isMe ? ' (Du)' : '') : 'Spieler'}
                </div>
            </div>
            <div id="deed-error-banner" style="display:none; align-items:center; gap:8px; background:rgba(231,76,60,0.18); border:1px solid rgba(231,76,60,0.55); color:#fecaca; padding:9px 12px; border-radius:8px; margin-top:10px; font-size:12px; font-weight:600; line-height:1.35;"></div>
            <div class="deed-actions-row" style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                ${canUseNow ? `
                    <button class="btn-action btn-buy" style="font-size:13px; padding:8px 12px; flex:1;" onclick="window.MonopolyGame.useJailCardFromModal()">
                        🗝️ Jetzt einlösen (Gefängnis verlassen)
                    </button>
                ` : `
                    <div style="width:100%; font-size:11px; color:var(--text-muted); text-align:center; padding:4px 0;">
                        ${isMe ? (owner && owner.in_jail ? 'Du kannst diese Karte einlösen, sobald du am Zug bist.' : 'Du befindest dich aktuell nicht im Gefängnis. Du kannst die Karte behalten oder über „Handel“ tauschen.') : ''}
                    </div>
                `}
            </div>
        `;

        closeModal('modal-portfolio');
        openModal('modal-deed');
    }

    // Show Besitzurkunde (Property Deed Modal with Instant Text Fallback + Cached ROM Card Graphics)
    function showDeedModal(sqIdx) {
        if (!squaresData || squaresData.length === 0) return;
        const sq = squaresData[sqIdx];
        if (!sq) return;

        // Non-buyable square
        if (!['property', 'station', 'utility'].includes(sq.type)) {
            return;
        }

        const titleEl = document.getElementById('deed-modal-title');
        if (titleEl) titleEl.textContent = 'Besitzrecht-Urkunde';

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
            const secLabel = (buyOrAuctionTimerInterval && buyOrAuctionSecondsLeft > 0) ? buyOrAuctionSecondsLeft : BUY_OR_AUCTION_TIMEOUT_SEC;
            actionsHtml += `
                <button class="btn-action btn-buy" style="font-size:13px; padding:8px 12px; flex:1;" ${canBuy ? '' : 'disabled'} onclick="window.MonopolyGame.buyProperty(${sqIdx})">
                    🏠 Kaufen (${sq.price} DM)
                </button>
                <button id="deed-btn-auction" class="btn-action" style="font-size:13px; padding:8px 12px; flex:1; background:#e67e22; color:#fff;" onclick="window.MonopolyGame.startAuction(${sqIdx})">
                    🔨 Versteigern (${secLabel}s)
                </button>
            `;
        } else if (isMyProperty) {
            const houses = st.houses || 0;
            const isMortgaged = st.mortgaged;

            // Build / Sell buttons (allowed anytime per Parker rules page 3)
            if (sq.type === 'property' && !isMortgaged) {
                const buildRestriction = getBuildHouseRestriction(sqIdx);
                const canSell = houses > 0;
                const buildBtnStyle = buildRestriction
                    ? 'font-size:12px; padding:6px 12px; flex:1; background:rgba(46,204,113,0.22); border:1px solid rgba(46,204,113,0.45); color:#e2e8f0;'
                    : 'font-size:12px; padding:6px 12px; flex:1;';
                if (houses < 5) {
                    actionsHtml += `
                        <button class="btn-action btn-buy" style="${buildBtnStyle}" onclick="window.MonopolyGame.buildHouse(${sqIdx})">
                            🔨 ${houses === 4 ? 'Hotel' : 'Haus'} bauen (${sq.house_cost} DM)
                        </button>
                    `;
                }
                if (canSell) {
                    actionsHtml += `
                        <button class="btn-action" style="font-size:12px; padding:6px 12px; background:#e67e22; color:#fff;" onclick="window.MonopolyGame.sellHouse(${sqIdx})">
                            Verkaufen (+${sq.house_cost / 2} DM)
                        </button>
                    `;
                }
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
                    actionsHtml += `
                        <button class="btn-action" style="font-size:12px; padding:6px 12px; background:#27ae60; color:#fff;" onclick="window.MonopolyGame.toggleMortgage(${sqIdx})">
                            Hypothek ablösen (-${unmortgageCost} DM)
                        </button>
                    `;
                }
            }
        }

        const deedImgSrc = DEED_CARD_IMAGES[sqIdx];
        if (deedImgSrc) preloadImageUrl(deedImgSrc);
        const isDeedCached = deedImgSrc && isImageReady(deedImgSrc);
        const bankHouses = (gameState && gameState.bank_houses !== undefined) ? gameState.bank_houses : 32;
        const bankHotels = (gameState && gameState.bank_hotels !== undefined) ? gameState.bank_hotels : 12;

        const textCardHtml = `
            <div class="deed-card" id="deed-fallback-card" style="display:${isDeedCached ? 'none' : 'block'};">
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

        const imageCardHtml = deedImgSrc ? `
            <div class="deed-image-wrap" id="deed-img-wrap" style="display:${isDeedCached ? 'block' : 'none'};">
                <img class="deed-card-img" id="deed-modal-img-el" src="${resolveUrl(deedImgSrc)}" alt="${sq.name}" />
                ${st && st.mortgaged ? '<div class="mortgage-stamp-overlay">HYPOTHEK</div>' : ''}
            </div>
            <div id="deed-img-meta" style="display:${isDeedCached ? 'flex' : 'none'}; background:rgba(255,255,255,0.06); padding:10px 14px; border-radius:8px; margin-top:10px; font-size:12px; flex-direction:column; gap:4px;">
                <div><strong>Kaufpreis:</strong> ${sq.price} DM | <strong>Hypothekenwert:</strong> ${sq.mortgage || sq.price / 2} DM</div>
                ${sq.house_cost ? `<div><strong>Hausbau:</strong> je ${sq.house_cost} DM ${st && st.houses ? `(Aktuell: ${st.houses === 5 ? 'Hotel' : st.houses + ' Häuser'})` : ''}</div>` : ''}
                ${sq.house_cost ? `<div style="font-size:11px; color:var(--text-muted);">Bank-Vorrat: ${bankHouses} Häuser, ${bankHotels} Hotels</div>` : ''}
                <div style="margin-top:2px; font-weight:700; color:${owner ? owner.color : '#888'};">
                    Besitzer: ${owner ? owner.name + (isMyProperty ? ' (Du)' : '') : 'Niemand (Frei)'}
                    ${st && st.mortgaged ? ' - ⚠️ HYPOTHEK BELASTET' : ''}
                </div>
            </div>
        ` : '';

        modalBody.innerHTML = `
            ${textCardHtml}
            ${imageCardHtml}
            <div id="deed-error-banner" style="display:none; align-items:center; gap:8px; background:rgba(231,76,60,0.18); border:1px solid rgba(231,76,60,0.55); color:#fecaca; padding:9px 12px; border-radius:8px; margin-top:10px; font-size:12px; font-weight:600; line-height:1.35;"></div>
            ${actionsHtml ? `<div class="deed-actions-row" style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">${actionsHtml}</div>` : ''}
        `;

        if (deedImgSrc && !isDeedCached) {
            const imgNode = document.getElementById('deed-modal-img-el');
            if (imgNode) {
                imgNode.onload = function() {
                    const wrap = document.getElementById('deed-img-wrap');
                    const meta = document.getElementById('deed-img-meta');
                    const fallback = document.getElementById('deed-fallback-card');
                    if (wrap) wrap.style.display = 'block';
                    if (meta) meta.style.display = 'flex';
                    if (fallback) fallback.style.display = 'none';
                };
            }
        }

        openModal('modal-deed');
        syncBuyOrAuctionTimer();
    }

    // Show Player Portfolio (All owned streets + Gefängnisfrei cards)
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
        const jailCardCount = parseInt(target.jail_cards) || 0;

        if (ownedSquares.length === 0 && jailCardCount === 0) {
            gridEl.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:20px;">Keine Grundstücke oder Karten im Besitz.</p>`;
        } else {
            const streetsHtml = ownedSquares.map(item => {
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

            let jailCardsHtml = '';
            for (let j = 0; j < jailCardCount; j++) {
                const barCol = (j % 2 === 0) ? '#f39c12' : '#3498db';
                const deckName = (j % 2 === 0) ? 'Ereigniskarte' : 'Gemeinschaftskarte';
                jailCardsHtml += `
                    <div class="portfolio-card-mini" style="border-color:rgba(241,196,15,0.55); background:rgba(241,196,15,0.08);" onclick="window.MonopolyGame.showOwnedJailCardModal('${target.id}', ${j})">
                        <div class="portfolio-mini-header" style="background:${barCol};"></div>
                        <div class="portfolio-mini-body">
                            <div class="portfolio-mini-title">🗝️ Gefängnisfrei</div>
                            <div style="font-size:10px; color:#f1c40f; margin-top:2px; font-weight:700;">${deckName}</div>
                            <div style="font-size:9px; color:var(--text-muted); margin-top:2px;">Klicken zum Ansehen</div>
                        </div>
                    </div>
                `;
            }

            gridEl.innerHTML = streetsHtml + jailCardsHtml;
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
        resetEndTurnTimer();
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('open');
        resetEndTurnTimer();
        syncEndTurnTimer();
    }

    // Public controller API
    const GameClient = {
        init: function() {
            console.log('GameClient.init called!');
            initPlayerIdentity();

            // Preload all 28 Property Deeds & 32 Chance/Chest Cards into memory cache
            preloadAllCardAssets();

            // If URL has ?room=XYZ, connect directly; otherwise show Room Create/Join selector!
            if (roomId) {
                showRoomLobbyStep();
                openModal('modal-lobby');
                connectWebSocket();
            } else {
                showRoomSelector();
            }

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
                    <div class="color-dot-pick ${c === selectedColor ? 'selected' : ''}" data-color="${c}" style="background:${c};" onclick="window.MonopolyGame.selectColor('${c}')"></div>
                `).join('');
            }

            // Bind welcome name input & lobby name input
            const welcomeNameInput = document.getElementById('input-welcome-name');
            const nameInput = document.getElementById('input-player-name');
            if (welcomeNameInput) {
                welcomeNameInput.value = playerName;
                welcomeNameInput.oninput = (e) => {
                    playerName = e.target.value.trim() || 'Spieler';
                    if (nameInput) nameInput.value = playerName;
                    try { localStorage.setItem('monopoly_player_name', playerName); } catch (e) {}
                };
            }
            if (nameInput) {
                nameInput.value = playerName;
                nameInput.oninput = (e) => {
                    playerName = e.target.value.trim() || 'Spieler';
                    if (welcomeNameInput) welcomeNameInput.value = playerName;
                    try { localStorage.setItem('monopoly_player_name', playerName); } catch (e) {}
                    sendWsMessage({ action: 'JOIN', name: playerName, token: selectedToken, color: selectedColor });
                };
            }

            const joinCodeInput = document.getElementById('input-join-room-code');
            if (joinCodeInput) {
                joinCodeInput.onkeydown = (e) => {
                    if (e.key === 'Enter') joinRoomByInput();
                };
            }

            // Copy room link
            const copyBtn = document.getElementById('btn-copy-link');
            if (copyBtn) {
                copyBtn.onclick = () => {
                    if (!roomId) {
                        showRoomSelector();
                        return;
                    }
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
                btnRoll.onclick = () => {
                    hideYourTurnPopup();
                    sendWsMessage({ action: 'ROLL_DICE' });
                };
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
                btnEnd.onclick = () => {
                    clearEndTurnTimer();
                    sendWsMessage({ action: 'END_TURN' });
                };
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

        showRoomSelector: showRoomSelector,
        createNewRoom: createNewRoom,
        joinRoomByInput: joinRoomByInput,
        connectToRoom: connectToRoom,
        refreshOpenRooms: refreshOpenRooms,

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
        showOwnedJailCardModal: showOwnedJailCardModal,
        showPlayerPortfolio: showPlayerPortfolio,

        useJailCardFromModal: function() {
            sendWsMessage({ action: 'USE_JAIL_CARD' });
        },

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
            const restriction = getBuildHouseRestriction(sqIdx);
            if (restriction) {
                showDeedErrorBanner(restriction, '⚠️ HAUSBAU NICHT MÖGLICH');
                return;
            }
            sendWsMessage({ action: 'BUILD_HOUSE', sq_idx: sqIdx });
        },

        sellHouse: function(sqIdx) {
            const restriction = getSellHouseRestriction(sqIdx);
            if (restriction) {
                showDeedErrorBanner(restriction, '⚠️ VERKAUF NICHT MÖGLICH');
                return;
            }
            sendWsMessage({ action: 'SELL_HOUSE', sq_idx: sqIdx });
        },

        toggleMortgage: function(sqIdx) {
            const restriction = getMortgageRestriction(sqIdx);
            if (restriction) {
                showDeedErrorBanner(restriction, '⚠️ HYPOTHEK NICHT MÖGLICH');
                return;
            }
            sendWsMessage({ action: 'TOGGLE_MORTGAGE', sq_idx: sqIdx });
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
        confirmCard: confirmCard,
        resetToLobby: function() {
            closeModal('modal-gameover');
            sendWsMessage({ action: 'RESET_LOBBY' });
        },
        hideYourTurnPopup: hideYourTurnPopup,
        hideRentPopup: hideRentPopup,
        getMyPlayerId: function() { return playerId; },
        getCardIllustration: getCardIllustration,
        closeModal: closeModal,
        openDebugModal: openDebugModal,
        unlockDebugModal: unlockDebugModal,
        onDebugSliderInput: onDebugSliderInput,
        applyDebugPreset: applyDebugPreset,
        previewDebugMovement: previewDebugMovement,
        saveAndSyncDebugConfig: saveAndSyncDebugConfig
    };

    let isDebugUnlocked = false;

    const DEBUG_PRESETS = {
        default: {
            stepDuration: 280,
            stepPause: 75,
            hopHeight: 0.38,
            landingHold: 900,
            diceDuration: 1350,
            dicePostPause: 550,
            camFollowLerp: 0.10,
            camTransitionMs: 650,
            cinematicFollow: true
        },
        cinema: {
            stepDuration: 420,
            stepPause: 120,
            hopHeight: 0.45,
            landingHold: 1300,
            diceDuration: 1700,
            dicePostPause: 750,
            camFollowLerp: 0.07,
            camTransitionMs: 900,
            cinematicFollow: true
        },
        classic: {
            stepDuration: 120,
            stepPause: 25,
            hopHeight: 0.38,
            landingHold: 650,
            diceDuration: 1100,
            dicePostPause: 400,
            camFollowLerp: 0.18,
            camTransitionMs: 450,
            cinematicFollow: true
        },
        turbo: {
            stepDuration: 65,
            stepPause: 10,
            hopHeight: 0.25,
            landingHold: 250,
            diceDuration: 600,
            dicePostPause: 150,
            camFollowLerp: 0.30,
            camTransitionMs: 250,
            cinematicFollow: false
        }
    };

    function syncDebugModalSliders() {
        const engine = window.MonopolyBoard3D || Board3D;
        if (!engine || !engine.getAnimConfig) return;
        const cfg = engine.getAnimConfig();

        const setEl = (id, val, labelId, suffix = '') => {
            const el = document.getElementById(id);
            if (el) el.value = val;
            const lbl = document.getElementById(labelId);
            if (lbl) lbl.textContent = val + suffix;
        };

        setEl('dbg-step-duration', cfg.stepDuration, 'val-dbg-step-duration', ' ms');
        setEl('dbg-step-pause', cfg.stepPause, 'val-dbg-step-pause', ' ms');
        setEl('dbg-hop-height', Number(cfg.hopHeight).toFixed(2), 'val-dbg-hop-height', '');
        setEl('dbg-landing-hold', cfg.landingHold, 'val-dbg-landing-hold', ' ms');
        setEl('dbg-dice-duration', cfg.diceDuration, 'val-dbg-dice-duration', ' ms');
        setEl('dbg-dice-pause', cfg.dicePostPause, 'val-dbg-dice-pause', ' ms');
        setEl('dbg-cam-lerp', Number(cfg.camFollowLerp).toFixed(2), 'val-dbg-cam-lerp', '');
        setEl('dbg-cam-trans', cfg.camTransitionMs, 'val-dbg-cam-trans', ' ms');

        const chk = document.getElementById('dbg-cinematic-follow');
        if (chk) chk.checked = (cfg.cinematicFollow !== false);
    }

    function readDebugSlidersToConfig() {
        return {
            stepDuration: parseInt((document.getElementById('dbg-step-duration') || {}).value, 10) || 280,
            stepPause: parseInt((document.getElementById('dbg-step-pause') || {}).value, 10) || 0,
            hopHeight: parseFloat((document.getElementById('dbg-hop-height') || {}).value) || 0.38,
            landingHold: parseInt((document.getElementById('dbg-landing-hold') || {}).value, 10) || 0,
            diceDuration: parseInt((document.getElementById('dbg-dice-duration') || {}).value, 10) || 1350,
            dicePostPause: parseInt((document.getElementById('dbg-dice-pause') || {}).value, 10) || 0,
            camFollowLerp: parseFloat((document.getElementById('dbg-cam-lerp') || {}).value) || 0.10,
            camTransitionMs: parseInt((document.getElementById('dbg-cam-trans') || {}).value, 10) || 650,
            cinematicFollow: !!(document.getElementById('dbg-cinematic-follow') || {}).checked
        };
    }

    function openDebugModal() {
        const authStep = document.getElementById('debug-auth-step');
        const settingsStep = document.getElementById('debug-settings-step');
        const errEl = document.getElementById('debug-auth-error');
        const pwdInput = document.getElementById('debug-password-input');
        const fbEl = document.getElementById('debug-save-feedback');
        if (fbEl) fbEl.style.display = 'none';
        if (errEl) errEl.style.display = 'none';

        if (isDebugUnlocked) {
            if (authStep) authStep.style.display = 'none';
            if (settingsStep) settingsStep.style.display = 'flex';
            syncDebugModalSliders();
        } else {
            if (authStep) authStep.style.display = 'flex';
            if (settingsStep) settingsStep.style.display = 'none';
            if (pwdInput) {
                pwdInput.value = '';
                setTimeout(() => pwdInput.focus(), 80);
            }
        }
        openModal('modal-debug');
    }

    function unlockDebugModal() {
        const pwdInput = document.getElementById('debug-password-input');
        const errEl = document.getElementById('debug-auth-error');
        const val = pwdInput ? pwdInput.value.trim() : '';
        if (val === 'admin123') {
            isDebugUnlocked = true;
            if (errEl) errEl.style.display = 'none';
            const authStep = document.getElementById('debug-auth-step');
            const settingsStep = document.getElementById('debug-settings-step');
            if (authStep) authStep.style.display = 'none';
            if (settingsStep) settingsStep.style.display = 'flex';
            syncDebugModalSliders();
            if (Sound && Sound.playClick) Sound.playClick();
        } else {
            if (errEl) errEl.style.display = 'block';
        }
    }

    function onDebugSliderInput() {
        const cfg = readDebugSlidersToConfig();
        const engine = window.MonopolyBoard3D || Board3D;
        if (engine && engine.setAnimConfig) {
            engine.setAnimConfig(cfg, true);
        }
        syncDebugModalSliders();
    }

    function applyDebugPreset(presetKey) {
        const preset = DEBUG_PRESETS[presetKey] || DEBUG_PRESETS.default;
        const engine = window.MonopolyBoard3D || Board3D;
        if (engine && engine.setAnimConfig) {
            engine.setAnimConfig(preset, true);
        }
        syncDebugModalSliders();
        if (Sound && Sound.playClick) Sound.playClick();
    }

    function saveAndSyncDebugConfig() {
        const cfg = readDebugSlidersToConfig();
        const engine = window.MonopolyBoard3D || Board3D;
        if (engine && engine.setAnimConfig) {
            engine.setAnimConfig(cfg, true);
        }
        sendWsMessage({
            action: 'UPDATE_ANIM_CONFIG',
            password: 'admin123',
            config: cfg
        });
        const fbEl = document.getElementById('debug-save-feedback');
        if (fbEl) {
            fbEl.style.display = 'block';
            setTimeout(() => { fbEl.style.display = 'none'; }, 2600);
        }
        if (Sound && Sound.playMoney) Sound.playMoney();
    }

    function previewDebugMovement() {
        const engine = window.MonopolyBoard3D || Board3D;
        if (!engine || !engine.animateMoveToken) return;
        const cfg = readDebugSlidersToConfig();
        engine.setAnimConfig(cfg, true);

        let targetPid = playerId;
        let startPos = 0;
        if (gameState && gameState.players && gameState.players.length > 0) {
            const me = gameState.players.find(p => p.id === playerId && !p.is_bankrupt) || gameState.players[0];
            if (me) {
                targetPid = me.id;
                startPos = me.position || 0;
            }
        }
        closeModal('modal-debug');
        const midPos = (startPos + 4) % 40;
        engine.animateMoveToken(targetPid, startPos, midPos, () => {
            if (gameState && gameState.players) {
                engine.syncPlayers(gameState.players);
            }
            openDebugModal();
        }, true);
    }

    window.getCardIllustration = getCardIllustration;
    window.MonopolyGame = GameClient;
})(window);
