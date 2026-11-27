// ==========================================================================
// Hub-Kacheln
// ==========================================================================
// Die Lobby ist ein Raster aus Kacheln. Jede Kachel ist ein Eintrag in HUB_TILES:
//
//   { id, size, label, show?(ctx), render(ctx) }      eine Kachel
//   { id, each(ctx) → [Kachel, …] }                    mehrere Kacheln (z. B. eine pro Spiel)
//
//   size   "hero" (2×2) · "wide" (2×1) · "small" (1×1)
//   show   optional – false blendet die Kachel aus (z. B. Abstimmung nur, wenn eine läuft)
//   render liefert das innere HTML. Alles, was von anderen Clients kommt (Namen, Avatare),
//          VOR der Ausgabe mit escapeHtml()/safeColor() behandeln.
//
// Kachel hinzufügen = Eintrag ergänzen, entfernen = Eintrag löschen, Reihenfolge = Reihenfolge
// im Array. Klicks laufen über data-act="…" und die Tabelle TILE_ACTIONS unten.
// Gerendert wird nur, was sich geändert hat – renderHubTiles() kann man also oft aufrufen.

const HUB_TILES = [
    { id: "stage", size: "hero", label: "Ausgewähltes Spiel", render: renderStageTile },
    { id: "invite", size: "small", label: "Einladen", render: renderInviteTile },
    { id: "players", size: "small", label: "Spieler", render: renderPlayersTile },
    { id: "today", size: "wide", label: "Heute gespielt", show: ctx => !ctx.voting, render: renderTodayTile },
    { id: "vote", size: "wide", label: "Abstimmung", show: ctx => ctx.voting, render: renderVoteTile, domId: "voteBanner" },
    { id: "games", each: ctx => ctx.games.map(g => ({
        id: "game-" + g.id, size: "small", label: g.title, gameId: g.id, render: () => renderGameTile(g, ctx)
    })) },
    { id: "random", size: "small", label: "Zufall", render: renderRandomTile },
    { id: "room", size: "small", label: "Raum", render: renderRoomTile }
];

// --------------------------------------------------------------------------
// Zustand für die Kacheln (einmal pro Rendern berechnet)
// --------------------------------------------------------------------------

function hubCtx() {
    const players = partyState.players || [];
    const n = Math.max(1, players.length);
    const me = partyState.currentUser;
    const host = players.find(p => p.isHost);
    const overlay = document.getElementById("activeGameOverlay");
    const inGame = !!(overlay && overlay.classList.contains("active"));
    const active = partyState.activeGame && partyState.games[partyState.activeGame.gameId] ? partyState.activeGame : null;
    const voting = !!partyState.isVotingActive;
    const votes = partyState.votes || {};
    const games = Object.values(partyState.games).map(g => ({ ...g, fit: gameFit(g, n), votes: votes[g.id] || 0 }));

    let selId = partyState.selectedGameId;
    if (active) selId = active.gameId;
    if (!selId || !partyState.games[selId]) {
        const top = voting ? [...games].sort((a, b) => b.votes - a.votes)[0] : null;
        selId = top && top.votes > 0 ? top.id : (games.find(g => g.fit.tone === "ok") || games[0]).id;
    }
    return {
        players, n, me, host, voting, games, active, running: !!active && !inGame,
        isHost: !!partyState.isHost,
        canVoteToggle: canToggleVoting(),
        sel: games.find(g => g.id === selId),
        voteTotal: Object.values(votes).reduce((s, v) => s + (v || 0), 0),
        history: Array.isArray(partyState.history) ? partyState.history : []
    };
}

/** Passt das Spiel zur Runde? short = Chip auf der Kachel, long = Text auf der Bühne. */
function gameFit(game, n) {
    const max = game.maxPlayers;
    if (n < game.minPlayers) return { short: `AB ${game.minPlayers}`, long: `ab ${game.minPlayers} Spielern`, tone: "warn" };
    if (n > max) {
        if (game.spectators) {
            const rest = n - max;
            return { short: `${max}+${rest}`, long: `${max} spielen · ${rest} ${rest === 1 ? "schaut" : "schauen"} zu`, tone: "ok" };
        }
        return { short: `MAX ${max}`, long: `nur ${max} können mitspielen`, tone: "warn" };
    }
    if ((game.minutes || 0) >= 60) return { short: "LANG", long: "passt · dauert lange", tone: "long" };
    return { short: "PASST", long: n === 1 ? "passt" : `passt für alle ${n}`, tone: "ok" };
}

