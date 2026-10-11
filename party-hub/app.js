// ==========================================================================
// Party-Hub State, Dynamic Multi-Tab Presence & Data
// ==========================================================================

const AVATAR_POOL = [
    { name: "Lukas", avatar: "🐶", color: "#6366f1" },
    { name: "Sarah", avatar: "🦊", color: "#f97316" },
    { name: "Tom", avatar: "🐱", color: "#06b6d4" },
    { name: "Anna", avatar: "🐼", color: "#ec4899" },
    { name: "Ben", avatar: "🐸", color: "#10b981" },
    { name: "Mia", avatar: "🐰", color: "#8b5cf6" },
    { name: "Leo", avatar: "🦁", color: "#eab308" },
    { name: "Emma", avatar: "🦄", color: "#f43f5e" },
    { name: "Felix", avatar: "🐧", color: "#3b82f6" },
    { name: "Mila", avatar: "🐻", color: "#d97706" }
];

const ALL_AVATARS = [
    "🐶", "🦊", "🐱", "🐼", "🐸", "🐰", "🦁", "🦄",
    "🐧", "🐻", "🐵", "🐙", "🚀", "👑", "👻", "⚡", "🍕", "🎮"
];

// Generate a clean 6-character alphanumeric party code (avoiding ambiguous characters 0, O, 1, I)
function generatePartyCode(len = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < len; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Read room code from URL ?room=... or ?code=...
const urlParams = new URLSearchParams(window.location.search);
let initialUrlCode = (urlParams.get("room") || urlParams.get("code") || "").trim().toUpperCase();
const HAS_INITIAL_URL_ROOM = !!initialUrlCode;

let ROOM_CODE = initialUrlCode || generatePartyCode(6);

let STORAGE_KEY_PLAYERS = `partyhub_roster_${ROOM_CODE}`;
let STORAGE_KEY_USER = `partyhub_user_${ROOM_CODE}`;
let STORAGE_KEY_JOINED = `partyhub_confirmed_${ROOM_CODE}`;
let STORAGE_KEY_VOTES = `partyhub_votes_${ROOM_CODE}`;
const STORAGE_KEY_GLOBAL_PROFILE = "partyhub_global_profile";

// Native cross-tab broadcast bus (fallback for same-device multi-tab)
let channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`partyhub_bus_${ROOM_CODE}`) : null;

// ==========================================================================
// Real-Time Multi-Device WebSocket Client
// ==========================================================================
let socket = null;
let socketReconnectTimer = null;
let socketConnected = false;

function initWebSocket() {
    // Only connect WebSocket once the user has confirmed creating or joining a room
    if (sessionStorage.getItem(STORAGE_KEY_JOINED) !== "true") {
        return;
    }
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost = window.location.host;
    const wsUrl = `${wsProto}//${wsHost}/party-ws?room=${encodeURIComponent(ROOM_CODE)}`;

    try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log("⚡ Live WebSocket connected for room:", ROOM_CODE);
            socketConnected = true;
            updateConnectionStatus(true);

            if (partyState.currentUser) {
                sendSocketMessage({
                    type: "JOIN",
                    room: ROOM_CODE,
                    user: partyState.currentUser
                });
            }
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (err) {
                console.error("Failed to parse WebSocket message:", err);
            }
        };

        socket.onclose = () => {
            socketConnected = false;
            updateConnectionStatus(false);
            clearTimeout(socketReconnectTimer);
            socketReconnectTimer = setTimeout(initWebSocket, 2000);
        };

        socket.onerror = (err) => {
            socketConnected = false;
            updateConnectionStatus(false);
        };
    } catch (e) {
        socketReconnectTimer = setTimeout(initWebSocket, 2500);
    }
}

function updateConnectionStatus(connected) {
    const el = document.getElementById("liveIndicator");
    if (!el) return;
    if (connected) {
        el.className = "live-dot-badge";
        el.title = "Live mit allen Geräten verbunden";
    } else {
        el.className = "live-dot-badge disconnected";
        el.title = "Verbindung wird wiederhergestellt...";
    }
}

function sendSocketMessage(msg) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        try {
            socket.send(JSON.stringify(msg));
        } catch (e) {
            console.error("WebSocket send error:", e);
        }
    }
}

function broadcast(msg) {
    if (channel) {
        try {
            channel.postMessage(msg);
        } catch (e) {
            console.error("Broadcast error:", e);
        }
    }
    sendSocketMessage(msg);
}

const partyState = {
    roomCode: ROOM_CODE,
    isHost: false,
    currentUser: null,
    players: [],
    games: {
        skribbol: {
            id: "skribbol",
            title: "skribbl",
            icon: "🎨",
            minPlayers: 2,
            maxPlayers: 12,
            desc: "Kreatives Zeichnen und Erraten im Freundeskreis. Durch unser neues Framework könnt ihr spannende Custom Modes wählen!",
            embedUrl: "/skribbl/"
        },
        uno: {
            id: "uno",
            title: "UNO",
            icon: "🃏",
            minPlayers: 2,
            maxPlayers: 8,
            desc: "Der fiese Kartenklassiker ohne Werbung. Ziehe 4, Aussetzen und Farbwünsche sorgen für beste Schadenfreude.",
            embedUrl: "/uno/"
        },
        codenames: {
            id: "codenames",
            title: "Codenames",
            icon: "🕵️‍♂️",
            minPlayers: 2,
            maxPlayers: 12,
            desc: "Zwei Geheimdienstchefs geben geheime Ein-Wort-Hinweise. Welches Agenten-Team entschlüsselt zuerst alle eigenen Wörter?",
            embedUrl: "/codenames/"
        },
        price_guess: {
            id: "price_guess",
            title: "Guess The Price",
            icon: "🏷️",
            minPlayers: 1,
            maxPlayers: 12,
            desc: "Errate die Preise von echten Produkten! Klassischer Schätzmodus, Höher oder Niedriger (This or That) und Echtzeit-Mehrspieler mit Freunden.",
            embedUrl: "/price-guess/"
        },
        monopoly: {
            id: "monopoly",
            title: "Monopoly 3D",
            icon: "🎩",
            minPlayers: 2,
            maxPlayers: 8,
            desc: "Der legendäre Brettspiel-Klassiker in 3D mit deutscher 2012 ROM-Ausstattung, Straßenhandel, Häuserbau und Computergegnern!",
            embedUrl: "/monopoly/"
        }
    },
    isVotingActive: false,
    votes: {
        skribbol: 0,
        uno: 0,
        codenames: 0,
        price_guess: 0,
        monopoly: 0
    },
    userVotedGame: null,
    activeModalGameId: null,
    currentLobbyId: null,
    skribblSettings: {
        mode: "classic",
        language: "german",
        rounds: "3",
        drawingTime: "80",
        customWords: ""
    }
};

let tempSelectedAvatar = null;
let tempJoinAvatar = null;
let partyOpenRoomsPollTimer = null;

// ==========================================================================
// Multi-Tab Presence, Room Selection & Session Management
// ==========================================================================

function updateRoomCodeUI() {
    const roomCodeEl = document.getElementById("roomCodeDisplay");
    if (roomCodeEl) roomCodeEl.innerText = ROOM_CODE;

    const hudRoomCode = document.getElementById("hudRoomCode");
    if (hudRoomCode) hudRoomCode.innerText = ROOM_CODE;

    const shareModalCode = document.getElementById("shareModalCodeDisplay");
    if (shareModalCode) shareModalCode.innerText = ROOM_CODE;

    const qrFallbackText = document.getElementById("qrFallbackText");
    if (qrFallbackText) qrFallbackText.innerText = ROOM_CODE;

    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${ROOM_CODE}`;
    const shareUrlInput = document.getElementById("shareUrlInput");
    if (shareUrlInput) {
        shareUrlInput.value = shareUrl;
    }

    const qrImg = document.getElementById("qrCodeImg");
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`;
        qrImg.onload = () => {
            qrImg.style.display = "block";
            if (qrFallbackText) qrFallbackText.style.display = "none";
        };
        qrImg.onerror = () => {
            qrImg.style.display = "none";
            if (qrFallbackText) qrFallbackText.style.display = "block";
        };
    }
}

function setActiveRoomCode(newCode) {
    ROOM_CODE = (newCode || generatePartyCode(6)).trim().toUpperCase();
    partyState.roomCode = ROOM_CODE;
    STORAGE_KEY_PLAYERS = `partyhub_roster_${ROOM_CODE}`;
    STORAGE_KEY_USER = `partyhub_user_${ROOM_CODE}`;
    STORAGE_KEY_JOINED = `partyhub_confirmed_${ROOM_CODE}`;
    STORAGE_KEY_VOTES = `partyhub_votes_${ROOM_CODE}`;

    if (channel) {
        try { channel.close(); } catch (e) {}
    }
    if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(`partyhub_bus_${ROOM_CODE}`);
        setupChannelListener();
    }

    try {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("room", ROOM_CODE);
        window.history.replaceState({ room: ROOM_CODE }, "", newUrl.toString());
    } catch (e) {}

    updateRoomCodeUI();
}

