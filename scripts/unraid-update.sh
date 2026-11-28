#!/usr/bin/env bash
set -euo pipefail

# =========================================================================
# Treffen Auto-Updater für Unraid (CLI/Cron + Host-Webhook für Hub-UI)
# =========================================================================
# Nutzung:
#   ./scripts/unraid-update.sh [stable|upstream|experimentell] [--force]
#   ./scripts/unraid-update.sh --serve-webhook
# =========================================================================

APP_DIR="${TREFFEN_APP_DIR:-/mnt/user/appdata/treffen}"
CONTAINER_NAME="${TREFFEN_CONTAINER_NAME:-Treffen}"
IMAGE_NAME="${TREFFEN_IMAGE_NAME:-treffen-allinone}"
HOST_PORT="${TREFFEN_HOST_PORT:-8000}"
WEBHOOK_PORT="${TREFFEN_UPDATE_WEBHOOK_PORT:-9876}"
WEBHOOK_SECRET="${TREFFEN_UPDATE_WEBHOOK_SECRET:-}"
WEBHOOK_URL="${TREFFEN_UPDATE_WEBHOOK_URL:-http://172.17.0.1:${WEBHOOK_PORT}/update}"
LOG_FILE="${TREFFEN_UPDATE_LOG:-/tmp/treffen-unraid-update.log}"

channel_repo_branch() {
    case "$1" in
        stable)        echo "https://github.com/FynnHicken/treffen.git main" ;;
        upstream)      echo "https://github.com/NobleBrains/treffen.git main" ;;
        experimentell) echo "https://github.com/FynnHicken/treffen.git experimentell" ;;
        *)             echo "" ;;
    esac
}

if [[ "${1:-}" == "--serve-webhook" ]]; then
    echo "🎧 Starte Treffen Unraid-Update-Webhook auf Port ${WEBHOOK_PORT}..."
    NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
    exec env WEBHOOK_SCRIPT="$0" WEBHOOK_PORT="$WEBHOOK_PORT" WEBHOOK_SECRET="$WEBHOOK_SECRET" WEBHOOK_LOG="$LOG_FILE" "$NODE_BIN" -e '
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");

const scriptPath = process.env.WEBHOOK_SCRIPT;
const port = parseInt(process.env.WEBHOOK_PORT || "9876", 10);
const secret = process.env.WEBHOOK_SECRET || "";
const logFile = process.env.WEBHOOK_LOG || "/tmp/treffen-unraid-update.log";
let busy = false;

function send(res, code, data) {
    const body = JSON.stringify(data);
    res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
}

http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/update") return send(res, 404, { error: "Not found" });
    if (secret && req.headers["authorization"] !== `Bearer ${secret}`) return send(res, 403, { error: "Unauthorized" });
    let raw = "";
    req.on("data", c => { if (raw.length < 8192) raw += c; });
    req.on("end", () => {
        let body = {};
        try { body = JSON.parse(raw || "{}"); } catch {}
        const channel = String(body.channel || "stable").trim().toLowerCase();
        if (!["stable", "upstream", "experimentell"].includes(channel)) return send(res, 400, { error: "Invalid channel" });
        if (busy) return send(res, 409, { error: "Update already running" });
        busy = true;
        const out = fs.openSync(logFile, "a");
        const child = spawn(scriptPath, [channel, "--force"], { detached: true, stdio: ["ignore", out, out] });
        child.on("exit", () => { busy = false; try { fs.closeSync(out); } catch {} });
        child.on("error", () => { busy = false; try { fs.closeSync(out); } catch {} });
        send(res, 202, { ok: true, message: `Update (${channel}) auf Unraid gestartet.` });
    });
}).listen(port, "0.0.0.0", () => {
    console.log(`Webhook bereit auf 0.0.0.0:${port}`);
});
'
fi

CHANNEL="stable"
FORCE=0
for arg in "$@"; do
    case "$arg" in
        --force|-f) FORCE=1 ;;
        stable|upstream|experimentell) CHANNEL="$arg" ;;
        *) echo "Unbekanntes Argument: $arg"; exit 1 ;;
    esac
done

SPEC="$(channel_repo_branch "$CHANNEL")"
REPO_URL="${SPEC%% *}"
BRANCH="${SPEC##* }"

echo "🔄 Prüfe Update für Kanal '$CHANNEL' ($REPO_URL @ $BRANCH)..."
REMOTE_SHA="$(git ls-remote "$REPO_URL" "refs/heads/$BRANCH" | awk '{print $1}')"
if [[ -z "$REMOTE_SHA" ]]; then
    echo "❌ Konnte Remote-SHA nicht abrufen."
    exit 1
fi

RUNNING_SHA="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER_NAME" 2>/dev/null | sed -n 's/^TREFFEN_COMMIT_SHA=//p' || true)"
if [[ "$FORCE" -eq 0 && -n "$RUNNING_SHA" && "$RUNNING_SHA" == "$REMOTE_SHA" ]]; then
    echo "✅ Container '$CONTAINER_NAME' läuft bereits auf dem neusten Stand (${REMOTE_SHA:0:7})."
    exit 0
fi

echo "⬇️  Aktualisiere Repository in $APP_DIR auf ${REMOTE_SHA:0:7}..."
cd "$APP_DIR"
git fetch "$REPO_URL" "$BRANCH"
git checkout -B "$BRANCH" FETCH_HEAD

BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "🔨 Baue Docker-Image ${IMAGE_NAME}:test (SHA ${REMOTE_SHA:0:7})..."
docker build \
    -f Dockerfile.fly \
    --build-arg "TREFFEN_COMMIT_SHA=$REMOTE_SHA" \
    --build-arg "TREFFEN_BUILD_DATE=$BUILD_DATE" \
    -t "${IMAGE_NAME}:test" .

echo "🚀 Tausche Container '$CONTAINER_NAME'..."
docker tag "${IMAGE_NAME}:test" "${IMAGE_NAME}:latest"
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

EXTRA_ENV=()
if [[ -n "$WEBHOOK_SECRET" ]]; then
    EXTRA_ENV+=(-e "TREFFEN_UPDATE_WEBHOOK_SECRET=$WEBHOOK_SECRET")
fi

docker run -d \
    --name="$CONTAINER_NAME" \
    --net=bridge \
    -p "${HOST_PORT}:8080" \
    -e TZ=Europe/Berlin \
    -e HOST_OS="Unraid" \
    -e HOST_HOSTNAME="$(hostname)" \
    -e HOST_CONTAINERNAME="$CONTAINER_NAME" \
    -e "TREFFEN_COMMIT_SHA=$REMOTE_SHA" \
    -e "TREFFEN_BUILD_DATE=$BUILD_DATE" \
    -e "TREFFEN_UPDATE_DEFAULT_CHANNEL=$CHANNEL" \
    -e "TREFFEN_UPDATE_WEBHOOK_URL=$WEBHOOK_URL" \
    "${EXTRA_ENV[@]}" \
    --label "net.unraid.docker.managed=dockerman" \
    --label "net.unraid.docker.webui=http://[IP]:${HOST_PORT}" \
    --restart unless-stopped \
    "${IMAGE_NAME}:latest"

docker rmi "${IMAGE_NAME}:test" 2>/dev/null || true
echo "✅ Fertig! '$CONTAINER_NAME' läuft jetzt auf ${REMOTE_SHA:0:7} (Kanal: $CHANNEL)."