function gameMeta(g) {
    const time = g.minutes >= 60 ? "60+ Min" : `${g.minutes} Min`;
    return `${g.minPlayers}–${g.maxPlayers} · ${time}`;
}

function coverHtml(g, cls) {
    if (g.cover) return `<img class="${cls}" src="${escapeHtml(g.cover)}" alt="" loading="lazy">`;
    // Spiele ohne Titelbild (Codenames): Muster aus Kartenfarben
    const colors = ["#ff6b6b", "#5aa0ff", "#3a3f63", "#5aa0ff", "#ff6b6b"];
    const cells = Array.from({ length: 25 }, (_, i) => `<span style="background:${colors[(i * 7 + 3) % 5]}"></span>`).join("");
    return `<div class="${cls} cover-pattern" aria-hidden="true">${cells}</div>`;
}

function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; }
}

// --------------------------------------------------------------------------
// Die Kacheln
// --------------------------------------------------------------------------

function renderStageTile(ctx) {
    const g = ctx.sel;
    const hostName = ctx.host ? escapeHtml(ctx.host.name) : "Der Host";
    let badge = "AUSGEWÄHLT", badgeCls = "";
    if (ctx.active && ctx.active.gameId === g.id) { badge = "LÄUFT GERADE"; badgeCls = "live"; }
    else if (ctx.voting && g.votes > 0 && g.votes === Math.max(...ctx.games.map(x => x.votes))) badge = "TOP-WAHL";

    const buttons = [];
    let note = "";
    if (ctx.running) {
        buttons.push(`<button type="button" class="btn-neon green" data-act="rejoin" id="stageRejoinBtn">WIEDER EINSTEIGEN</button>`);
        note = `${escapeHtml(partyState.games[ctx.active.gameId].title)} läuft gerade`;
    } else if (ctx.isHost) {
        buttons.push(`<button type="button" class="btn-neon" data-act="start" data-game="${g.id}" id="stageStartBtn">START FÜR ALLE</button>`);
        note = ctx.voting ? `${g.votes} ${g.votes === 1 ? "hätte" : "hätten"} Lust` : "";
    } else {
        note = `${hostName} wählt aus und startet`;
    }
    if (ctx.voting && !ctx.running) {
        const mine = partyState.userVotedGame === g.id;
        buttons.push(`<button type="button" class="btn-outline magenta ${mine ? "on" : ""}" data-act="vote" data-game="${g.id}" id="stageVoteBtn">${mine ? "✓ DEINE STIMME" : "+1 HÄTTE LUST"}</button>`);
    }
    return `
        ${coverHtml(g, "stage-media")}
        <div class="stage-shade"></div>
        <span class="stage-badge ${badgeCls}">${badge}</span>
        <div class="stage-body">
            <h1 class="stage-title">${escapeHtml(g.title)}</h1>
            <p class="stage-desc">${escapeHtml(g.desc || "")}</p>
            <div class="chips">
                <span class="chip">${g.minPlayers}–${g.maxPlayers} Spieler</span>
                <span class="chip">ca. ${g.minutes >= 60 ? "60+" : g.minutes} Min</span>
                <span class="chip ${g.fit.tone}">${escapeHtml(g.fit.long)}</span>
            </div>
            <div class="stage-actions">${buttons.join("")}<span class="stage-note">${note}</span></div>
        </div>`;
}