function stopPartyOpenRoomsPolling() {
    if (partyOpenRoomsPollTimer) {
        clearInterval(partyOpenRoomsPollTimer);
        partyOpenRoomsPollTimer = null;
    }
}

function startPartyOpenRoomsPolling() {
    stopPartyOpenRoomsPolling();
    refreshPartyOpenRooms();
    partyOpenRoomsPollTimer = setInterval(refreshPartyOpenRooms, 2500);
}

let partyExpiryAnimTimer = null;

function ensureExpiryAnimationTicker() {
    if (partyExpiryAnimTimer) return;
    partyExpiryAnimTimer = setInterval(updateExpiryAnimations, 150);
}

function getTimerColor(pct) {
    if (pct > 50) return "#22c55e";
    if (pct > 25) return "#f59e0b";
    return "#ef4444";
}

function updateExpiryAnimations() {
    const now = Date.now();

    // 1. Update open room cards in modals
    document.querySelectorAll("[data-room-expiry-local]").forEach(cardEl => {
        const exp = parseInt(cardEl.getAttribute("data-room-expiry-local"), 10);
        const ttl = parseInt(cardEl.getAttribute("data-room-ttl") || "60000", 10);
        if (!exp || isNaN(exp)) return;

        const remMs = Math.max(0, exp - now);
        const remSec = Math.ceil(remMs / 1000);
        const pct = Math.max(0, Math.min(100, (remMs / ttl) * 100));
        const color = getTimerColor(pct);

        const secEl = cardEl.querySelector(".room-expiry-sec");
        if (secEl) {
            secEl.textContent = `⏳ ${remSec}s`;
            secEl.style.color = color;
        }
        const barEl = cardEl.querySelector(".room-expiry-bar");
        if (barEl) {
            barEl.style.width = `${pct}%`;
            barEl.style.backgroundColor = color;
        }

        if (remMs <= 0) {
            cardEl.style.opacity = "0.35";
        }
    });

    // 2. Update active room solo expiry banner
    const banner = document.getElementById("soloRoomExpiryBanner");
    if (!banner) return;

    const isSoloUnused = partyState.roomExpiresAtLocal && partyState.players.length <= 1;
    if (!isSoloUnused) {
        banner.style.display = "none";
        return;
    }

    const remMs = Math.max(0, partyState.roomExpiresAtLocal - now);
    const remSec = Math.ceil(remMs / 1000);
    const ttl = partyState.roomTtlTotalMs || 60000;
    const pct = Math.max(0, Math.min(100, (remMs / ttl) * 100));
    const color = getTimerColor(pct);

    banner.style.display = "flex";
    const secEl = document.getElementById("soloRoomExpirySec");
    if (secEl) {
        secEl.textContent = `${remSec}s`;
        secEl.style.color = color;
    }
    const barEl = document.getElementById("soloRoomExpiryBar");
    if (barEl) {
        barEl.style.width = `${pct}%`;
        barEl.style.backgroundColor = color;
    }
}

window.extendRoomTtl = function() {
    partyState.roomExpiresAtLocal = Date.now() + 60000;
    updateExpiryAnimations();
    sendSocketMessage({
        type: "EXTEND_ROOM_TTL",
        room: ROOM_CODE
    });
    showToast("⏳ Raum-Timer auf 60 Sekunden zurückgesetzt!");
};

window.refreshPartyOpenRooms = async function() {
    ensureExpiryAnimationTicker();
    const containers = [
        document.getElementById("welcomeOpenRoomsList"),
        document.getElementById("codeModalOpenRoomsList")
    ].filter(Boolean);
    if (containers.length === 0) return;

    try {
        const res = await fetch("/party-ws/rooms", { cache: "no-store" });
        const data = await res.json();
        const roomsList = (data && Array.isArray(data.rooms)) ? data.rooms : [];
        const fetchTime = Date.now();

        const html = roomsList.length === 0
            ? `<div style="font-size: 0.82rem; color: var(--ink-light); text-align: center; padding: 8px;">Aktuell keine offenen Räume – erstelle oben einfach einen neuen Raum!</div>`
            : roomsList.map(r => {
                const gameTitles = {
                    skribbol: "🎨 skribbl",
                    uno: "🃏 UNO",
                    codenames: "🕵️‍♂️ Codenames",
                    price_guess: "🏷️ Guess The Price",
                    monopoly: "🎩 Monopoly 3D"
                };
                const statusLabel = r.activeGame && gameTitles[r.activeGame]
                    ? `<span style="font-size: 0.72rem; background: #fef08a; color: #854d0e; padding: 2px 6px; border-radius: 6px; font-weight: 800;">Spielt ${gameTitles[r.activeGame]}</span>`
                    : `<span style="font-size: 0.72rem; background: #86efac; color: #14532d; padding: 2px 6px; border-radius: 6px; font-weight: 800;">🟢 Offen</span>`;

                const hasExpiry = r.remainingMs !== null && r.remainingMs !== undefined;
                const localExpiry = hasExpiry ? (fetchTime + r.remainingMs) : "";
                const ttl = r.ttlTotalMs || 60000;
                const remSec = hasExpiry ? Math.ceil(r.remainingMs / 1000) : 60;
                const pct = hasExpiry ? Math.max(0, Math.min(100, (r.remainingMs / ttl) * 100)) : 100;
                const color = getTimerColor(pct);

                const timerBadge = hasExpiry
                    ? `<span class="room-expiry-sec" title="Ungenutzter Raum (max. 1 Person) wird nach Ablauf automatisch gelöscht" style="font-family: monospace; font-size: 0.75rem; font-weight: 800; color: ${color}; background: rgba(15, 23, 42, 0.08); padding: 1px 6px; border-radius: 6px;">⏳ ${remSec}s</span>`
                    : "";

                const timerBar = hasExpiry
                    ? `<div style="width: 100%; height: 4px; background: rgba(148, 163, 184, 0.22); border-radius: 999px; overflow: hidden; margin-top: 4px;">
                           <div class="room-expiry-bar" style="height: 100%; width: ${pct}%; background-color: ${color}; border-radius: 999px; transition: width 0.15s linear, background-color 0.3s ease;"></div>
                       </div>`
                    : "";

                return `
                    <div ${hasExpiry ? `data-room-expiry-local="${localExpiry}" data-room-ttl="${ttl}"` : ""} style="display: flex; flex-direction: column; padding: 7px 10px; border-radius: 10px; background: var(--bg-surface); border: var(--ink-border); transition: opacity 0.25s;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                            <div style="display: flex; flex-direction: column; gap: 2px; text-align: left;">
                                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <strong style="font-family: monospace; font-size: 0.95rem; letter-spacing: 0.08em; color: var(--primary);">#${r.code}</strong>
                                    ${statusLabel}
                                    ${timerBadge}
                                    <span style="font-size: 0.8rem; color: var(--ink);">👑 ${r.hostAvatar || ''} <strong>${r.hostName}</strong></span>
                                </div>
                                <span style="font-size: 0.75rem; color: var(--ink-light);">👥 ${r.playerCount} ${r.playerCount === 1 ? 'Person (allein)' : 'Personen'}</span>
                            </div>
                            <button type="button" class="action-btn-sm" onclick="joinOpenPartyRoom('${r.code}')" style="padding: 6px 12px; font-size: 0.85rem; white-space: nowrap;">
                                Beitreten →
                            </button>
                        </div>
                        ${timerBar}
                    </div>
                `;
            }).join("");

        containers.forEach(el => { el.innerHTML = html; });
    } catch (e) {
        containers.forEach(el => {
            el.innerHTML = `<div style="font-size: 0.8rem; color: var(--ink-light); text-align: center; padding: 6px;">Keine aktiven Räume gefunden.</div>`;
        });
    }
};

function initUserSession() {
    ensureExpiryAnimationTicker();
    updateRoomCodeUI();

    const isJoined = HAS_INITIAL_URL_ROOM && sessionStorage.getItem(STORAGE_KEY_JOINED) === "true";
    let savedUser = null;
    try {
        const stored = sessionStorage.getItem(STORAGE_KEY_USER);
        if (stored) savedUser = JSON.parse(stored);
    } catch (e) {}

    if (isJoined && savedUser) {
        partyState.currentUser = savedUser;
        partyState.isHost = savedUser.isHost;
        updateHeaderUserBadge();
        updateHostPermissionsUI();
        syncPresence();
    } else {
        // Show welcome & room selection modal
        showJoinModal();
        updateHostPermissionsUI();
        syncPresence();
    }
}

