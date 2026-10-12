// =============================================================================
// Among Us - Web Client Engine (HTML5 Canvas + WebSockets)
// =============================================================================

const urlParams = new URLSearchParams(window.location.search);
const ROOM_CODE = (urlParams.get("room") || "PARTY").toUpperCase();
const USER_NAME = urlParams.get("name") || "Crewmate";
const IS_HOST_QUERY = urlParams.get("host") === "1";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

let mapImage = new Image();
mapImage.src = "/static/assets/images/skeld_map.png";

// Audio elements
const sounds = {
    start: new Audio("/static/assets/sounds/roundstart.wav"),
    emergency: new Audio("/static/assets/sounds/alarm_emergency.wav"),
    report: new Audio("/static/assets/sounds/report.wav"),
    task_done: new Audio("/static/assets/sounds/task_complete.wav"),
    vent: new Audio("/static/assets/sounds/vent.wav"),
    kill: new Audio("/static/assets/sounds/kill.wav"),
    win_crew: new Audio("/static/assets/sounds/victory_crew.wav"),
    win_imp: new Audio("/static/assets/sounds/victory_impostor.wav")
};
let soundEnabled = true;

function playSound(name) {
    if (soundEnabled && sounds[name]) {
        sounds[name].currentTime = 0;
        sounds[name].play().catch(() => {});
    }
}

// Client State
let myId = null;
let myRole = "CREWMATE"; // CREWMATE or IMPOSTOR
let myTasks = [];
let myCompletedTasks = [];
let isHost = IS_HOST_QUERY;
let killCooldownLeft = 0;
let lastKillCooldownUpdate = Date.now();

let gameState = {
    code: ROOM_CODE,
    status: "LOBBY",
    players: [],
    dead_bodies: [],
    task_progress: 0,
    meeting: null,
    winner: null,
    winner_reason: null,
    sabotage_lights: false,
    vents: [],
    tasks_def: [],
    rooms: {}
};

// Keyboard inputs
const keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false
};

// Virtual joystick state
let joystickActive = false;
let joystickVector = { x: 0, y: 0 };

// Player physics
let localX = 1100;
let localY = 320;
const MOVE_SPEED = 210; // px/sec

// Camera
let camera = { x: 1100, y: 320 };

function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// =============================================================================
// WebSocket Connection
// =============================================================================
const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsHost = window.location.host;
const ws = new WebSocket(`${wsProto}//${wsHost}/amongus/ws?room=${encodeURIComponent(ROOM_CODE)}&name=${encodeURIComponent(USER_NAME)}&host=${IS_HOST_QUERY ? "1" : "0"}`);

ws.onopen = () => {
    console.log("[AmongUs] Connected to WebSocket server.");
    document.getElementById("room-code-badge").textContent = `Raum: ${ROOM_CODE}`;
};

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "INIT_PLAYER") {
        myId = msg.player_id;
        localX = msg.player.x;
        localY = msg.player.y;
        gameState = msg.state;
        updateUI();
    } else if (msg.type === "ROOM_UPDATE") {
        gameState = msg.state;
        updateUI();
    } else if (msg.type === "PLAYER_MOVED") {
        const p = gameState.players.find(pl => pl.id === msg.player_id);
        if (p && p.id !== myId) {
            p.x = msg.x;
            p.y = msg.y;
        }
    } else if (msg.type === "GAME_STARTED") {
        myRole = msg.your_role;
        myTasks = msg.your_tasks || [];
        myCompletedTasks = [];
        gameState = msg.state;
        killCooldownLeft = 20;
        playSound("start");
        showRoleReveal();
        updateUI();
    } else if (msg.type === "PLAYER_KILLED") {
        playSound("kill");
        gameState = msg.state;
        if (msg.victim_id === myId) {
            // Flash screen red
            showDeathScreen();
        }
        updateUI();
    } else if (msg.type === "TASK_UPDATED") {
        gameState = msg.state;
        if (msg.player_id === myId) {
            if (!myCompletedTasks.includes(msg.task_id)) {
                myCompletedTasks.push(msg.task_id);
            }
            playSound("task_done");
        }
        updateUI();
    } else if (msg.type === "VENT_UPDATED") {
        const p = gameState.players.find(pl => pl.id === msg.player_id);
        if (p) {
            p.in_vent = msg.in_vent;
            p.x = msg.x;
            p.y = msg.y;
        }
        if (msg.player_id === myId) {
            localX = msg.x;
            localY = msg.y;
            playSound("vent");
        }
        updateUI();
    } else if (msg.type === "EMERGENCY_CALLED") {
        gameState = msg.state;
        if (msg.reason === "BODY_REPORTED") {
            playSound("report");
        } else {
            playSound("emergency");
        }
        openMeetingModal();
        updateUI();
    } else if (msg.type === "MEETING_RESOLVED") {
        gameState = msg.state;
        closeMeetingModal();
        handleMeetingResult(msg.result);
        updateUI();
    }
};