function renderInviteTile() {
    const url = `${window.location.origin}${window.location.pathname}?room=${ROOM_CODE}`;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(url)}`;
    return `
        <div class="invite-text">
            <span class="tile-label">EINLADEN</span>
            <button type="button" class="invite-code" data-act="copy" title="Klicken zum Kopieren">${escapeHtml(ROOM_CODE)}</button>
            <div class="invite-actions">
                <button type="button" class="btn-outline cyan small" data-act="copy">Link kopieren</button>
                <button type="button" class="btn-outline small invite-qr-btn" data-act="share" title="QR-Code groß anzeigen">QR</button>
            </div>
        </div>
        <button type="button" class="invite-qr" data-act="share" title="QR-Code groß anzeigen">
            <img src="${qr}" alt="QR-Code zum Beitreten">
        </button>`;
}

function renderPlayersTile(ctx) {
    const myId = ctx.me ? ctx.me.id : null;
    const rows = ctx.players.map(p => {
        const isMe = p.id === myId;
        const crownBtn = ctx.isHost && !isMe
            ? `<button type="button" class="slot-crown" data-act="host" data-player="${escapeHtml(p.id)}" title="${escapeHtml(p.name)} zum Host machen">👑</button>` : "";
        return `
            <div class="slot ${p.isHost ? "host" : ""}" title="${escapeHtml(p.status || "Bereit")}">
                <span class="slot-avatar" style="border-color:${safeColor(p.color)}">${renderAvatarHtml(p.avatar, p.color)}</span>
                <span class="slot-name">${escapeHtml(p.name)}${isMe ? " <small>(Du)</small>" : ""}</span>
                ${p.isHost ? '<span class="slot-tag">HOST</span>' : crownBtn}
            </div>`;
    }).join("");
    return `
        <div class="tile-head"><span class="tile-label">SPIELER</span><span class="tile-count">${ctx.players.length}</span></div>
        <div class="slots">${rows || '<span class="muted">Noch niemand da</span>'}</div>`;
}

function renderTodayTile(ctx) {
    const items = ctx.history.slice(-3).reverse().map((h, i) => {
        const g = partyState.games[h.gameId];
        if (!g) return "";
        const live = i === 0 && ctx.active && ctx.active.gameId === h.gameId;
        return `
            <button type="button" class="today-item ${live ? "live" : ""}" data-act="select" data-game="${escapeHtml(h.gameId)}" title="${escapeHtml(g.title)} auswählen">
                ${coverHtml(g, "today-thumb")}
                <span class="today-text">
                    <span class="today-time">${live ? "LÄUFT" : fmtTime(h.startedAt)}</span>
                    <span class="today-title">${escapeHtml(g.title)}</span>
                </span>
            </button>`;
    }).join("");
    const startVote = ctx.canVoteToggle
        ? `<button type="button" class="btn-dashed" data-act="vote-toggle" id="toggleVoteBtn">Uneinig? Abstimmung starten</button>` : "";
    return `
        <div class="tile-head"><span class="tile-label">HEUTE GESPIELT</span>${startVote}</div>
        ${items ? `<div class="today-list">${items}</div>` : `<p class="muted today-empty">Noch nichts gespielt. Sucht euch ein Spiel aus – der Host startet es für alle.</p>`}`;
}

function renderVoteTile(ctx) {
    const ranked = ctx.games.filter(g => g.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 3);
    const max = Math.max(1, ctx.n);
    const rows = ranked.map((g, i) => `
        <div class="vote-row">
            <span class="vote-title">${escapeHtml(g.title)}</span>
            <span class="vote-bar"><span style="width:${Math.round(g.votes / max * 100)}%" class="${i === 0 ? "lead" : ""}"></span></span>
            <span class="vote-num">${g.votes}</span>
        </div>`).join("");
    const end = ctx.canVoteToggle ? `<button type="button" class="btn-outline small" data-act="vote-toggle" id="closeVoteBtn">Beenden</button>` : "";
    return `
        <div class="tile-head">
            <span class="tile-label magenta"><span class="dot"></span>ABSTIMMUNG LÄUFT · ${ctx.voteTotal} VON ${ctx.players.length}</span>${end}
        </div>
        ${rows || '<p class="muted">Noch keine Stimmen. Spiel antippen und „+1 Hätte Lust“ drücken.</p>'}`;
}

function renderGameTile(g, ctx) {
    const on = ctx.sel && ctx.sel.id === g.id;
    const mine = partyState.userVotedGame === g.id;
    const votes = ctx.voting && g.votes > 0 ? `<span class="game-votes ${mine ? "mine" : ""}"><span class="vote-count">${g.votes}</span> ✋</span>` : "";
    const fitCls = g.fit.tone === "warn" ? "warn-fit" : "";
    return `
        <button type="button" class="game-btn ${on ? "on" : ""} ${fitCls}" data-act="select" data-game="${g.id}" aria-pressed="${on}">
            <span class="game-media">${coverHtml(g, "game-cover")}${votes}</span>
            <span class="game-info">
                <span class="game-text"><span class="game-title">${escapeHtml(g.title)}</span><span class="game-meta">${gameMeta(g)}</span></span>
                <span class="fit ${g.fit.tone}">${escapeHtml(g.fit.short)}</span>
            </span>
        </button>`;
}

function renderRandomTile(ctx) {
    return `
        <button type="button" class="game-btn" data-act="random">
            <span class="game-media random-media" aria-hidden="true">🎰</span>
            <span class="game-info">
                <span class="game-text"><span class="game-title">Zufall</span><span class="game-meta">${ctx.isHost ? "Hebel ziehen" : "Host zieht den Hebel"}</span></span>
                <span class="fit ok">ALLE</span>
            </span>
        </button>`;
}

function renderRoomTile(ctx) {
    const who = partyState.hubSettings && partyState.hubSettings.anyoneCanVote ? "alle" : "nur Host";
    return `
        <span class="tile-label">RAUM</span>
        <div class="room-facts">
            <span><span class="muted">Abstimmung starten:</span> ${who}</span>
        </div>
        <div class="room-actions">
            ${ctx.isHost ? '<button type="button" class="btn-outline small" data-act="settings">⚙️ Einstellungen</button>' : ""}
            <button type="button" class="btn-outline small" data-act="room">Raum wechseln</button>
        </div>`;
}

// --------------------------------------------------------------------------
// Klicks
// --------------------------------------------------------------------------

const TILE_ACTIONS = {
    select: el => { partyState.selectedGameId = el.dataset.game; renderHubTiles(); scrollStageIntoViewOnPhone(); },
    start: el => openGameModal(el.dataset.game),
    vote: el => castVote(el.dataset.game),
    "vote-toggle": () => toggleVoteMode(),
    rejoin: () => { const a = partyState.activeGame; if (a && partyState.games[a.gameId]) startGameView(partyState.games[a.gameId], a.lobbyId); },
    random: () => {
        if (!partyState.isHost) { showToast("🎰 Den Hebel zieht der Host."); return; }
        openSlotMachineModal();
    },
    copy: () => copyShareUrl(),
    share: () => openShareModal(),
    host: el => {
        const p = (partyState.players || []).find(x => x.id === el.dataset.player);
        if (p) transferHostTo(p.id, p.name);
    },
    settings: () => openHubSettingsModal(),
    room: () => openCodeModal()
};

function scrollStageIntoViewOnPhone() {
    if (window.matchMedia("(max-width: 720px)").matches) {
        const stage = document.querySelector('[data-tile="stage"]');
        if (stage) stage.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function setupTileGrid() {
    const grid = document.getElementById("tileGrid");
    if (!grid || grid._wired) return;
    grid._wired = true;
    grid.addEventListener("click", e => {
        const el = e.target.closest("[data-act]");
        if (!el || !grid.contains(el)) return;
        const fn = TILE_ACTIONS[el.dataset.act];
        if (fn) { e.preventDefault(); fn(el); }
    });
}

// --------------------------------------------------------------------------
// Rendern (nur geänderte Kacheln werden neu geschrieben)
// --------------------------------------------------------------------------

function renderHubTiles() {
    const grid = document.getElementById("tileGrid");
    if (!grid || !ROOM_CODE) return;
    setupTileGrid();
    const ctx = hubCtx();
    const specs = [];
    for (const t of HUB_TILES) {
        if (t.each) specs.push(...t.each(ctx));
        else if (!t.show || t.show(ctx)) specs.push(t);
    }
    const keep = new Set();
    specs.forEach((t, i) => {
        let el = grid.querySelector(`:scope > [data-tile="${t.id}"]`);
        if (!el) {
            el = document.createElement("section");
            el.dataset.tile = t.id;
            if (t.gameId) el.dataset.gameId = t.gameId;
            if (t.domId) el.id = t.domId;
            el.setAttribute("aria-label", t.label || t.id);
        }
        const cls = `tile tile-${t.size || "small"} tile--${t.id.replace(/^game-.*/, "game")}`;
        if (el.className !== cls) el.className = cls;
        let html;
        try { html = t.render(ctx); } catch (err) { console.error(`Kachel ${t.id}:`, err); html = '<span class="muted">Kachel konnte nicht geladen werden.</span>'; }
        if (el._html !== html) { el.innerHTML = html; el._html = html; }
        if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
        keep.add(el);
    });
    [...grid.children].forEach(c => { if (!keep.has(c)) c.remove(); });

    const online = document.getElementById("onlineCount");
    if (online) online.textContent = `${ctx.players.length} IM RAUM`;
}