function showJoinModal() {
    const modal = document.getElementById("joinModal");
    const input = document.getElementById("joinNicknameInput");
    const picker = document.getElementById("joinAvatarPicker");
    const codeInput = document.getElementById("welcomeRoomCodeInput");
    if (!modal) return;

    let globalProfile = null;
    try {
        const rawProfile = localStorage.getItem(STORAGE_KEY_GLOBAL_PROFILE);
        if (rawProfile) globalProfile = JSON.parse(rawProfile);
    } catch (e) {}

    let roster = getRosterFromStorage();
    const activePlayerNames = Object.values(roster).map(p => p.name);

    let chosenPreset = AVATAR_POOL.find(p => !activePlayerNames.includes(p.name));
    if (!chosenPreset) {
        const num = Object.keys(roster).length + 1;
        chosenPreset = {
            name: `Spieler ${num}`,
            avatar: ALL_AVATARS[num % ALL_AVATARS.length],
            color: "#6366f1"
        };
    }

    tempJoinAvatar = (globalProfile && globalProfile.avatar) ? globalProfile.avatar : chosenPreset.avatar;
    if (input) {
        input.value = (globalProfile && globalProfile.name) ? globalProfile.name : "";
        setTimeout(() => {
            if (!input.value) input.focus();
        }, 150);
    }

    if (codeInput) {
        codeInput.value = HAS_INITIAL_URL_ROOM ? initialUrlCode : "";
    }

    if (picker) {
        picker.innerHTML = "";
        ALL_AVATARS.forEach(emoji => {
            const item = document.createElement("div");
            item.className = `avatar-pick-item ${emoji === tempJoinAvatar ? 'selected' : ''}`;
            item.innerText = emoji;
            item.onclick = () => {
                document.querySelectorAll("#joinAvatarPicker .avatar-pick-item").forEach(el => el.classList.remove("selected"));
                item.classList.add("selected");
                tempJoinAvatar = emoji;
            };
            picker.appendChild(item);
        });
    }

    modal.style.display = "flex";
    startPartyOpenRoomsPolling();
}

function enterPartyRoom(targetCode, isCreatingNew = false, allowFallbackName = false) {
    const joinModal = document.getElementById("joinModal");
    const isJoinModalVisible = joinModal && joinModal.style.display !== "none";
    const input = document.getElementById("joinNicknameInput");

    let nickname = "";
    if (isJoinModalVisible && input) {
        nickname = input.value.trim();
        if (!nickname) {
            if (allowFallbackName) {
                nickname = "Gast";
            } else {
                input.focus();
                showToast("⚠️ Bitte gib zuerst deinen Nickname ein!");
                return;
            }
        }
    } else if (partyState.currentUser && partyState.currentUser.name) {
        nickname = partyState.currentUser.name;
    } else {
        try {
            const rawProfile = localStorage.getItem(STORAGE_KEY_GLOBAL_PROFILE);
            if (rawProfile) nickname = JSON.parse(rawProfile).name || "Gast";
        } catch (e) {}
        if (!nickname) nickname = "Gast";
    }

    const avatar = tempJoinAvatar || (partyState.currentUser && partyState.currentUser.avatar) || "🐶";
    const preset = AVATAR_POOL.find(p => p.name.toLowerCase() === nickname.toLowerCase() || p.avatar === avatar);
    const color = preset ? preset.color : "#6366f1";

    // Close old WebSocket if switching rooms
    if (socket) {
        try {
            socket.onclose = null;
            socket.close();
        } catch (e) {}
        socket = null;
        socketConnected = false;
    }
    clearTimeout(socketReconnectTimer);
    partyState.players = [];
    partyState.roomExpiresAtLocal = Date.now() + 60000;
    partyState.roomTtlTotalMs = 60000;

    setActiveRoomCode(targetCode);

    const existingId = partyState.currentUser && partyState.currentUser.id
        ? partyState.currentUser.id
        : "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6);

    const newUser = {
        id: existingId,
        name: nickname,
        avatar: avatar,
        color: color,
        isHost: isCreatingNew,
        isCreator: isCreatingNew,
        status: "Bereit",
        isReady: true,
        joinedAt: Date.now(),
        lastSeen: Date.now()
    };

    try {
        sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(newUser));
        sessionStorage.setItem(STORAGE_KEY_JOINED, "true");
        localStorage.setItem(STORAGE_KEY_GLOBAL_PROFILE, JSON.stringify({
            name: nickname,
            avatar: avatar,
            color: color
        }));
    } catch (err) {}

    partyState.currentUser = newUser;
    partyState.isHost = newUser.isHost;

    if (joinModal) joinModal.style.display = "none";
    const codeModal = document.getElementById("codeModal");
    if (codeModal) codeModal.style.display = "none";
    stopPartyOpenRoomsPolling();

    updateHeaderUserBadge();
    initWebSocket();
    syncPresence();
    updateExpiryAnimations();
    broadcast({ type: "PRESENCE_PING" });

    showToast(isCreatingNew
        ? `🎉 Neuer Party-Raum #${ROOM_CODE} erstellt!`
        : `🚀 Raum #${ROOM_CODE} beigetreten!`);
}

window.handleCreateNewRoomFromJoin = function() {
    const newCode = generatePartyCode(6);
    enterPartyRoom(newCode, true, false);
};

window.handleJoinByCodeFromJoin = function() {
    const codeInput = document.getElementById("welcomeRoomCodeInput");
    const code = (codeInput ? codeInput.value : "").trim().toUpperCase();
    if (!code) {
        if (codeInput) codeInput.focus();
        showToast("⚠️ Bitte gib einen Raum-Code ein!");
        return;
    }
    enterPartyRoom(code, false, false);
};

window.joinOpenPartyRoom = function(code) {
    if (!code) return;
    enterPartyRoom(code.trim().toUpperCase(), false, true);
};

window.handleQuickViewCatalog = function() {
    const target = HAS_INITIAL_URL_ROOM ? initialUrlCode : generatePartyCode(6);
    enterPartyRoom(target, !HAS_INITIAL_URL_ROOM, true);
    const catalog = document.getElementById("gamesGrid");
    if (catalog) {
        setTimeout(() => catalog.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }
};

window.handleJoinSubmit = function(e) {
    if (e) e.preventDefault();
    const codeInput = document.getElementById("welcomeRoomCodeInput");
    const code = (codeInput ? codeInput.value : "").trim().toUpperCase();
    if (code) {
        handleJoinByCodeFromJoin();
    } else {
        handleCreateNewRoomFromJoin();
    }
};

function getRosterFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PLAYERS);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        const now = Date.now();
        const active = {};
        // Prune players that haven't sent a heartbeat in 5 seconds
        for (const [id, p] of Object.entries(parsed)) {
            if (p && now - (p.lastSeen || 0) < 5000) {
                active[id] = p;
            }
        }
        return active;
    } catch (e) {
        return {};
    }
}

function syncPresence() {
    const isJoined = sessionStorage.getItem(STORAGE_KEY_JOINED) === "true";

    if (partyState.currentUser && isJoined) {
        partyState.currentUser.lastSeen = Date.now();

        if (socketConnected) {
            sendSocketMessage({
                type: "HEARTBEAT",
                room: ROOM_CODE,
                playerId: partyState.currentUser.id
            });
        }

        let roster = getRosterFromStorage();
        roster[partyState.currentUser.id] = partyState.currentUser;
        try {
            localStorage.setItem(STORAGE_KEY_PLAYERS, JSON.stringify(roster));
        } catch (e) {}

        // Only use local roster if WebSocket is not open AND we have not received server players yet
        if (!socketConnected && (!partyState.players || partyState.players.length === 0)) {
            partyState.players = [partyState.currentUser];
        }

        updateHeaderUserBadge();
    }

    renderPlayerRoster();

    if (partyState.activeModalGameId) {
        renderModalReadiness();
    }
}

function updateHeaderUserBadge() {
    if (!partyState.currentUser) return;
    const avatarEl = document.getElementById("userAvatar");
    const nameEl = document.getElementById("userNameDisplay");
    const roleEl = document.getElementById("userRoleDisplay");

    if (avatarEl) avatarEl.innerText = partyState.currentUser.avatar;
    if (nameEl) nameEl.innerText = partyState.currentUser.name;
    if (roleEl) {
        if (partyState.currentUser.isHost) {
            roleEl.innerText = "👑 Party-Host";
            roleEl.className = "user-role host";
        } else {
            roleEl.innerText = "🎮 Mitspieler";
            roleEl.className = "user-role";
        }
    }
}

function renderPlayerRoster() {
    const rosterEl = document.getElementById("playerRoster");
    const countBadge = document.getElementById("playerCountBadge");
    if (!rosterEl) return;

    const count = partyState.players.length;
    if (countBadge) {
        countBadge.innerText = count === 1 ? "1 Freund" : `${count} Freunde`;
    }

    rosterEl.innerHTML = "";

    const isHostMe = !!partyState.isHost;

    partyState.players.forEach(p => {
        const isMe = partyState.currentUser && p.id === partyState.currentUser.id;
        const card = document.createElement("div");
        card.className = `player-card ${p.isHost ? 'is-host' : ''}`;
        
        let hostBtnHtml = '';
        if (isHostMe && !isMe) {
            hostBtnHtml = `
                <button class="transfer-host-btn" type="button" title="${p.name} zum Party-Leader machen">
                    👑 Leader übergeben
                </button>
            `;
        }

        card.innerHTML = `
            <div class="player-card-avatar" style="background: ${p.color || '#6366f1'}22; border: 2.5px solid ${p.color || '#6366f1'};">
                ${p.avatar}
                <span class="status-dot"></span>
            </div>
            <div class="player-card-details">
                <span class="player-card-name">
                    ${p.name} ${p.isHost ? '👑' : ''} ${isMe ? '<small style="opacity:0.75; font-size:0.8em;">(Du)</small>' : ''}
                </span>
                <span class="player-card-tag">${p.status || 'Bereit'}</span>
            </div>
            ${hostBtnHtml}
        `;

        if (isHostMe && !isMe) {
            const btn = card.querySelector(".transfer-host-btn");
            if (btn) {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    transferHostTo(p.id, p.name);
                });
            }
        }

        rosterEl.appendChild(card);
    });
    updateHostPermissionsUI();
}

