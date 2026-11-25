// ==========================================================================
// Treffen Avatar System – Skribbl-style Torso Color + Freehand Drawn Face
// ==========================================================================

const AVATAR_BODY_COLORS = [
    "#ef4444", "#f97316", "#facc15", "#22c55e",
    "#10b981", "#06b6d4", "#3b82f6", "#6366f1",
    "#8b5cf6", "#ec4899", "#f43f5e", "#92400e",
    "#64748b", "#f8fafc"
];

const AVATAR_PEN_COLORS = [
    { color: "#111827", label: "Schwarz" },
    { color: "#ffffff", label: "Weiß" },
    { color: "#ef4444", label: "Rot" },
    { color: "#3b82f6", label: "Blau" },
    { color: "#facc15", label: "Gelb" },
    { color: "#22c55e", label: "Grün" },
    { color: "#ec4899", label: "Pink" },
    { color: "#92400e", label: "Braun" }
];

const AVATAR_BRUSH_SIZES = [
    { size: 5, label: "Dünn", dot: 6 },
    { size: 10, label: "Mittel", dot: 11 },
    { size: 17, label: "Dick", dot: 16 }
];

const AVATAR_DATA_URL_RE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]{1,32768}$/;
const AVATAR_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function isSafeAvatarDataUrl(val) {
    return typeof val === "string" && AVATAR_DATA_URL_RE.test(val.trim());
}

function sanitizeAvatarColor(val) {
    return typeof val === "string" && AVATAR_COLOR_RE.test(val) ? val : "#6366f1";
}

function renderDefaultFaceSvg() {
    return `
        <svg class="treffen-avatar-face" viewBox="0 0 100 100" aria-hidden="true">
            <g transform="translate(22, 11) scale(0.56)">
                <circle cx="35" cy="42" r="7" fill="#111827" />
                <circle cx="65" cy="42" r="7" fill="#111827" />
                <circle cx="37" cy="40" r="2.2" fill="#ffffff" />
                <circle cx="67" cy="40" r="2.2" fill="#ffffff" />
                <path d="M33,62 Q50,76 67,62" fill="none" stroke="#111827" stroke-width="6.5" stroke-linecap="round" />
            </g>
        </svg>
    `;
}

function renderAvatarHtml(avatarValue, colorValue, extraClass = "") {
    const bodyColor = sanitizeAvatarColor(colorValue);
    const faceHtml = isSafeAvatarDataUrl(avatarValue)
        ? `<img class="treffen-avatar-face" src="${avatarValue.trim()}" alt="" draggable="false" />`
        : renderDefaultFaceSvg();

    return `
        <div class="treffen-avatar ${extraClass}">
            <svg class="treffen-avatar-body" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M14,104 C14,72 30,62 50,62 C70,62 86,72 86,104 Z" fill="${bodyColor}" stroke="#1e293b" stroke-width="5" stroke-linejoin="round" />
                <circle cx="50" cy="39" r="28" fill="${bodyColor}" stroke="#1e293b" stroke-width="5" />
                <path d="M31,24 A22,22 0 0,1 48,16" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="3.5" stroke-linecap="round" />
            </svg>
            ${faceHtml}
        </div>
    `;
}

