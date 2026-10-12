// =============================================================================
// Imposter Game Client
// =============================================================================

const urlParams = new URLSearchParams(window.location.search);
const ROOM_CODE = (urlParams.get("room") || "PARTY").toUpperCase();
const USER_NAME = urlParams.get("name") || "Spieler";
const IS_HOST_QUERY = urlParams.get("host") === "1";

let myId = null;
let gameState = null;

// DOM Elements
const roomCodeTag = document.getElementById("room-code-tag");
const categoryBadge = document.getElementById("category-badge");
const phaseBadge = document.getElementById("phase-badge");
const secretCard = document.getElementById("secret-card");
const cardFront = secretCard.querySelector(".card-front");
const cardRevealed = document.getElementById("card-revealed-content");

// Phases
const phaseLobby = document.getElementById("phase-lobby");
const phaseClues = document.getElementById("phase-clues");
const phaseDiscussion = document.getElementById("phase-discussion");
const phaseVoting = document.getElementById("phase-voting");
const phaseGuessing = document.getElementById("phase-guessing");
const phaseOver = document.getElementById("phase-over");

// WebSocket Setup
const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsHost = window.location.host;
const ws = new WebSocket(`${wsProto}//${wsHost}/imposter/ws?room=${encodeURIComponent(ROOM_CODE)}&name=${encodeURIComponent(USER_NAME)}&host=${IS_HOST_QUERY ? "1" : "0"}`);

ws.onopen = () => {
    roomCodeTag.textContent = `Raum: ${ROOM_CODE}`;
};

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "ROOM_STATE") {
        gameState = msg.state;
        updateUI();
    }
};

// Secret Card Reveal on Hold / Click
let isHoldingCard = false;
secretCard.addEventListener("mousedown", revealCard);
secretCard.addEventListener("mouseup", hideCard);
secretCard.addEventListener("mouseleave", hideCard);
secretCard.addEventListener("touchstart", (e) => { e.preventDefault(); revealCard(); });
secretCard.addEventListener("touchend", hideCard);

function revealCard() {
    if (!gameState) return;
    cardFront.classList.add("hidden");
    cardRevealed.classList.remove("hidden");

    if (gameState.your_role === "IMPOSTER") {
        cardRevealed.className = "card-revealed imposter";
        cardRevealed.innerHTML = `
            <div class="role-tag-big imposter">🕵️ DU BIST DER IMPOSTER!</div>
            <p style="color:#ef4444; font-weight:700;">Kategorie: ${gameState.category}</p>
            <p style="color:#cbd5e1; font-size:0.85rem;">Du kennst das Geheimwort nicht. Höre den anderen genau zu und bluffe!</p>
        `;
    } else if (gameState.your_role === "PLAYER") {
        cardRevealed.className = "card-revealed";
        cardRevealed.innerHTML = `
            <div class="role-tag-big player">👥 NORMALER SPIELER</div>
            <p style="color:#94a3b8; font-size:0.85rem;">Kategorie: ${gameState.category}</p>
            <div class="secret-word-display">${gameState.secret_word || "---"}</div>
            <p style="color:#cbd5e1; font-size:0.85rem;">Gib einen unauffälligen Hinweis, ohne dem Imposter das Wort zu verraten!</p>
        `;
    } else {
        cardRevealed.innerHTML = `<p>Warte auf Spielstart...</p>`;
    }
}

function hideCard() {
    cardFront.classList.remove("hidden");
    cardRevealed.classList.add("hidden");
}

// Action Button Handlers
document.getElementById("btn-add-bot").onclick = () => {
    ws.send(JSON.stringify({ action: "ADD_BOT" }));
};

document.getElementById("btn-start-round").onclick = () => {
    const cat = document.getElementById("select-category").value;
    ws.send(JSON.stringify({ action: "START_ROUND", category: cat }));
};

document.getElementById("clue-form").onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById("clue-input");
    const val = input.value.trim();
    if (val) {
        ws.send(JSON.stringify({ action: "SUBMIT_CLUE", clue: val }));
        input.value = "";
    }
};

document.getElementById("btn-proceed-voting").onclick = () => {
    ws.send(JSON.stringify({ action: "START_VOTING" }));
};

document.getElementById("btn-submit-guess").onclick = () => {
    const input = document.getElementById("guess-input");
    const val = input.value.trim();
    if (val) {
        ws.send(JSON.stringify({ action: "SUBMIT_GUESS", guess: val }));
    }
};

document.getElementById("btn-next-round").onclick = () => {
    ws.send(JSON.stringify({ action: "START_ROUND" }));
};

document.getElementById("btn-lobby").onclick = () => {
    ws.send(JSON.stringify({ action: "RETURN_TO_LOBBY" }));
};

