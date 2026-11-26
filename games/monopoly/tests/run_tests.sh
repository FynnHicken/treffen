#!/usr/bin/env bash
# Führt alle Monopoly-Tests in Podman/Docker aus. Nichts wird auf dem Host installiert.
#   ./games/monopoly/tests/run_tests.sh            # alle Tests
#   ./games/monopoly/tests/run_tests.sh rules      # nur test_rules_ws.py (rules|auth|driver|settings|sim)
set -euo pipefail
cd "$(dirname "$0")/.."            # -> games/monopoly
ENGINE=$(command -v podman || command -v docker)
# Image-Tag hängt am Inhalt von requirements.txt → nach einem Versions-Update wird automatisch neu gebaut
REQ_HASH=$( (shasum -a 256 2>/dev/null || sha256sum) < requirements.txt | cut -c1-12)
IMAGE=localhost/mono-test-deps:$REQ_HASH

if ! $ENGINE image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "== Baue Test-Image $IMAGE"
    tmp=$(mktemp -d); cp requirements.txt tests/Containerfile "$tmp/"
    $ENGINE build -q -t "$IMAGE" -f "$tmp/Containerfile" "$tmp" >/dev/null; rm -rf "$tmp"
    $ENGINE tag "$IMAGE" localhost/mono-test-deps:latest  # für den Dev-Server-Befehl in DEVELOPMENT.md
fi

run_ws_test() {  # $1 = Testdatei, $2 = optionaler Ticket-Schlüssel; startet einen frischen Server im selben Container
    echo; echo "=================== $1"
    $ENGINE run --rm -e MONOPOLY_AWAY_GRACE_SEC=3 -e TREFFEN_TICKET_SECRET="${2:-}" -v "$PWD":/src:ro,z "$IMAGE" sh -c "
        cd /src && (python -u server/main.py >/tmp/server.log 2>&1 &) ; sleep 3
        timeout 300 python -I tests/$1; rc=\$?
        n=\$(grep -c Traceback /tmp/server.log || true)
        echo \"Server-Tracebacks: \$n\"; [ \"\$n\" = 0 ] || grep -A8 Traceback /tmp/server.log | head -40
        exit \$rc"
}
run_inproc_test() {  # $1 = Testdatei; läuft im Prozess gegen den Server-Code (kein Netz)
    echo; echo "=================== $1"
    $ENGINE run --rm -v "$PWD":/src:ro,z "$IMAGE" sh -c "cd /tmp && timeout 900 python -I /src/tests/$1 > /tmp/out.txt 2>&1; rc=\$?; grep -v '^\[Room\|^INFO' /tmp/out.txt; exit \$rc"
}

what=${1:-all}
rc=0
[[ $what == all || $what == rules  ]] && { run_ws_test test_rules_ws.py  || rc=1; }
[[ $what == all || $what == auth   ]] && { run_ws_test test_auth_ws.py test-ticket-secret || rc=1; }
[[ $what == all || $what == driver ]] && { run_ws_test test_driver_ws.py || rc=1; }
[[ $what == all || $what == settings ]] && { run_inproc_test test_settings.py   || rc=1; }
[[ $what == all || $what == sim    ]] && { run_inproc_test test_bot_ai_sim.py || rc=1; }
echo; [[ $rc == 0 ]] && echo "✅ Alle Testdateien bestanden." || echo "❌ Mindestens eine Testdatei ist fehlgeschlagen."
exit $rc
