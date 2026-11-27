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
    exec python3 - "$0" "$WEBHOOK_PORT" "$WEBHOOK_SECRET" "$LOG_FILE" <<'PYEOF'
import http.server, json, os, subprocess, sys, threading

script_path, port, secret, log_file = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
lock = threading.Lock()

class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/update":
            return self._send(404, {"error": "Not found"})
        if secret:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {secret}":
                return self._send(403, {"error": "Unauthorized"})
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(min(length, 8192))
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            body = {}
        channel = str(body.get("channel") or "stable").strip().lower()
        if channel not in ("stable", "upstream", "experimentell"):
            return self._send(400, {"error": "Invalid channel"})
        if not lock.acquire(blocking=False):
            return self._send(409, {"error": "Update already running"})

        def run():
            try:
                with open(log_file, "ab") as lf:
                    subprocess.run([script_path, channel, "--force"], stdout=lf, stderr=subprocess.STDOUT, check=False)
            finally:
                lock.release()

        threading.Thread(target=run, daemon=True).start()
        self._send(202, {"ok": True, "message": f"Update ({channel}) auf Unraid gestartet."})

    def log_message(self, fmt, *args):
        pass

http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
PYEOF
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
    -e "TREFFEN_UPDATE_CHANNEL=$CHANNEL" \
    -e "TREFFEN_UPDATE_WEBHOOK_URL=$WEBHOOK_URL" \
    "${EXTRA_ENV[@]}" \
    --label "net.unraid.docker.managed=dockerman" \
    --label "net.unraid.docker.webui=http://[IP]:${HOST_PORT}" \
    --restart unless-stopped \
    "${IMAGE_NAME}:latest"

docker rmi "${IMAGE_NAME}:test" 2>/dev/null || true
echo "✅ Fertig! '$CONTAINER_NAME' läuft jetzt auf ${REMOTE_SHA:0:7} (Kanal: $CHANNEL)."
