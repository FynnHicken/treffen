"""Pflicht-Prüfung aller Tisch-Spiele im Repo (tabletop_server/conformance.py).

Findet jedes Spiel unter games/*/server/main.py, das den Spieltisch nutzt, und lässt Computer ganze Partien
spielen – jedes Spiel in einem eigenen Python-Prozess (Module wie layout/rules heißen überall gleich).
    python -I packages/tabletop-server/tests/test_conformance.py [Partien je Spiel]
Ein Spiel kann über `conformance_settings` an seinen Regeln Hausregeln für den Test setzen (z. B. schneller Computer).
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 10

CHILD = r'''
import os, runpy, sys
sys.path.insert(0, sys.argv[2])
ns = runpy.run_path(sys.argv[1], run_name="conformance")
from tabletop_server.conformance import check_game
game = ns["GAME"]
check_game(game, games=int(sys.argv[3]), settings=getattr(game.rules, "conformance_settings", None))
print(f"  OK   {game.id}: Version {game.version}, Engine {game.info()['engine']}, Regel-API {game.rules_api}")
'''

fails = []

# Engine-Version: Server (version.py) und Client (version.ts) müssen gleich sein, CHANGELOG muss sie kennen
import re  # noqa: E402
py = re.search(r'ENGINE_VERSION = "([^"]+)"', (ROOT / "packages/tabletop-server/tabletop_server/version.py").read_text()).group(1)
ts = re.search(r"ENGINE_VERSION = '([^']+)'", (ROOT / "packages/tabletop/src/version.ts").read_text()).group(1)
log = (ROOT / "packages/CHANGELOG.md").read_text(encoding="utf-8")
print(f"== Engine-Version: Server {py}, Client {ts} ==")
if py != ts:
    print(f"  FAIL Server {py} ≠ Client {ts} (version.py / version.ts angleichen)")
    fails.append("Versionen")
elif f"## {py}" not in log:
    print(f"  FAIL packages/CHANGELOG.md hat keinen Abschnitt „## {py}“")
    fails.append("CHANGELOG")
else:
    print("  OK   gleich und im CHANGELOG beschrieben")

mains = sorted(p for p in ROOT.glob("games/*/server/main.py") if "tabletop_server" in p.read_text(encoding="utf-8"))
print(f"== Pflicht-Prüfung: {len(mains)} Tisch-Spiel(e), je {GAMES} Partien ==")
for main in mains:
    # keine Spielstand-Datei; TABLETOP_CONFORMANCE: Spiele dürfen schnelle Computer nehmen (z. B. kein Stockfish)
    env = {**os.environ, "TABLETOP_DB": "", "TABLETOP_CONFORMANCE": "1"}
    r = subprocess.run([sys.executable, "-I", "-c", CHILD, str(main), str(ROOT / "packages" / "tabletop-server"), str(GAMES)],
                       capture_output=True, text=True, env=env, cwd="/tmp", timeout=900)
    out = (r.stdout + r.stderr).rstrip()
    print(out)
    if r.returncode != 0:
        fails.append(main.parent.parent.name)
if not mains:
    fails.append("keine Spiele gefunden")
print()
if fails:
    print("❌ Pflicht-Prüfung fehlgeschlagen:", ", ".join(fails))
    sys.exit(1)
print("✅ Alle Tisch-Spiele bestehen die Pflicht-Prüfung")