// =============================================================================
// Input Listeners
// =============================================================================
window.addEventListener("keydown", (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = true;
    }
    // E for Use / Task
    if (e.key === "e" || e.key === "E") {
        triggerActionUse();
    }
    // Q for Kill
    if (e.key === "q" || e.key === "Q") {
        triggerActionKill();
    }
    // R for Report
    if (e.key === "r" || e.key === "R") {
        triggerActionReport();
    }
    // V for Vent
    if (e.key === "v" || e.key === "V") {
        triggerActionVent();
    }
});

window.addEventListener("keyup", (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = false;
    }
});

// Touch Joystick
const joystickBase = document.getElementById("joystick-base");
const joystickKnob = document.getElementById("joystick-knob");

if (joystickBase) {
    joystickBase.addEventListener("touchstart", handleJoystickStart, { passive: false });
    joystickBase.addEventListener("touchmove", handleJoystickMove, { passive: false });
    joystickBase.addEventListener("touchend", handleJoystickEnd, { passive: false });
}

function handleJoystickStart(e) {
    e.preventDefault();
    joystickActive = true;
    handleJoystickMove(e);
}

function handleJoystickMove(e) {
    if (!joystickActive) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    const dist = Math.hypot(dx, dy);
    const maxRadius = rect.width / 2;

    if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
    }
    joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    joystickVector = { x: dx / maxRadius, y: dy / maxRadius };
}

function handleJoystickEnd(e) {
    e.preventDefault();
    joystickActive = false;
    joystickVector = { x: 0, y: 0 };
    joystickKnob.style.transform = `translate(-50%, -50%)`;
}

// Action Button Listeners
document.getElementById("btn-action-use").addEventListener("click", triggerActionUse);
document.getElementById("btn-action-kill").addEventListener("click", triggerActionKill);
document.getElementById("btn-action-report").addEventListener("click", triggerActionReport);
document.getElementById("btn-action-vent").addEventListener("click", triggerActionVent);
document.getElementById("btn-start-game").addEventListener("click", () => {
    ws.send(JSON.stringify({ action: "START_GAME" }));
});
document.getElementById("btn-add-bot").addEventListener("click", () => {
    ws.send(JSON.stringify({ action: "ADD_BOT" }));
});
document.getElementById("btn-restart-game").addEventListener("click", () => {
    ws.send(JSON.stringify({ action: "RESTART" }));
    document.getElementById("game-over-modal").classList.add("hidden");
});
document.getElementById("btn-sound-toggle").addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    document.getElementById("btn-sound-toggle").textContent = soundEnabled ? "🔊" : "🔇";
});
document.getElementById("btn-map-toggle").addEventListener("click", () => {
    document.getElementById("map-modal").classList.toggle("hidden");
});
document.getElementById("btn-close-map").addEventListener("click", () => {
    document.getElementById("map-modal").classList.add("hidden");
});
document.getElementById("btn-close-task").addEventListener("click", () => {
    document.getElementById("task-minigame-modal").classList.add("hidden");
});
document.getElementById("btn-skip-vote").addEventListener("click", () => {
    ws.send(JSON.stringify({ action: "VOTE", target_id: "SKIP" }));
    document.getElementById("btn-skip-vote").disabled = true;
});