window.transferHostTo = function(targetPlayerId, targetName) {
    if (!partyState.isHost) {
        showToast("⚠️ Nur der aktuelle Party-Host kann die Rolle übergeben.");
        return;
    }
    if (!targetPlayerId || (partyState.currentUser && targetPlayerId === partyState.currentUser.id)) {
        return;
    }

    const displayName = targetName || "diesen Mitspieler";
    const confirmed = window.confirm(`Möchtest du die Party-Leader-Rolle (👑) wirklich an "${displayName}" übergeben?`);
    if (!confirmed) return;

    // Send via WebSocket to server
    sendSocketMessage({
        type: "TRANSFER_HOST",
        room: ROOM_CODE,
        targetPlayerId: targetPlayerId,
        targetName: displayName
    });

    // Also send via local BroadcastChannel for multi-tab
    broadcast({
        type: "HOST_TRANSFERRED",
        newHostId: targetPlayerId,
        newHostName: displayName,
        oldHostId: partyState.currentUser ? partyState.currentUser.id : null,
        oldHostName: partyState.currentUser ? partyState.currentUser.name : null
    });

    // Optimistically update local state
    if (partyState.currentUser) {
        partyState.currentUser.isHost = false;
        try {
            sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(partyState.currentUser));
        } catch (e) {}
    }
    partyState.isHost = false;

    let roster = getRosterFromStorage();
    if (partyState.currentUser && roster[partyState.currentUser.id]) {
        roster[partyState.currentUser.id].isHost = false;
    }
    if (roster[targetPlayerId]) {
        roster[targetPlayerId].isHost = true;
    }
    try {
        localStorage.setItem(STORAGE_KEY_PLAYERS, JSON.stringify(roster));
    } catch (e) {}

    partyState.players.forEach(p => {
        p.isHost = (p.id === targetPlayerId);
    });

    updateHeaderUserBadge();
    renderPlayerRoster();
    updateHostPermissionsUI();
    if (partyState.activeModalGameId) {
        renderModalReadiness();
        if (partyState.activeModalGameId === "skribbol") {
            applySkribblSettingsUI();
        }
    }

    showToast(`👑 Du hast die Party-Leitung an ${displayName} übergeben.`);
};

function updateHostPermissionsUI() {
    const isHost = !!partyState.isHost;

    // 1. Update Game Card buttons
    document.querySelectorAll(".game-card:not(.roulette-card) .play-btn").forEach(btn => {
        if (isHost) {
            btn.classList.remove("waiting-host");
            btn.innerText = "Spielen & Starten";
            btn.title = "Spiel für alle Party-Gäste auswählen";
        } else {
            btn.classList.add("waiting-host");
            btn.innerText = "Warten auf Host 👑";
            btn.title = "Nur der Party-Leader kann ein Spiel starten";
        }
    });

    // 2. Update Roulette Button
    const rouletteBtn = document.querySelector(".roulette-btn");
    if (rouletteBtn) {
        if (isHost) {
            rouletteBtn.classList.remove("waiting-host");
            rouletteBtn.innerText = "🎲 Zufälliges Spiel wählen";
            rouletteBtn.title = "Zufälliges Spiel für alle Freunde auswählen";
        } else {
            rouletteBtn.classList.add("waiting-host");
            rouletteBtn.innerText = "Warten auf Host 🎲";
            rouletteBtn.title = "Nur der Party-Leader kann das Roulette drehen";
        }
    }

    // 3. Update Game Modal Controls if open
    const launchBtn = document.getElementById("launchGameBtn");
    const nonHostWait = document.getElementById("modalNonHostWait");
    const nonHostWaitText = document.getElementById("modalNonHostWaitText");

    if (launchBtn && nonHostWait) {
        if (isHost) {
            launchBtn.style.display = "inline-flex";
            nonHostWait.style.display = "none";
            const game = partyState.games[partyState.activeModalGameId];
            const title = game ? game.title : "Spiel";
            launchBtn.innerText = `🚀 ${title} starten`;
            launchBtn.disabled = false;
        } else {
            launchBtn.style.display = "none";
            nonHostWait.style.display = "inline-flex";
            const hostPlayer = partyState.players.find(p => p.isHost);
            const hostName = hostPlayer ? hostPlayer.name : "Host";
            if (nonHostWaitText) {
                nonHostWaitText.innerText = `Warten auf Start durch Host (${hostName})...`;
            }
        }
    }

    // 4. Update Skribbl settings UI state
    if (partyState.activeModalGameId === "skribbol") {
        applySkribblSettingsUI();
    }
}

// ==========================================================================
// Skribbl Settings Real-Time Sync (Leader Controls, Guests Read-Only)
// ==========================================================================

window.handleSkribblSettingChange = function() {
    if (!partyState.isHost) {
        applySkribblSettingsUI();
        return;
    }

    const modeEl = document.getElementById("skribbl-opt-mode");
    const langEl = document.getElementById("skribbl-opt-language");
    const roundsEl = document.getElementById("skribbl-opt-rounds");
    const timeEl = document.getElementById("skribbl-opt-drawing-time");
    const customWordsEl = document.getElementById("skribbl-opt-custom-words");

    partyState.skribblSettings = {
        mode: modeEl ? modeEl.value : "classic",
        language: langEl ? langEl.value : "german",
        rounds: roundsEl ? roundsEl.value : "3",
        drawingTime: timeEl ? timeEl.value : "80",
        customWords: customWordsEl ? customWordsEl.value : ""
    };

    broadcast({
        type: "GAME_SETTINGS_UPDATE",
        gameId: "skribbol",
        settings: partyState.skribblSettings
    });
};

function applySkribblSettingsUI() {
    const isHost = !!partyState.isHost;
    const settings = partyState.skribblSettings || {
        mode: "classic",
        language: "german",
        rounds: "3",
        drawingTime: "80",
        customWords: ""
    };

    const modeEl = document.getElementById("skribbl-opt-mode");
    const langEl = document.getElementById("skribbl-opt-language");
    const roundsEl = document.getElementById("skribbl-opt-rounds");
    const timeEl = document.getElementById("skribbl-opt-drawing-time");
    const customWordsEl = document.getElementById("skribbl-opt-custom-words");
    const badgeEl = document.getElementById("skribblSettingsBadge");

    if (modeEl && settings.mode !== undefined) modeEl.value = settings.mode;
    if (langEl && settings.language !== undefined) langEl.value = settings.language;
    if (roundsEl && settings.rounds !== undefined) roundsEl.value = settings.rounds;
    if (timeEl && settings.drawingTime !== undefined) timeEl.value = settings.drawingTime;
    if (customWordsEl && settings.customWords !== undefined) {
        if (document.activeElement !== customWordsEl) {
            customWordsEl.value = settings.customWords;
        }
    }

    const inputs = [modeEl, langEl, roundsEl, timeEl, customWordsEl];
    inputs.forEach(input => {
        if (!input) return;
        if (isHost) {
            input.disabled = false;
            input.classList.remove("is-disabled");
        } else {
            input.disabled = true;
            input.classList.add("is-disabled");
        }
    });

    if (badgeEl) {
        if (isHost) {
            badgeEl.className = "settings-role-badge";
            badgeEl.innerText = "👑 Du bist Party-Host (Regeln anpassbar)";
        } else {
            badgeEl.className = "settings-role-badge guest";
            const hostPlayer = partyState.players.find(p => p.isHost);
            const hostName = hostPlayer ? hostPlayer.name : "Host";
            badgeEl.innerText = `👑 Host bestimmt Regeln (${hostName})`;
        }
    }
}

// ==========================================================================
// Profile Modal (Change Name & Avatar)
// ==========================================================================

window.openProfileModal = function() {
    const modal = document.getElementById("profileModal");
    const nameInput = document.getElementById("profileNameInput");
    const picker = document.getElementById("profileAvatarPicker");
    if (!modal) return;

    tempSelectedAvatar = partyState.currentUser.avatar;
    if (nameInput) nameInput.value = partyState.currentUser.name;

    if (picker) {
        picker.innerHTML = "";
        ALL_AVATARS.forEach(emoji => {
            const item = document.createElement("div");
            item.className = `avatar-pick-item ${emoji === tempSelectedAvatar ? 'selected' : ''}`;
            item.innerText = emoji;
            item.onclick = () => {
                document.querySelectorAll(".avatar-pick-item").forEach(el => el.classList.remove("selected"));
                item.classList.add("selected");
                tempSelectedAvatar = emoji;
            };
            picker.appendChild(item);
        });
    }

    modal.style.display = "flex";
};

window.closeProfileModal = function() {
    const modal = document.getElementById("profileModal");
    if (modal) modal.style.display = "none";
};

