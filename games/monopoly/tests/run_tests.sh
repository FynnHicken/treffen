#!/usr/bin/env bash
# Führt alle Monopoly-Tests in Podman/Docker aus. Nichts wird auf dem Host installiert.
#   ./games/monopoly/tests/run_tests.sh            # alle Tests
#   ./games/monopoly/tests/run_tests.sh rules      # nur test_rules_ws.py (rules|driver|sim)
set -euo pipefail
cd "$(dirname "$0")/.."            # -> games/monopoly
ENGINE=$(command -v podman || command -v docker)
IMAGE=localhost/mono-test-deps

# Image bauen, falls nicht vorhanden oder requirements.txt neuer ist
if ! $ENGINE image exists "$IMAGE" 2>/dev/null; then
    echo "== Baue Test-Image $IMAGE"
    tmp=$(mktemp -d); cp requirements.txt tests/Containerfile "$tmp/"
    $ENGINE build -q -t "$IMAGE" -f "$tmp/Containerfile" "$tmp" >/dev/null; rm -rf "$tmp"
fi

run_ws_test() {  # $1 = Testdatei; startet einen frischen Server im selben Container
    echo; echo "=================== $1"
    $ENGINE run --rm -e MONOPOLY_AWAY_GRACE_SEC=3 -v "$PWD":/src:ro,Z "$IMAGE" sh -c "
        cd /src && (python -u server/main.py >/tmp/server.log 2>&1 &) ; sleep 3
        timeout 300 python -I tests/$1; rc=\$?
        n=\$(grep -c Traceback /tmp/server.log || true)
        echo \"Server-Tracebacks: \$n\"; [ \"\$n\" = 0 ] || grep -A8 Traceback /tmp/server.log | head -40
        exit \$rc"
}
run_sim_test() {
    echo; echo "=================== test_bot_ai_sim.py"
    $ENGINE run --rm -v "$PWD":/src:ro,Z "$IMAGE" sh -c "cd /tmp && timeout 900 python -I /src/tests/test_bot_ai_sim.py > /tmp/out.txt 2>&1; rc=\$?; grep -v '^\[Room\|^INFO' /tmp/out.txt; exit \$rc"
}

what=${1:-all}
rc=0
[[ $what == all || $what == rules  ]] && { run_ws_test test_rules_ws.py  || rc=1; }
[[ $what == all || $what == driver ]] && { run_ws_test test_driver_ws.py || rc=1; }
[[ $what == all || $what == sim    ]] && { run_sim_test                   || rc=1; }
echo; [[ $rc == 0 ]] && echo "✅ Alle Testdateien bestanden." || echo "❌ Mindestens eine Testdatei ist fehlgeschlagen."
exit $rc