// =============================================================================
// Game Loop (Update & Render)
// =============================================================================
let lastTime = performance.now();
let lastMoveSend = 0;

function gameLoop(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

function update(dt) {
    if (gameState.status !== "PLAYING") return;

    const me = gameState.players.find(p => p.id === myId);
    if (!me || !me.alive || me.in_vent) return;

    // Movement calculation
    let mx = 0;
    let my = 0;

    if (keys.w || keys.ArrowUp) my -= 1;
    if (keys.s || keys.ArrowDown) my += 1;
    if (keys.a || keys.ArrowLeft) mx -= 1;
    if (keys.d || keys.ArrowRight) mx += 1;

    if (joystickActive) {
        mx = joystickVector.x;
        my = joystickVector.y;
    } else {
        const len = Math.hypot(mx, my);
        if (len > 0) {
            mx /= len;
            my /= len;
        }
    }

    if (mx !== 0 || my !== 0) {
        localX += mx * MOVE_SPEED * dt;
        localY += my * MOVE_SPEED * dt;

        // Map boundaries
        localX = Math.max(120, Math.min(1900, localX));
        localY = Math.max(120, Math.min(1000, localY));
        me.x = localX;
        me.y = localY;

        // Send to server throttled (15 times / sec)
        const now = performance.now();
        if (now - lastMoveSend > 65) {
            lastMoveSend = now;
            ws.send(JSON.stringify({ action: "MOVE", x: localX, y: localY }));
        }
    }

    // Camera smoothly tracks player
    camera.x += (localX - camera.x) * 0.15;
    camera.y += (localY - camera.y) * 0.15;

    // Kill cooldown tick
    if (myRole === "IMPOSTOR" && killCooldownLeft > 0) {
        killCooldownLeft = Math.max(0, killCooldownLeft - dt);
        document.getElementById("kill-timer").textContent = Math.ceil(killCooldownLeft);
    }

    checkInteractionProximity();
}

function checkInteractionProximity() {
    const me = gameState.players.find(p => p.id === myId);
    if (!me || !me.alive) return;

    // 1. Report Dead Bodies
    const reportBtn = document.getElementById("btn-action-report");
    let nearBody = false;
    for (const body of gameState.dead_bodies) {
        if (Math.hypot(me.x - body.x, me.y - body.y) < 130) {
            nearBody = true;
            break;
        }
    }
    reportBtn.disabled = !nearBody;

    // 2. Kill Target (Impostor only)
    if (myRole === "IMPOSTOR") {
        const killBtn = document.getElementById("btn-action-kill");
        killBtn.classList.remove("hidden");
        let target = getClosestKillTarget(me);
        killBtn.disabled = (!target || killCooldownLeft > 0 || me.in_vent);
    }

    // 3. Vent (Impostor only)
    if (myRole === "IMPOSTOR") {
        const ventBtn = document.getElementById("btn-action-vent");
        ventBtn.classList.remove("hidden");
        if (me.in_vent) {
            ventBtn.disabled = false;
        } else {
            let nearVent = gameState.vents.some(v => Math.hypot(me.x - v.x, me.y - v.y) < 90);
            ventBtn.disabled = !nearVent;
        }
    }

    // 4. Use Task / Emergency Button
    const useBtn = document.getElementById("btn-action-use");
    let nearTask = getClosestTask(me);
    let nearEmergency = Math.hypot(me.x - 1100, me.y - 320) < 120;
    useBtn.disabled = !(nearTask || nearEmergency);
}

function getClosestKillTarget(me) {
    let closest = null;
    let minDist = 130;
    for (const p of gameState.players) {
        if (p.id !== me.id && p.alive && p.role !== "IMPOSTOR" && !p.in_vent) {
            const d = Math.hypot(me.x - p.x, me.y - p.y);
            if (d < minDist) {
                minDist = d;
                closest = p;
            }
        }
    }
    return closest;
}

function getClosestTask(me) {
    if (myRole !== "CREWMATE") return null;
    for (const t of myTasks) {
        if (!myCompletedTasks.includes(t.id)) {
            if (Math.hypot(me.x - t.x, me.y - t.y) < 100) {
                return t;
            }
        }
    }
    return null;
}

// =============================================================================
// Rendering Engine
// =============================================================================
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Center camera on screen
    ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);

    // 1. Draw Map background
    if (mapImage.complete && mapImage.naturalWidth > 0) {
        ctx.drawImage(mapImage, 0, 0, 2000, 1094);
    } else {
        // Fallback space grid
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, 2000, 1094);
    }

    // 2. Draw Emergency Table / Button in Cafeteria
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(1100, 320, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 3. Draw Vents
    for (const v of gameState.vents) {
        ctx.fillStyle = "#334155";
        ctx.fillRect(v.x - 20, v.y - 12, 40, 24);
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 2;
        ctx.strokeRect(v.x - 20, v.y - 12, 40, 24);
        // Vent slats
        ctx.beginPath();
        ctx.moveTo(v.x - 12, v.y - 6); ctx.lineTo(v.x + 12, v.y - 6);
        ctx.moveTo(v.x - 12, v.y);     ctx.lineTo(v.x + 12, v.y);
        ctx.moveTo(v.x - 12, v.y + 6); ctx.lineTo(v.x + 12, v.y + 6);
        ctx.stroke();
    }

    // 4. Draw Task Stations
    for (const t of gameState.tasks_def) {
        const isMyTask = myTasks.some(mt => mt.id === t.id);
        const isDone = myCompletedTasks.includes(t.id);
        ctx.fillStyle = isDone ? "#10b981" : (isMyTask ? "#f59e0b" : "#475569");
        ctx.beginPath();
        ctx.arc(t.x, t.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
        // Exclamation mark for incomplete task
        if (isMyTask && !isDone) {
            ctx.fillStyle = "#000";
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("!", t.x, t.y + 4);
        }
    }

    // 5. Draw Dead Bodies
    for (const body of gameState.dead_bodies) {
        drawDeadBody(body.x, body.y, body.color.hex);
    }

    // 6. Draw Players
    for (const p of gameState.players) {
        if (!p.alive || p.in_vent) continue;
        drawCrewmate(p.x, p.y, p.color.hex, p.name, p.id === myId, p.role === "IMPOSTOR" && myRole === "IMPOSTOR");
    }

    ctx.restore();

    // 7. Vision / Fog of War (Lights Sabotage)
    if (gameState.sabotage_lights && gameState.status === "PLAYING") {
        drawDarknessVignette();
    }
}

function drawCrewmate(x, y, colorHex, name, isMe, isImpostorPartner) {
    ctx.save();
    ctx.translate(x, y);

    // Body (Capsule / Pill)
    ctx.fillStyle = colorHex;
    ctx.beginPath();
    ctx.arc(0, -10, 18, Math.PI, 0, false);
    ctx.rect(-18, -10, 36, 26);
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Backpack
    ctx.fillStyle = colorHex;
    ctx.beginPath();
    ctx.roundRect(-26, -6, 10, 22, [4]);
    ctx.fill();
    ctx.stroke();

    // Visor (Cyan oval)
    ctx.fillStyle = "#67e8f9";
    ctx.beginPath();
    ctx.ellipse(8, -8, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Visor highlight
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(11, -10, 6, 3, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.fillStyle = colorHex;
    // Left leg
    ctx.fillRect(-16, 16, 12, 10);
    ctx.strokeRect(-16, 16, 12, 10);
    // Right leg
    ctx.fillRect(4, 16, 12, 10);
    ctx.strokeRect(4, 16, 12, 10);

    // Name tag
    ctx.fillStyle = isImpostorPartner ? "#ef4444" : (isMe ? "#38bdf8" : "#ffffff");
    ctx.font = "bold 13px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(name, 0, -34);

    ctx.restore();
}

function drawDeadBody(x, y, colorHex) {
    ctx.save();
    ctx.translate(x, y);
    // Severed lower half
    ctx.fillStyle = colorHex;
    ctx.fillRect(-16, 0, 32, 16);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.strokeRect(-16, 0, 32, 16);

    // Bone sticking out
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-4, -14, 8, 14);
    ctx.beginPath();
    ctx.arc(-4, -14, 4, 0, Math.PI * 2);
    ctx.arc(4, -14, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawDarknessVignette() {
    const w = canvas.width;
    const h = canvas.height;
    const grad = ctx.createRadialGradient(w / 2, h / 2, 80, w / 2, h / 2, 280);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.95)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

// =============================================================================
// Game Actions
// =============================================================================
function triggerActionUse() {
    const me = gameState.players.find(p => p.id === myId);
    if (!me || !me.alive) return;

    // Check emergency button
    if (Math.hypot(me.x - 1100, me.y - 320) < 120) {
        ws.send(JSON.stringify({ action: "CALL_EMERGENCY", reason: "EMERGENCY" }));
        return;
    }

    // Check task
    const task = getClosestTask(me);
    if (task) {
        openTaskMiniGame(task);
    }
}

function triggerActionKill() {
    const me = gameState.players.find(p => p.id === myId);
    if (!me || !me.alive || myRole !== "IMPOSTOR" || killCooldownLeft > 0) return;
    const target = getClosestKillTarget(me);
    if (target) {
        ws.send(JSON.stringify({ action: "KILL", target_id: target.id }));
        killCooldownLeft = 20;
    }
}

function triggerActionReport() {
    ws.send(JSON.stringify({ action: "CALL_EMERGENCY", reason: "BODY_REPORTED" }));
}

function triggerActionVent() {
    const me = gameState.players.find(p => p.id === myId);
    if (!me || !me.alive || myRole !== "IMPOSTOR") return;
    ws.send(JSON.stringify({ action: "VENT_TOGGLE" }));
}

// =============================================================================
// UI & Modals Management
// =============================================================================
function updateUI() {
    // 1. Lobby Modal
    const lobbyModal = document.getElementById("lobby-modal");
    if (gameState.status === "LOBBY") {
        lobbyModal.classList.remove("hidden");
        document.getElementById("player-count").textContent = gameState.players.length;
        const grid = document.getElementById("player-grid");
        grid.innerHTML = "";
        gameState.players.forEach(p => {
            const card = document.createElement("div");
            card.className = "player-card";
            card.innerHTML = `
                <div class="player-color-dot" style="background:${p.color.hex}"></div>
                <span class="player-card-name">${p.name} ${p.is_host ? '👑' : ''}</span>
            `;
            grid.appendChild(card);
        });

        const me = gameState.players.find(p => p.id === myId);
        document.getElementById("btn-start-game").style.display = (me && me.is_host) ? "inline-block" : "none";
        document.getElementById("btn-add-bot").style.display = (me && me.is_host) ? "inline-block" : "none";
    } else {
        lobbyModal.classList.add("hidden");
    }

    // 2. Role badge
    const roleBadge = document.getElementById("role-badge");
    if (gameState.status === "PLAYING" || gameState.status === "MEETING") {
        roleBadge.textContent = myRole;
        if (myRole === "IMPOSTOR") {
            roleBadge.classList.add("impostor");
        } else {
            roleBadge.classList.remove("impostor");
        }
    }

    // 3. Task Progress Bar
    const prog = Math.min(100, Math.round(gameState.task_progress * 100));
    document.getElementById("task-progress-fill").style.width = `${prog}%`;

    // 4. Task List Panel
    const list = document.getElementById("task-items-list");
    if (myRole === "IMPOSTOR") {
        list.innerHTML = `
            <li style="color:#ef4444; font-weight:bold;">Sabotiere und eliminiere die Crew!</li>
            <li>Nutze Lüftungsschächte</li>
            <li>Täusche Aufgaben vor</li>
        `;
    } else {
        list.innerHTML = "";
        myTasks.forEach(t => {
            const isDone = myCompletedTasks.includes(t.id);
            const li = document.createElement("li");
            if (isDone) li.className = "done";
            li.innerHTML = `${isDone ? "✓" : "○"} ${t.name}`;
            list.appendChild(li);
        });
    }

    // 5. Game Over Modal
    if (gameState.status === "GAME_OVER") {
        const gameOverModal = document.getElementById("game-over-modal");
        gameOverModal.classList.remove("hidden");
        document.getElementById("game-over-title").textContent = 
            gameState.winner === "CREWMATES" ? "🏆 CREWMATES GEWINNEN!" : "🔪 VERRÄTER GEWINNEN!";
        document.getElementById("game-over-desc").textContent = gameState.winner_reason || "";
        if (gameState.winner === "CREWMATES") {
            playSound("win_crew");
        } else {
            playSound("win_imp");
        }
    }
}

function showRoleReveal() {
    const modal = document.getElementById("role-reveal-modal");
    const title = document.getElementById("reveal-title");
    const desc = document.getElementById("reveal-desc");

    title.textContent = myRole;
    if (myRole === "IMPOSTOR") {
        title.className = "role-title impostor";
        desc.textContent = "Du bist der Verräter! Eliminiere alle Crewmates unbemerkt.";
    } else {
        title.className = "role-title crewmate";
        desc.textContent = "Erledige alle Aufgaben oder stimme die Verräter raus!";
    }

    modal.classList.remove("hidden");
    setTimeout(() => {
        modal.classList.add("hidden");
    }, 3500);
}

function showDeathScreen() {
    // Red flash animation
    canvas.style.filter = "brightness(0.3) sepia(1) hue-rotate(-50deg) saturate(5)";
    setTimeout(() => {
        canvas.style.filter = "none";
    }, 600);
}

function openMeetingModal() {
    const modal = document.getElementById("meeting-modal");
    modal.classList.remove("hidden");
    document.getElementById("btn-skip-vote").disabled = false;

    const grid = document.getElementById("voting-players-grid");
    grid.innerHTML = "";

    const me = gameState.players.find(p => p.id === myId);

    gameState.players.forEach(p => {
        const card = document.createElement("div");
        card.className = `vote-card ${!p.alive ? 'dead' : ''}`;
        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <div class="player-color-dot" style="background:${p.color.hex}"></div>
                <span style="font-weight:700;">${p.name} ${!p.alive ? ' (Tot)' : ''}</span>
            </div>
            <span>${p.has_voted ? '✓' : ''}</span>
        `;

        if (p.alive && me && me.alive) {
            card.onclick = () => {
                ws.send(JSON.stringify({ action: "VOTE", target_id: p.id }));
                document.querySelectorAll(".vote-card").forEach(c => c.classList.remove("selected"));
                card.classList.add("selected");
            };
        }
        grid.appendChild(card);
    });
}

function closeMeetingModal() {
    document.getElementById("meeting-modal").classList.add("hidden");
}

function handleMeetingResult(result) {
    let msg = "";
    if (result.ejected) {
        msg = `${result.ejected.name} wurde aus der Luftschleuse geworfen! ` + 
              (result.was_impostor ? "Er war ein Verräter!" : "Er war KEIN Verräter!");
    } else {
        msg = "Niemand wurde hinausgeworfen (Gleichstand oder Übersprungen).";
    }
    alert(msg);
}

// =============================================================================
// Task Mini-Games (Wiring, Swipe Card, Asteroids)
// =============================================================================
function openTaskMiniGame(task) {
    const modal = document.getElementById("task-minigame-modal");
    const title = document.getElementById("minigame-title");
    const content = document.getElementById("minigame-content");

    title.textContent = task.name;
    modal.classList.remove("hidden");

    if (task.type === "wires") {
        renderWiringGame(content, task);
    } else if (task.type === "swipe") {
        renderSwipeCardGame(content, task);
    } else {
        // Generic click-to-complete task
        content.innerHTML = `
            <p style="text-align:center; color:#cbd5e1;">Kalibriere die Raumschiff-Komponente...</p>
            <button id="btn-complete-quick-task" class="btn btn-primary" style="margin-top:20px;">
                ⚙️ Kalibrierung durchführen
            </button>
        `;
        document.getElementById("btn-complete-quick-task").onclick = () => {
            ws.send(JSON.stringify({ action: "TASK_COMPLETE", task_id: task.id }));
            modal.classList.add("hidden");
        };
    }
}

function renderWiringGame(container, task) {
    const colors = ["#ef4444", "#3b82f6", "#eab308", "#ec4899"];
    let leftSelected = null;
    let connected = 0;

    container.innerHTML = `
        <p style="color:#94a3b8; font-size:0.85rem;">Verbinde gleichfarbige Drähte:</p>
        <div class="wire-container">
            <div class="wire-col" id="wire-left">
                ${colors.map((c, i) => `<div class="wire-node" style="background:${c}" data-color="${c}"></div>`).join("")}
            </div>
            <div class="wire-col" id="wire-right">
                ${[...colors].reverse().map((c, i) => `<div class="wire-node" style="background:${c}" data-color="${c}"></div>`).join("")}
            </div>
        </div>
    `;

    const leftNodes = container.querySelectorAll("#wire-left .wire-node");
    const rightNodes = container.querySelectorAll("#wire-right .wire-node");

    leftNodes.forEach(node => {
        node.onclick = () => {
            leftNodes.forEach(n => n.style.borderColor = "#fff");
            node.style.borderColor = "#10b981";
            leftSelected = node.dataset.color;
        };
    });

    rightNodes.forEach(node => {
        node.onclick = () => {
            if (leftSelected && leftSelected === node.dataset.color) {
                node.style.borderColor = "#10b981";
                node.style.pointerEvents = "none";
                connected++;
                leftSelected = null;
                if (connected >= 4) {
                    setTimeout(() => {
                        ws.send(JSON.stringify({ action: "TASK_COMPLETE", task_id: task.id }));
                        document.getElementById("task-minigame-modal").classList.add("hidden");
                    }, 400);
                }
            }
        };
    });
}

function renderSwipeCardGame(container, task) {
    container.innerHTML = `
        <div style="text-align:center;">
            <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:12px;">Ziehe die ID-Karte durch das Lesegerät:</p>
            <div style="width:280px; height:60px; background:#1e293b; border:2px dashed #475569; border-radius:8px; display:flex; align-items:center; padding:4px; position:relative;" id="swipe-track">
                <div id="card-slider" style="width:60px; height:48px; background:#38bdf8; border-radius:6px; cursor:grab; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#0f172a; position:absolute; left:4px;">
                    💳
                </div>
            </div>
            <p id="swipe-status" style="margin-top:14px; font-weight:bold; color:#e2e8f0;">Nicht durchgezogen</p>
        </div>
    `;

    const slider = container.querySelector("#card-slider");
    const track = container.querySelector("#swipe-track");
    let isDragging = false;
    let startX = 0;

    slider.onmousedown = (e) => {
        isDragging = true;
        startX = e.clientX;
    };

    window.onmousemove = (e) => {
        if (!isDragging) return;
        const trackRect = track.getBoundingClientRect();
        let newLeft = e.clientX - trackRect.left - 30;
        newLeft = Math.max(4, Math.min(trackRect.width - 64, newLeft));
        slider.style.left = `${newLeft}px`;

        if (newLeft >= trackRect.width - 70) {
            isDragging = false;
            document.getElementById("swipe-status").textContent = "Erfolgreich autorisiert!";
            document.getElementById("swipe-status").style.color = "#10b981";
            setTimeout(() => {
                ws.send(JSON.stringify({ action: "TASK_COMPLETE", task_id: task.id }));
                document.getElementById("task-minigame-modal").classList.add("hidden");
            }, 500);
        }
    };

    window.onmouseup = () => {
        isDragging = false;
    };
}