window.saveProfileModal = function() {
    const nameInput = document.getElementById("profileNameInput");
    const newName = nameInput ? nameInput.value.trim() : "";
    if (newName) {
        partyState.currentUser.name = newName;
    }
    if (tempSelectedAvatar) {
        partyState.currentUser.avatar = tempSelectedAvatar;
    }

    try {
        sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(partyState.currentUser));
    } catch (e) {}

    syncPresence();
    sendSocketMessage({
        type: "UPDATE_USER",
        room: ROOM_CODE,
        user: partyState.currentUser
    });
    broadcast({ type: "PRESENCE_PING" });

    closeProfileModal();
    showToast(`Profil gespeichert: ${partyState.currentUser.name} ${partyState.currentUser.avatar}`);
};

// ==========================================================================
// Cross-Tab Broadcast Listener
// ==========================================================================

// ==========================================================================
// Central Real-Time Message Handler (WebSocket & BroadcastChannel)
// ==========================================================================

function handleServerMessage(data) {
    if (!data || !data.type) return;

    switch (data.type) {
        case "ROSTER_SYNC":
            if (Array.isArray(data.players)) {
                // Update players from real-time server
                partyState.players = data.players;

                // Sync current user state if we are already in the room
                if (partyState.currentUser) {
                    const serverMe = data.players.find(p => p.id === partyState.currentUser.id);
                    if (serverMe) {
                        partyState.currentUser.isHost = !!serverMe.isHost;
                        partyState.isHost = partyState.currentUser.isHost;
                    } else if (sessionStorage.getItem(STORAGE_KEY_JOINED) === "true") {
                        // Resend join if server restarted
                        sendSocketMessage({
                            type: "JOIN",
                            room: ROOM_CODE,
                            user: partyState.currentUser
                        });
                    }
                }

                if (data.votes) {
                    partyState.votes = data.votes;
                }
                if (data.isVotingActive !== undefined) {
                    partyState.isVotingActive = !!data.isVotingActive;
                }
                if (data.gameSettings && data.gameSettings.skribbol) {
                    partyState.skribblSettings = {
                        ...partyState.skribblSettings,
                        ...data.gameSettings.skribbol
                    };
                }

                if (data.remainingMs !== null && data.remainingMs !== undefined) {
                    partyState.roomExpiresAtLocal = Date.now() + data.remainingMs;
                    partyState.roomTtlTotalMs = data.ttlTotalMs || 60000;
                } else {
                    partyState.roomExpiresAtLocal = null;
                }

                updateHeaderUserBadge();
                renderPlayerRoster();
                applyVoteStateUI();
                updateHostPermissionsUI();
                updateExpiryAnimations();

                if (partyState.activeModalGameId) {
                    renderModalReadiness();
                    if (partyState.activeModalGameId === "skribbol") {
                        applySkribblSettingsUI();
                    }
                }

                if (data.activeGame && data.activeGame.gameId) {
                    if (data.activeGame.lobbyId) {
                        partyState.currentLobbyId = data.activeGame.lobbyId;
                    }
                    const overlay = document.getElementById("activeGameOverlay");
                    const isOverlayActive = overlay && overlay.classList.contains("active");
                    const iframe = document.getElementById("gameIframe");

                    if (isOverlayActive && iframe && data.activeGame.gameId === "skribbol" && data.activeGame.lobbyId) {
                        const expectedLobbyPath = `/skribbl/lobby/${data.activeGame.lobbyId}`;
                        if (!iframe.src.includes(expectedLobbyPath)) {
                            console.log("Updating iframe src to active Skribbl lobby:", expectedLobbyPath);
                            const userName = partyState.currentUser ? partyState.currentUser.name : "Gast";
                            const skribblSession = getSkribblUserSession();
                            iframe.src = `${expectedLobbyPath}?username=${encodeURIComponent(userName)}&usersession=${skribblSession}`;
                        }
                    } else if (!isOverlayActive && sessionStorage.getItem(STORAGE_KEY_JOINED) === "true") {
                        const game = partyState.games[data.activeGame.gameId];
                        if (game) {
                            executeCountdownAndLaunch(game, data.activeGame.lobbyId);
                        }
                    }
                }
            }
            break;

        case "ROOM_EXPIRED": {
            try {
                sessionStorage.removeItem(STORAGE_KEY_JOINED);
            } catch (e) {}
            if (socket) {
                try {
                    socket.onclose = null;
                    socket.close();
                } catch (e) {}
                socket = null;
                socketConnected = false;
            }
            clearTimeout(socketReconnectTimer);
            partyState.players = [];
            partyState.roomExpiresAtLocal = null;
            updateExpiryAnimations();
            renderPlayerRoster();
            showToast("⏰ Ungenutzter Raum (max. 1 Person) wurde nach 60s geschlossen.");
            showJoinModal();
            break;
        }

        case "GAME_SETTINGS_SYNC":
        case "GAME_SETTINGS_UPDATE":
            if (data.gameId === "skribbol" && data.settings) {
                partyState.skribblSettings = {
                    ...partyState.skribblSettings,
                    ...data.settings
                };
                if (partyState.activeModalGameId === "skribbol") {
                    applySkribblSettingsUI();
                }
            }
            break;

        case "PRESENCE_PING":
        case "PLAYER_LEFT":
            if (data.name) {
                showToast(`👋 ${data.name} hat die Party verlassen.`);
            }
            syncPresence();
            break;

        case "OPEN_GAME_MODAL":
            if (data.gameId && partyState.games[data.gameId]) {
                if (data.lobbyId) {
                    partyState.currentLobbyId = data.lobbyId;
                }
                showModalUI(data.gameId);
                if (data.initiatedBy && partyState.currentUser && data.initiatedBy !== partyState.currentUser.name) {
                    showToast(`🔔 ${data.initiatedBy} lädt zu ${partyState.games[data.gameId].title} ein!`);
                }
            }
            break;

        case "CLOSE_GAME_MODAL":
            const modal = document.getElementById("gameModal");
            if (modal) modal.style.display = "none";
            partyState.activeModalGameId = null;
            break;

        case "READY_STATE_CHANGED":
            if (data.playerId) {
                const p = partyState.players.find(x => x.id === data.playerId);
                if (p) p.isReady = data.isReady;
                renderModalReadiness();
            }
            break;

        case "LAUNCH_GAME":
            if (data.gameId && partyState.games[data.gameId]) {
                if (data.lobbyId) {
                    partyState.currentLobbyId = data.lobbyId;
                }
                executeCountdownAndLaunch(partyState.games[data.gameId], data.lobbyId);
            }
            break;

        case "EXIT_GAME":
            doExitGameView();
            break;

        case "VOTE_UPDATE":
            partyState.votes = data.votes || partyState.votes;
            if (data.isVotingActive !== undefined) {
                partyState.isVotingActive = !!data.isVotingActive;
            }
            applyVoteStateUI();
            break;

        case "HOST_TRANSFERRED":
        case "TRANSFER_HOST":
            if (data.newHostId) {
                const isNewHostMe = partyState.currentUser && partyState.currentUser.id === data.newHostId;
                if (partyState.currentUser) {
                    partyState.currentUser.isHost = isNewHostMe;
                    try {
                        sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(partyState.currentUser));
                    } catch (e) {}
                }
                partyState.isHost = isNewHostMe;

                let roster = getRosterFromStorage();
                Object.values(roster).forEach(p => {
                    p.isHost = (p.id === data.newHostId);
                });
                try {
                    localStorage.setItem(STORAGE_KEY_PLAYERS, JSON.stringify(roster));
                } catch (e) {}

                partyState.players.forEach(p => {
                    p.isHost = (p.id === data.newHostId);
                });

                updateHeaderUserBadge();
                renderPlayerRoster();
                updateHostPermissionsUI();
                if (partyState.activeModalGameId) {
                    renderModalReadiness();
                    if (partyState.activeModalGameId === "skribbol") {
                        applySkribblSettingsUI();
                    }
                }

                if (isNewHostMe) {
                    showToast(`👑 Du bist jetzt der neue Party-Leader! 🎉`);
                } else {
                    const newHostName = data.newHostName || "Ein Mitspieler";
                    showToast(`👑 ${newHostName} ist jetzt Party-Leader.`);
                }
            }
            break;
    }
}

function setupChannelListener() {
    if (!channel) return;
    channel.onmessage = (event) => {
        handleServerMessage(event.data);
    };
}

// Clean up on tab close
window.addEventListener("beforeunload", () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PLAYERS);
        if (raw) {
            const roster = JSON.parse(raw);
            delete roster[partyState.currentUser.id];
            localStorage.setItem(STORAGE_KEY_PLAYERS, JSON.stringify(roster));
        }
        broadcast({ type: "PLAYER_LEFT", id: partyState.currentUser.id });
    } catch (e) {}
});

// ==========================================================================
// DOM Initialization & Setup
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
    initUserSession();
    initWebSocket();
    syncPresence();
    setupFilters();
    setupEventListeners();
    setupChannelListener();
    initThemeSystem();
    loadVotesFromStorage();

    // Heartbeat every 1.5 seconds to refresh presence and prune dead tabs
    setInterval(syncPresence, 1500);
});