function drawRandomFaceOnContext(ctx, size) {
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    // Kopf-Bereich im 100x100-Charakter-Koordinatensystem: x=22%, y=11%, w=56%, h=56%
    ctx.translate(size * 0.22, size * 0.11);
    const s = (size * 0.56) / 100;
    const ink = "#111827";
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Eyes
    const eyeStyle = Math.floor(Math.random() * 5);
    if (eyeStyle === 0) {
        // Classic dots with shine
        [34, 66].forEach(x => {
            ctx.beginPath();
            ctx.arc(x * s, 42 * s, 6.5 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc((x + 2) * s, 39.5 * s, 2.2 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = ink;
        });
    } else if (eyeStyle === 1) {
        // Happy ^ ^ eyes
        ctx.lineWidth = 5.5 * s;
        [34, 66].forEach(x => {
            ctx.beginPath();
            ctx.arc(x * s, 46 * s, 9 * s, Math.PI * 1.15, Math.PI * 1.85);
            ctx.stroke();
        });
    } else if (eyeStyle === 2) {
        // Big googly eyes
        [34, 66].forEach((x, idx) => {
            ctx.fillStyle = "#ffffff";
            ctx.lineWidth = 4 * s;
            ctx.beginPath();
            ctx.arc(x * s, 40 * s, 10.5 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.arc((x + (idx === 0 ? 2 : -2)) * s, 41 * s, 4.5 * s, 0, Math.PI * 2);
            ctx.fill();
        });
    } else if (eyeStyle === 3) {
        // Wink
        ctx.beginPath();
        ctx.arc(34 * s, 42 * s, 6.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 5.5 * s;
        ctx.beginPath();
        ctx.moveTo(57 * s, 42 * s);
        ctx.lineTo(74 * s, 42 * s);
        ctx.stroke();
    } else {
        // Cool shades
        ctx.fillStyle = "#111827";
        ctx.fillRect(19 * s, 33 * s, 26 * s, 16 * s);
        ctx.fillRect(55 * s, 33 * s, 26 * s, 16 * s);
        ctx.lineWidth = 5 * s;
        ctx.beginPath();
        ctx.moveTo(45 * s, 38 * s);
        ctx.lineTo(55 * s, 38 * s);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        ctx.moveTo(24 * s, 37 * s);
        ctx.lineTo(31 * s, 37 * s);
        ctx.moveTo(60 * s, 37 * s);
        ctx.lineTo(67 * s, 37 * s);
        ctx.stroke();
        ctx.strokeStyle = ink;
    }

    // Eyebrows (sometimes)
    if (eyeStyle !== 4 && Math.random() > 0.35) {
        ctx.lineWidth = 4 * s;
        const tilt = (Math.random() - 0.5) * 6;
        ctx.beginPath();
        ctx.moveTo(25 * s, (27 + tilt) * s);
        ctx.lineTo(42 * s, (27 - tilt) * s);
        ctx.moveTo(58 * s, (27 - tilt) * s);
        ctx.lineTo(75 * s, (27 + tilt) * s);
        ctx.stroke();
    }

    // Mouth
    const mouthStyle = Math.floor(Math.random() * 4);
    ctx.lineWidth = 5.5 * s;
    if (mouthStyle === 0) {
        ctx.beginPath();
        ctx.arc(50 * s, 56 * s, 17 * s, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
    } else if (mouthStyle === 1) {
        // Open grin
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(50 * s, 59 * s, 16 * s, 0, Math.PI);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (mouthStyle === 2) {
        // Surprised O
        ctx.beginPath();
        ctx.ellipse(50 * s, 68 * s, 7 * s, 9 * s, 0, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        // Smirk
        ctx.beginPath();
        ctx.moveTo(35 * s, 66 * s);
        ctx.quadraticCurveTo(53 * s, 74 * s, 68 * s, 60 * s);
        ctx.stroke();
    }
    ctx.restore();
}

function createAvatarEditor(containerEl, opts = {}) {
    if (!containerEl) return null;

    const INTERNAL_SIZE = 200;
    const EXPORT_SIZE = 200;
    const MAX_UNDO = 20;

    let bodyColor = sanitizeAvatarColor(opts.initialColor);
    let penColor = AVATAR_PEN_COLORS[0].color;
    let brushSize = AVATAR_BRUSH_SIZES[1].size;
    let isEraser = false;
    let isDrawing = false;
    let lastPt = null;
    const undoStack = [];

    containerEl.innerHTML = `
        <div class="avatar-editor">
            <div class="avatar-editor-stage-wrap">
                <div class="avatar-editor-stage">
                    <svg class="treffen-avatar-body" viewBox="0 0 100 100" aria-hidden="true">
                        <path class="ae-body-path" d="M14,104 C14,72 30,62 50,62 C70,62 86,72 86,104 Z" fill="${bodyColor}" stroke="#1e293b" stroke-width="5" stroke-linejoin="round" />
                        <circle class="ae-head-circle" cx="50" cy="39" r="28" fill="${bodyColor}" stroke="#1e293b" stroke-width="5" />
                        <path d="M31,24 A22,22 0 0,1 48,16" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="3.5" stroke-linecap="round" />
                    </svg>
                    <canvas class="avatar-draw-canvas" width="${INTERNAL_SIZE}" height="${INTERNAL_SIZE}"></canvas>
                </div>
                <span class="avatar-editor-hint">Male direkt auf deinen Charakter</span>
            </div>

            <div class="avatar-editor-controls">
                <div class="ae-section">
                    <span class="ae-label">Körperfarbe</span>
                    <div class="ae-color-grid"></div>
                </div>

                <div class="ae-section">
                    <span class="ae-label">Stiftfarbe & Größe</span>
                    <div class="ae-pen-row">
                        <div class="ae-pen-colors"></div>
                        <div class="ae-brush-sizes"></div>
                    </div>
                </div>

                <div class="ae-actions">
                    <button type="button" class="ae-tool-btn ae-eraser-btn" title="Radierer">🧽 Radierer</button>
                    <button type="button" class="ae-tool-btn ae-undo-btn" title="Rückgängig">↩️ Zurück</button>
                    <button type="button" class="ae-tool-btn ae-clear-btn" title="Gesicht leeren">🗑️ Leeren</button>
                    <button type="button" class="ae-tool-btn ae-random-btn" title="Zufalls-Gesicht">🎲 Zufall</button>
                </div>
            </div>
        </div>
    `;

    const canvas = containerEl.querySelector(".avatar-draw-canvas");
    const ctx = canvas.getContext("2d");
    const bodyPath = containerEl.querySelector(".ae-body-path");
    const headCircle = containerEl.querySelector(".ae-head-circle");
    const colorGrid = containerEl.querySelector(".ae-color-grid");
    const penColorsEl = containerEl.querySelector(".ae-pen-colors");
    const brushSizesEl = containerEl.querySelector(".ae-brush-sizes");
    const eraserBtn = containerEl.querySelector(".ae-eraser-btn");
    const undoBtn = containerEl.querySelector(".ae-undo-btn");
    const clearBtn = containerEl.querySelector(".ae-clear-btn");
    const randomBtn = containerEl.querySelector(".ae-random-btn");

    function pushUndo() {
        try {
            undoStack.push(ctx.getImageData(0, 0, INTERNAL_SIZE, INTERNAL_SIZE));
            if (undoStack.length > MAX_UNDO) undoStack.shift();
        } catch (e) {}
    }

    function notifyChange() {
        if (typeof opts.onChange === "function") {
            opts.onChange({ color: bodyColor, avatar: exportFaceDataUrl() });
        }
    }

    function updateBodyColor(newColor) {
        bodyColor = sanitizeAvatarColor(newColor);
        if (bodyPath) bodyPath.setAttribute("fill", bodyColor);
        if (headCircle) headCircle.setAttribute("fill", bodyColor);
        colorGrid.querySelectorAll(".ae-color-swatch").forEach(btn => {
            btn.classList.toggle("selected", btn.dataset.color === bodyColor);
        });
        notifyChange();
    }

    // Populate body colors
    AVATAR_BODY_COLORS.forEach(c => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `ae-color-swatch ${c === bodyColor ? "selected" : ""}`;
        btn.dataset.color = c;
        btn.style.background = c;
        btn.title = c;
        btn.addEventListener("click", () => updateBodyColor(c));
        colorGrid.appendChild(btn);
    });

    // Populate pen colors
    AVATAR_PEN_COLORS.forEach(p => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `ae-pen-swatch ${p.color === penColor && !isEraser ? "selected" : ""}`;
        btn.dataset.color = p.color;
        btn.style.background = p.color;
        btn.title = p.label;
        btn.addEventListener("click", () => {
            isEraser = false;
            penColor = p.color;
            eraserBtn.classList.remove("active");
            penColorsEl.querySelectorAll(".ae-pen-swatch").forEach(el => {
                el.classList.toggle("selected", el.dataset.color === penColor);
            });
        });
        penColorsEl.appendChild(btn);
    });

    // Populate brush sizes
    AVATAR_BRUSH_SIZES.forEach(b => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `ae-brush-btn ${b.size === brushSize ? "selected" : ""}`;
        btn.dataset.size = String(b.size);
        btn.title = b.label;
        btn.innerHTML = `<span style="width:${b.dot}px;height:${b.dot}px;"></span>`;
        btn.addEventListener("click", () => {
            brushSize = b.size;
            brushSizesEl.querySelectorAll(".ae-brush-btn").forEach(el => {
                el.classList.toggle("selected", Number(el.dataset.size) === brushSize);
            });
        });
        brushSizesEl.appendChild(btn);
    });

    eraserBtn.addEventListener("click", () => {
        isEraser = !isEraser;
        eraserBtn.classList.toggle("active", isEraser);
        penColorsEl.querySelectorAll(".ae-pen-swatch").forEach(el => {
            el.classList.toggle("selected", !isEraser && el.dataset.color === penColor);
        });
    });

    undoBtn.addEventListener("click", () => {
        if (undoStack.length === 0) return;
        const prev = undoStack.pop();
        ctx.putImageData(prev, 0, 0);
        notifyChange();
    });

    clearBtn.addEventListener("click", () => {
        pushUndo();
        ctx.clearRect(0, 0, INTERNAL_SIZE, INTERNAL_SIZE);
        notifyChange();
    });

    randomBtn.addEventListener("click", () => {
        pushUndo();
        drawRandomFaceOnContext(ctx, INTERNAL_SIZE);
        notifyChange();
    });

    // Pointer drawing on canvas
    function getCanvasPoint(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) / rect.width) * INTERNAL_SIZE,
            y: ((e.clientY - rect.top) / rect.height) * INTERNAL_SIZE
        };
    }

    function strokeSegment(from, to) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = brushSize;
        if (isEraser) {
            ctx.globalCompositeOperation = "destination-out";
            ctx.strokeStyle = "rgba(0,0,0,1)";
        } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = penColor;
        }
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.restore();
    }

    canvas.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        pushUndo();
        isDrawing = true;
        lastPt = getCanvasPoint(e);
        strokeSegment(lastPt, { x: lastPt.x + 0.01, y: lastPt.y + 0.01 });
    });

    canvas.addEventListener("pointermove", (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        const pt = getCanvasPoint(e);
        strokeSegment(lastPt, pt);
        lastPt = pt;
    });

    function finishStroke() {
        if (!isDrawing) return;
        isDrawing = false;
        lastPt = null;
        notifyChange();
    }

    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);

    // Initialize face
    if (isSafeAvatarDataUrl(opts.initialFace)) {
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, INTERNAL_SIZE, INTERNAL_SIZE);
            ctx.drawImage(img, 0, 0, INTERNAL_SIZE, INTERNAL_SIZE);
        };
        img.src = opts.initialFace.trim();
    } else {
        drawRandomFaceOnContext(ctx, INTERNAL_SIZE);
    }

    function exportFaceDataUrl() {
        let url = canvas.toDataURL("image/png");
        if (url.length > 32000) {
            url = canvas.toDataURL("image/webp", 0.9);
        }
        if (url.length > 32000) {
            const out = document.createElement("canvas");
            out.width = 140;
            out.height = 140;
            out.getContext("2d").drawImage(canvas, 0, 0, 140, 140);
            url = out.toDataURL("image/webp", 0.85);
        }
        return isSafeAvatarDataUrl(url) ? url : "";
    }

    return {
        getColor: () => bodyColor,
        getFaceDataUrl: exportFaceDataUrl
    };
}