// UI Update
function updateUI() {
    if (!gameState) return;

    categoryBadge.textContent = gameState.category || "Kategorie";
    phaseBadge.textContent = gameState.status;

    // Populate category dropdown
    const selectCat = document.getElementById("select-category");
    if (selectCat && selectCat.options.length === 0 && gameState.categories) {
        gameState.categories.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c;
            opt.textContent = c;
            selectCat.appendChild(opt);
        });
    }

    // Hide all phase panels
    [phaseLobby, phaseClues, phaseDiscussion, phaseVoting, phaseGuessing, phaseOver].forEach(p => p.classList.add("hidden"));

    const me = gameState.players.find(p => p.name === USER_NAME);
    const isHost = me && me.is_host;

    // 1. Lobby
    if (gameState.status === "LOBBY") {
        phaseLobby.classList.remove("hidden");
        document.getElementById("player-count").textContent = gameState.players.length;
        const grid = document.getElementById("lobby-roster-grid");
        grid.innerHTML = "";
        gameState.players.forEach(p => {
            const pill = document.createElement("div");
            pill.className = "roster-pill";
            pill.innerHTML = `<span>${p.name}</span><span>${p.is_host ? '👑' : ''} ${p.is_bot ? '🤖' : ''}</span>`;
            grid.appendChild(pill);
        });
        document.getElementById("host-lobby-controls").style.display = isHost ? "flex" : "none";
    }

    // 2. Clues Phase
    else if (gameState.status === "CLUES") {
        phaseClues.classList.remove("hidden");
        const activeSpeaker = gameState.players.find(p => p.id === gameState.current_speaker_id);
        const announcement = document.getElementById("turn-announcement");
        const isMyTurn = (activeSpeaker && activeSpeaker.name === USER_NAME);

        announcement.textContent = isMyTurn ? "👉 DU BIST DRAN! Gib deinen Hinweis ein:" : `⏳ Am Zug: ${activeSpeaker ? activeSpeaker.name : '---'}`;
        document.getElementById("my-turn-input-box").classList.toggle("hidden", !isMyTurn);

        // Clue History
        const hist = document.getElementById("clue-history-container");
        hist.innerHTML = "";
        gameState.players.forEach(p => {
            if (p.clues && p.clues.length > 0) {
                p.clues.forEach(c => {
                    const bubble = document.createElement("div");
                    bubble.className = "clue-bubble";
                    bubble.innerHTML = `<strong>${p.name}:</strong> <span class="clue-word">${c}</span>`;
                    hist.appendChild(bubble);
                });
            }
        });
    }

    // 3. Discussion Phase
    else if (gameState.status === "DISCUSSION") {
        phaseDiscussion.classList.remove("hidden");
        document.getElementById("discussion-timer").textContent = `${gameState.discussion_remaining}s`;

        const summary = document.getElementById("discussion-clues-summary");
        summary.innerHTML = "";
        gameState.players.forEach(p => {
            const card = document.createElement("div");
            card.className = "clue-card";
            card.innerHTML = `
                <div style="font-weight:bold; color:#38bdf8;">${p.name}</div>
                <div style="margin-top:4px; font-weight:700;">${p.clues.join(", ") || "-"}</div>
            `;
            summary.appendChild(card);
        });

        document.getElementById("btn-proceed-voting").parentElement.style.display = isHost ? "flex" : "none";
    }

    // 4. Voting Phase
    else if (gameState.status === "VOTING") {
        phaseVoting.classList.remove("hidden");
        const vGrid = document.getElementById("voting-cards-grid");
        vGrid.innerHTML = "";

        gameState.players.forEach(p => {
            const btn = document.createElement("div");
            btn.className = `vote-btn-card ${p.has_voted ? 'voted' : ''}`;
            btn.innerHTML = `<span>${p.name}</span>`;
            btn.onclick = () => {
                ws.send(JSON.stringify({ action: "VOTE", target_id: p.id }));
                document.querySelectorAll(".vote-btn-card").forEach(c => c.classList.remove("selected"));
                btn.classList.add("selected");
            };
            vGrid.appendChild(btn);
        });

        const votedCount = gameState.players.filter(p => p.has_voted).length;
        document.getElementById("voting-status-text").textContent = `Stimmen abgegeben: ${votedCount} / ${gameState.players.length}`;
    }

    // 5. Guessing Phase
    else if (gameState.status === "GUESSING") {
        phaseGuessing.classList.remove("hidden");
        const isImposter = (gameState.your_role === "IMPOSTER");

        document.getElementById("imposter-guess-box").classList.toggle("hidden", !isImposter);
        document.getElementById("spectator-wait-guess").classList.toggle("hidden", isImposter);
    }

    // 6. Round Over Phase
    else if (gameState.status === "ROUND_OVER") {
        phaseOver.classList.remove("hidden");
        document.getElementById("winner-title").textContent = 
            gameState.winner === "IMPOSTER" ? "🕵️ DER IMPOSTER GEWINNT!" : "🎉 DIE GRUPPE GEWINNT!";
        document.getElementById("winner-desc").textContent = gameState.winner_reason || "";
        document.getElementById("secret-word-reveal").textContent = `Geheimes Wort: ${gameState.secret_word}`;

        // Scoreboard
        const sb = document.getElementById("scoreboard-container");
        sb.innerHTML = "<h3 style='margin-bottom:8px;'>Punktestand:</h3>";
        gameState.players.sort((a,b) => b.score - a.score).forEach(p => {
            const row = document.createElement("div");
            row.style.cssText = "display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #334155;";
            row.innerHTML = `<span>${p.name} (${p.role === 'IMPOSTER' ? '🕵️' : '👥'})</span><strong>${p.score} Punkte</strong>`;
            sb.appendChild(row);
        });
    }
}