function setupFilters() {
    const filterButtons = document.querySelectorAll(".filter-pill");
    filterButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            filterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const filter = btn.dataset.filter;
            const cards = document.querySelectorAll(".game-card");
            cards.forEach(card => {
                if (filter === "all") {
                    card.style.display = "flex";
                } else {
                    const cat = card.dataset.category || "";
                    if (cat.includes(filter)) {
                        card.style.display = "flex";
                    } else {
                        card.style.display = "none";
                    }
                }
            });
        });
    });
}

function setupEventListeners() {
    const copyLinkBtn = document.getElementById("copyLinkBtn");
    if (copyLinkBtn) copyLinkBtn.addEventListener("click", copyShareUrl);
    const roomCodeTag = document.getElementById("roomCodeTag");
    if (roomCodeTag) roomCodeTag.addEventListener("click", copyShareUrl);

    const qrCodeBtn = document.getElementById("qrCodeBtn");
    if (qrCodeBtn) qrCodeBtn.addEventListener("click", openShareModal);

    const changeRoomBtn = document.getElementById("changeRoomBtn");
    if (changeRoomBtn) changeRoomBtn.addEventListener("click", openCodeModal);

    document.getElementById("toggleVoteBtn").addEventListener("click", toggleVoteMode);
    document.getElementById("closeVoteBtn").addEventListener("click", toggleVoteMode);
    document.getElementById("backToHubBtn").addEventListener("click", exitActiveGame);
    
    // User profile badge click
    const userBadge = document.getElementById("currentUserBadge");
    if (userBadge) {
        userBadge.addEventListener("click", openProfileModal);
    }

    // Keyboard shortcut 'T' to quickly cycle themes (when not typing in an input)
    document.addEventListener("keydown", (e) => {
        if (e.key === "t" || e.key === "T") {
            const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
            if (tag !== "input" && tag !== "textarea") {
                cycleTheme();
            }
        }
    });
}

// ==========================================================================
// Modular Multi-Theme System
// ==========================================================================

const THEMES = [
    {
        id: "doodle",
        name: "Doodle Skizze",
        icon: "✏️",
        desc: "Klassischer Skribbl-Stil auf kariertem Notizpapier",
        swatches: ["#ffffff", "#3b82f6", "#1e293b"]
    },
    {
        id: "cyber-arcade",
        name: "Cyber Arcade",
        icon: "🕹️",
        desc: "Dunkle Cyber-Lounge mit Neon-Cyan & Magenta Glows",
        swatches: ["#080a12", "#00f0ff", "#ff007f"]
    },
    {
        id: "glassmorphism",
        name: "Modern Glass",
        icon: "✨",
        desc: "Elegante Milchglas-Karten mit sanftem Farbnebel",
        swatches: ["#0b0f19", "#6366f1", "#ec4899"]
    },
    {
        id: "cozy-lounge",
        name: "Cozy Lounge",
        icon: "🪵",
        desc: "Warmer Kaminabend mit Mahagoni, Bernstein & Gold",
        swatches: ["#171310", "#d97706", "#fef3c7"]
    },
    {
        id: "retro-arcade",
        name: "Retro Pop Art",
        icon: "👾",
        desc: "Knallige 90er-Jahre Arcade mit mutigen Kontrasten",
        swatches: ["#1e1b4b", "#facc15", "#38bdf8"]
    },
    {
        id: "clean-light",
        name: "Nordic Clean",
        icon: "☀️",
        desc: "Minimalistischer, aufgeräumter Studio-Look",
        swatches: ["#f8fafc", "#2563eb", "#ffffff"]
    }
];

function initThemeSystem() {
    const savedTheme = localStorage.getItem("partyhub_theme") || "cyber-arcade";
    applyTheme(savedTheme, false);

    const dropdownBtn = document.getElementById("themeDropdownBtn");
    const dropdownMenu = document.getElementById("themeDropdownMenu");
    const optionsContainer = document.getElementById("themeOptionsList");

    if (optionsContainer) {
        optionsContainer.innerHTML = "";
        THEMES.forEach(t => {
            const item = document.createElement("div");
            item.className = `theme-option-item ${t.id === savedTheme ? "active" : ""}`;
            item.dataset.themeId = t.id;
            item.innerHTML = `
                <div class="theme-option-info">
                    <span class="theme-option-icon">${t.icon}</span>
                    <div class="theme-option-text">
                        <span class="theme-option-name">${t.name}</span>
                        <span class="theme-option-desc">${t.desc}</span>
                    </div>
                </div>
                <div class="theme-swatches">
                    ${t.swatches.map(c => `<span class="theme-swatch" style="background: ${c};"></span>`).join("")}
                </div>
            `;
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                applyTheme(t.id, true);
                closeThemeDropdown();
            });
            optionsContainer.appendChild(item);
        });
    }

    if (dropdownBtn && dropdownMenu) {
        dropdownBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = dropdownMenu.classList.contains("show");
            if (isOpen) {
                closeThemeDropdown();
            } else {
                openThemeDropdown();
            }
        });

        // Close on click outside
        document.addEventListener("click", (e) => {
            const wrapper = document.getElementById("themePickerWrapper");
            if (wrapper && !wrapper.contains(e.target)) {
                closeThemeDropdown();
            }
        });
    }
}

function openThemeDropdown() {
    const btn = document.getElementById("themeDropdownBtn");
    const menu = document.getElementById("themeDropdownMenu");
    if (btn) btn.classList.add("open");
    if (menu) menu.classList.add("show");
}

function closeThemeDropdown() {
    const btn = document.getElementById("themeDropdownBtn");
    const menu = document.getElementById("themeDropdownMenu");
    if (btn) btn.classList.remove("open");
    if (menu) menu.classList.remove("show");
}

function applyTheme(themeId, notify = true) {
    const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
    document.documentElement.setAttribute("data-theme", theme.id);
    localStorage.setItem("partyhub_theme", theme.id);

    const iconEl = document.getElementById("currentThemeIcon");
    const nameEl = document.getElementById("currentThemeName");
    if (iconEl) iconEl.innerText = theme.icon;
    if (nameEl) nameEl.innerText = theme.name;

    // Update active highlight in menu
    document.querySelectorAll(".theme-option-item").forEach(el => {
        if (el.dataset.themeId === theme.id) {
            el.classList.add("active");
        } else {
            el.classList.remove("active");
        }
    });

    if (notify) {
        showToast(`Design aktiviert: ${theme.icon} ${theme.name}`);
    }
}

// Quick Cycle (z. B. per Tastatur 'T' oder Shortcut)
window.cycleTheme = function() {
    const currentThemeId = document.documentElement.getAttribute("data-theme") || "cyber-arcade";
    const currentIndex = THEMES.findIndex(t => t.id === currentThemeId);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    applyTheme(THEMES[nextIndex].id, true);
};

// ==========================================================================
function ensureCurrentUser() {
    if (!partyState.currentUser) {
        let saved = null;
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY_USER);
            if (stored) saved = JSON.parse(stored);
        } catch (e) {}

        if (!saved) {
            try {
                const storedLocal = localStorage.getItem(STORAGE_KEY_USER);
                if (storedLocal) saved = JSON.parse(storedLocal);
            } catch (e) {}
        }

        if (saved) {
            partyState.currentUser = saved;
            partyState.isHost = saved.isHost;
        } else {
            partyState.currentUser = {
                id: "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6),
                name: "Spieler",
                avatar: "🐶",
                color: "#6366f1",
                isHost: true,
                status: "Bereit",
                isReady: true,
                joinedAt: Date.now(),
                lastSeen: Date.now()
            };
            partyState.isHost = true;
            try {
                sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(partyState.currentUser));
                sessionStorage.setItem(STORAGE_KEY_JOINED, "true");
            } catch (e) {}
        }
    }
}

// ==========================================================================
// Helpers: Deterministic & Random UUIDs and Skribbl Lobby API
// ==========================================================================

function generateUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function createSkribblLobby(lobbyId, hostName, settings = {}) {
    const s = settings || {};
    const params = new URLSearchParams({
        lobby_id: lobbyId,
        username: hostName || "Party-Host",
        language: s.language || "german",
        drawing_time: String(s.drawingTime || "80"),
        rounds: String(s.rounds || "3"),
        max_players: "12",
        custom_words: s.customWords || "",
        custom_words_per_turn: "1",
        clients_per_ip_limit: "24",
        words_per_turn: "3",
        word_select_mode: s.mode || "classic",
        score_calculation: "chill"
    });

    const endpoints = ['/skribbl/v1/lobby', '/v1/lobby'];
    for (const ep of endpoints) {
        try {
            const res = await fetch(ep, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });
            if (res.ok) {
                console.log(`Skribbl lobby created successfully via ${ep}:`, lobbyId);
                return true;
            }
        } catch (e) {
            console.warn(`Skribbl creation attempt failed at ${ep}:`, e);
        }
    }
    return false;
}

// ==========================================================================
// Game Modal & Synchronization Flow (Host Controls & Readiness)
// ==========================================================================

window.openGameModal = function(gameId) {
    ensureCurrentUser();
    if (!partyState.isHost) {
        showToast("⚠️ Nur der Party-Leader kann ein Spiel auswählen!");
        return;
    }
    if (gameId === "skribbol" && !partyState.currentLobbyId) {
        partyState.currentLobbyId = generateUUID();
    }
    showModalUI(gameId);
    broadcast({
        type: "OPEN_GAME_MODAL",
        room: ROOM_CODE,
        gameId: gameId,
        lobbyId: partyState.currentLobbyId,
        userId: partyState.currentUser ? partyState.currentUser.id : null,
        initiatedBy: partyState.currentUser ? partyState.currentUser.name : "Party-Host"
    });
};

function showModalUI(gameId) {
    ensureCurrentUser();
    const game = partyState.games[gameId];
    if (!game) return;

    partyState.activeModalGameId = gameId;

    const iconEl = document.getElementById("modalIcon");
    const titleEl = document.getElementById("modalTitle");
    const metaEl = document.getElementById("modalMeta");
    const descEl = document.getElementById("modalDesc");
    const modalEl = document.getElementById("gameModal");

    if (iconEl) iconEl.innerText = game.icon;
    if (titleEl) titleEl.innerText = game.title;
    if (metaEl) metaEl.innerText = `👥 ${game.minPlayers}–${game.maxPlayers} Spieler`;
    if (descEl) descEl.innerText = game.desc;

    // Reset readiness state:
    // Party host is automatically ready. Non-hosts are prompted to click "Ich bin bereit!"
    if (partyState.currentUser) {
        partyState.currentUser.isReady = partyState.isHost ? true : false;
        try {
            sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(partyState.currentUser));
        } catch (e) {}
    }

    const btn = document.getElementById("toggleReadyBtn");
    if (btn) {
        if (partyState.currentUser && partyState.currentUser.isReady) {
            btn.className = "ready-toggle-btn ready";
            btn.innerHTML = `<span>✅</span> <span>Ich bin bereit!</span>`;
        } else {
            btn.className = "ready-toggle-btn not-ready";
            btn.innerHTML = `<span>⏳</span> <span>Bereit melden!</span>`;
        }
    }

    const skribblSettingsSection = document.getElementById("skribblSettingsSection");
    if (skribblSettingsSection) {
        if (gameId === "skribbol") {
            skribblSettingsSection.style.display = "flex";
            applySkribblSettingsUI();
        } else {
            skribblSettingsSection.style.display = "none";
        }
    }

    updateHostPermissionsUI();
    syncPresence();
    renderModalReadiness();

    if (modalEl) modalEl.style.display = "flex";
}

window.closeGameModal = function() {
    const modalEl = document.getElementById("gameModal");
    if (modalEl) modalEl.style.display = "none";
    const skribblSettingsSection = document.getElementById("skribblSettingsSection");
    if (skribblSettingsSection) skribblSettingsSection.style.display = "none";
    partyState.activeModalGameId = null;

    // Only host broadcasts CLOSE_GAME_MODAL to all other players
    if (partyState.isHost) {
        broadcast({ type: "CLOSE_GAME_MODAL" });
    }
};

window.renderModalReadiness = function() {
    ensureCurrentUser();
    const miniContainer = document.getElementById("modalMiniAvatars");
    if (!miniContainer) return;
    miniContainer.innerHTML = "";

    let readyCount = 0;
    const currentId = partyState.currentUser ? partyState.currentUser.id : null;
    const isHostMe = !!partyState.isHost;

    partyState.players.forEach(p => {
        const isReady = p.isReady !== false;
        if (isReady) readyCount++;

        const isMe = p.id === currentId;
        const item = document.createElement("div");
        item.className = "mini-player-item";

        let miniHostBtnHtml = '';
        if (isHostMe && !isMe) {
            miniHostBtnHtml = `
                <button class="mini-transfer-host-btn" type="button" title="${p.name} zum Party-Leader machen">
                    👑 Leader
                </button>
            `;
        }

        item.innerHTML = `
            <div class="mini-avatar ${isReady ? 'is-ready' : ''}" style="border-color: ${p.color || '#6366f1'};">
                ${p.avatar}
                <span class="mini-ready-check">${isReady ? '✓' : '…'}</span>
            </div>
            <span class="mini-player-name">${p.name} ${isMe ? '(Du)' : ''} ${p.isHost ? '👑' : ''}</span>
            ${miniHostBtnHtml}
        `;

        if (isHostMe && !isMe) {
            const btn = item.querySelector(".mini-transfer-host-btn");
            if (btn) {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    transferHostTo(p.id, p.name);
                });
            }
        }

        miniContainer.appendChild(item);
    });

    const statusEl = document.getElementById("readinessStatus");
    if (statusEl) {
        statusEl.innerText = `${readyCount} von ${partyState.players.length} bereit`;
    }

    updateHostPermissionsUI();
};

window.toggleMyReadyState = function() {
    partyState.currentUser.isReady = !partyState.currentUser.isReady;
    try {
        sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(partyState.currentUser));
    } catch (e) {}

    const btn = document.getElementById("toggleReadyBtn");
    if (btn) {
        if (partyState.currentUser.isReady) {
            btn.className = "ready-toggle-btn ready";
            btn.innerHTML = `<span>✅</span> <span>Ich bin bereit!</span>`;
        } else {
            btn.className = "ready-toggle-btn not-ready";
            btn.innerHTML = `<span>⏳</span> <span>Bereit melden!</span>`;
        }
    }

    syncPresence();
    broadcast({
        type: "READY_STATE_CHANGED",
        playerId: partyState.currentUser.id,
        isReady: partyState.currentUser.isReady
    });

    renderModalReadiness();
};

window.launchCurrentGame = async function() {
    if (!partyState.isHost) {
        showToast("⚠️ Nur der Party-Leader kann das Spiel starten!");
        return;
    }

    const gameId = partyState.activeModalGameId;
    const game = partyState.games[gameId];
    if (!game) return;

    const launchBtn = document.getElementById("launchGameBtn");
    if (launchBtn) {
        launchBtn.disabled = true;
        launchBtn.innerText = "⏳ Initialisiere Lobby...";
    }

    let lobbyId = null;
    if (gameId === "skribbol") {
        lobbyId = partyState.currentLobbyId || generateUUID();
        partyState.currentLobbyId = lobbyId;
        const hostName = partyState.currentUser ? partyState.currentUser.name : "Party-Host";

        try {
            await createSkribblLobby(lobbyId, hostName, partyState.skribblSettings);
        } catch (e) {
            console.error("Error creating Skribbl lobby:", e);
        }
    }

    broadcast({
        type: "LAUNCH_GAME",
        room: ROOM_CODE,
        gameId: gameId,
        lobbyId: lobbyId,
        userId: partyState.currentUser ? partyState.currentUser.id : null
    });

    executeCountdownAndLaunch(game, lobbyId);
};

function executeCountdownAndLaunch(game, lobbyId) {
    if (lobbyId) {
        partyState.currentLobbyId = lobbyId;
    }
    const gameModal = document.getElementById("gameModal");
    if (gameModal) gameModal.style.display = "none";

    const countdownEl = document.getElementById("countdownOverlay");
    const numEl = document.getElementById("countdownNumber");
    const titleEl = document.getElementById("countdownTitle");
    const iconEl = document.getElementById("countdownIcon");

    iconEl.innerText = game.icon;
    titleEl.innerText = `${game.title} startet...`;

    countdownEl.style.display = "flex";
    let count = 3;
    numEl.innerText = count;

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            numEl.innerText = count;
        } else {
            clearInterval(interval);
            countdownEl.style.display = "none";
            startGameView(game, partyState.currentLobbyId);
        }
    }, 800);
}

function getSkribblUserSession() {
    let session = sessionStorage.getItem("skribbl_tab_session");
    if (!session) {
        session = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        try {
            sessionStorage.setItem("skribbl_tab_session", session);
        } catch (e) {}
    }
    return session;
}

function getGameUrl(game, lobbyId) {
    const userName = partyState.currentUser ? partyState.currentUser.name : "Gast";
    if (game.id === "skribbol") {
        const id = lobbyId || partyState.currentLobbyId;
        const skribblSession = getSkribblUserSession();
        if (id) {
            return `/skribbl/lobby/${id}?username=${encodeURIComponent(userName)}&usersession=${skribblSession}`;
        }
        // Fallback: Never send party guests to /skribbl/ (isolated lobby creation screen)!
        // Use a deterministic room-scoped lobby id so all guests automatically join the party lobby:
        const fallbackRoomLobby = `room-${ROOM_CODE.toLowerCase()}`;
        return `/skribbl/lobby/${fallbackRoomLobby}?username=${encodeURIComponent(userName)}&usersession=${skribblSession}`;
    } else if (game.id === "uno") {
        return `/uno/?lobby=${encodeURIComponent(ROOM_CODE)}&name=${encodeURIComponent(userName)}`;
    } else if (game.id === "codenames") {
        return `/codenames/g/${encodeURIComponent(ROOM_CODE)}?name=${encodeURIComponent(userName)}`;
    } else if (game.id === "monopoly") {
        return `/monopoly/?room=${encodeURIComponent(ROOM_CODE)}&name=${encodeURIComponent(userName)}&host=${partyState.isHost ? '1' : '0'}`;
    } else if (game.id === "price_guess") {
        return `/price-guess/`;
    }
    return game.embedUrl;
}

function startGameView(game, lobbyId) {
    const overlay = document.getElementById("activeGameOverlay");
    const iframe = document.getElementById("gameIframe");
    const hudTitle = document.getElementById("hudGameTitle");
    const hudIcon = document.getElementById("hudGameIcon");

    hudIcon.innerText = game.icon;
    hudTitle.innerText = `${game.title} • Party-Raum`;

    if (game.id === "skribbol" || game.id === "uno" || game.id === "codenames" || game.id === "monopoly" || game.id === "price_guess") {
        iframe.src = getGameUrl(game, lobbyId);
    } else {
        iframe.srcdoc = `
            <!DOCTYPE html>
            <html style="background: #111827; color: white; font-family: sans-serif; height: 100%;">
            <body style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; margin: 0; text-align: center;">
                <div style="font-size: 5rem; margin-bottom: 20px;">${game.icon}</div>
                <h1 style="font-size: 2.5rem; margin: 0 0 10px 0;">${game.title}</h1>
                <p style="color: #94a3b8; font-size: 1.2rem; max-width: 500px;">
                    👥 Synchron verbunden mit ${partyState.players.length} Freunden • Spielbereit
                </p>
            </body>
            </html>
        `;
    }

    overlay.classList.add("active");
}

function exitActiveGame() {
    if (partyState.isHost) {
        broadcast({ type: "EXIT_GAME" });
    }
    doExitGameView();
}

function doExitGameView() {
    const overlay = document.getElementById("activeGameOverlay");
    const iframe = document.getElementById("gameIframe");
    overlay.classList.remove("active");
    iframe.src = "about:blank";
    showToast("Zurück im Wohnzimmer!");
}

// ==========================================================================
// Voting Mode & Democracy Feature (Synchronized Across Tabs)
// ==========================================================================

function loadVotesFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_VOTES);
        if (raw) {
            const data = JSON.parse(raw);
            partyState.votes = data.votes || partyState.votes;
            partyState.isVotingActive = !!data.isVotingActive;
            applyVoteStateUI();
        }
    } catch (e) {}
}

function saveVotesToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY_VOTES, JSON.stringify({
            votes: partyState.votes,
            isVotingActive: partyState.isVotingActive
        }));
    } catch (e) {}
}

function toggleVoteMode() {
    partyState.isVotingActive = !partyState.isVotingActive;
    saveVotesToStorage();
    sendSocketMessage({
        type: "VOTE_TOGGLE",
        room: ROOM_CODE,
        isVotingActive: partyState.isVotingActive
    });
    broadcast({
        type: "VOTE_UPDATE",
        votes: partyState.votes,
        isVotingActive: partyState.isVotingActive
    });
    applyVoteStateUI();

    if (partyState.isVotingActive) {
        showToast("🗳️ Abstimmung gestartet! Klicke auf dein Wunschspiel.");
    }
}

function applyVoteStateUI() {
    const banner = document.getElementById("voteBanner");
    const toggleBtn = document.getElementById("toggleVoteBtn");

    if (partyState.isVotingActive) {
        if (banner) banner.style.display = "block";
        if (toggleBtn) {
            toggleBtn.classList.add("active");
            toggleBtn.innerText = "✕ Abstimmung aktiv";
        }
        enableCardVoting();
    } else {
        if (banner) banner.style.display = "none";
        if (toggleBtn) {
            toggleBtn.classList.remove("active");
            toggleBtn.innerText = "🗳️ Abstimmung";
        }
        disableCardVoting();
    }
}

function enableCardVoting() {
    Object.keys(partyState.games).forEach(gameId => {
        const counter = document.getElementById(`vote-${gameId}`);
        if (counter) {
            counter.style.display = "block";
            counter.querySelector(".vote-count").innerText = partyState.votes[gameId] || 0;
        }

        const card = document.querySelector(`[data-game-id="${gameId}"]`);
        if (card) {
            const actions = card.querySelector(".card-actions");
            let voteBtn = actions.querySelector(".vote-card-btn");
            if (!voteBtn) {
                voteBtn = document.createElement("button");
                voteBtn.className = "vote-card-btn";
                voteBtn.innerText = "✋ Stimme abgeben";
                voteBtn.onclick = (e) => {
                    e.stopPropagation();
                    castVote(gameId);
                };
                actions.appendChild(voteBtn);
            }
            voteBtn.style.display = "block";
            if (partyState.userVotedGame === gameId) {
                voteBtn.classList.add("voted");
                voteBtn.innerText = "✅ Deine Stimme";
            } else {
                voteBtn.classList.remove("voted");
                voteBtn.innerText = "✋ Stimme abgeben";
            }
        }
    });
}

function disableCardVoting() {
    Object.keys(partyState.games).forEach(gameId => {
        const counter = document.getElementById(`vote-${gameId}`);
        if (counter) counter.style.display = "none";

        const card = document.querySelector(`[data-game-id="${gameId}"]`);
        if (card) {
            const voteBtn = card.querySelector(".vote-card-btn");
            if (voteBtn) voteBtn.style.display = "none";
        }
    });
}

function castVote(gameId) {
    if (partyState.userVotedGame === gameId) {
        partyState.votes[gameId] = Math.max(0, (partyState.votes[gameId] || 0) - 1);
        partyState.userVotedGame = null;
    } else {
        if (partyState.userVotedGame) {
            partyState.votes[partyState.userVotedGame] = Math.max(0, (partyState.votes[partyState.userVotedGame] || 0) - 1);
        }
        partyState.votes[gameId] = (partyState.votes[gameId] || 0) + 1;
        partyState.userVotedGame = gameId;
    }

    saveVotesToStorage();
    if (partyState.currentUser) {
        sendSocketMessage({
            type: "VOTE_CAST",
            room: ROOM_CODE,
            playerId: partyState.currentUser.id,
            gameId: gameId
        });
    }
    broadcast({
        type: "VOTE_UPDATE",
        votes: partyState.votes,
        isVotingActive: partyState.isVotingActive
    });
    applyVoteStateUI();

    showToast(`Stimme erfasst für ${partyState.games[gameId].title}!`);
}

// ==========================================================================
// Roulette (Random Game Picker)
// ==========================================================================

window.spinRoulette = function() {
    if (!partyState.isHost) {
        showToast("⚠️ Nur der Party-Leader kann das Roulette drehen!");
        return;
    }
    const available = ["skribbol", "uno", "codenames", "price_guess", "monopoly"];
    const pick = available[Math.floor(Math.random() * available.length)];
    const chosenGame = partyState.games[pick];

    const card = document.querySelector(`[data-game-id="${pick}"]`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.transform = "scale(1.06)";
        card.style.borderColor = "#ec4899";
        setTimeout(() => {
            card.style.transform = "";
            card.style.borderColor = "";
            openGameModal(pick);
        }, 600);
    }
    showToast(`🎰 Das Schicksal hat entschieden: ${chosenGame.title}!`);
};

// ==========================================================================
// Share & Code Modals
// ==========================================================================

window.openShareModal = function() {
    const modal = document.getElementById("shareModal");
    if (modal) modal.style.display = "flex";
};

window.closeShareModal = function() {
    const modal = document.getElementById("shareModal");
    if (modal) modal.style.display = "none";
};

window.openCodeModal = function() {
    const modal = document.getElementById("codeModal");
    if (modal) {
        modal.style.display = "flex";
        startPartyOpenRoomsPolling();
        const input = document.getElementById("joinCodeInput");
        if (input) {
            input.value = "";
            setTimeout(() => input.focus(), 50);
        }
    }
};

window.closeCodeModal = function() {
    const modal = document.getElementById("codeModal");
    if (modal) modal.style.display = "none";
    const joinModal = document.getElementById("joinModal");
    if (!joinModal || joinModal.style.display === "none") {
        stopPartyOpenRoomsPolling();
    }
};

window.handleCodeSubmit = function(e) {
    if (e) e.preventDefault();
    const input = document.getElementById("joinCodeInput");
    const code = (input ? input.value : "").trim().toUpperCase();
    if (code) {
        enterPartyRoom(code, false);
    }
};

window.generateNewRoomCode = function() {
    const newCode = generatePartyCode(6);
    enterPartyRoom(newCode, true);
};

window.copyShareUrl = function() {
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${ROOM_CODE}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
            showToast(`📋 Code ${ROOM_CODE} & Link kopiert!`);
        }).catch(() => {
            fallbackCopy(shareUrl);
        });
    } else {
        fallbackCopy(shareUrl);
    }
    closeShareModal();
};

function fallbackCopy(text) {
    const input = document.getElementById("shareUrlInput");
    if (input) {
        input.value = text;
        input.select();
        try {
            document.execCommand("copy");
            showToast(`📋 Code ${ROOM_CODE} & Link kopiert!`);
        } catch (e) {
            showToast(`Party-Code: ${ROOM_CODE}`);
        }
    }
}

function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}
