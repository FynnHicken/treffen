"""Dame-Regeln + Pflicht-Prüfung der Engine.

    python -I games/dame/tests/test_rules.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "tabletop-server"))
sys.path.insert(0, str(ROOT / "games" / "dame" / "server"))
from tabletop_server.conformance import check_game  # noqa: E402
from tabletop_server.rooms import Room  # noqa: E402
from main import GAME  # noqa: E402

fails = []


def ok(cond, msg):
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


def fresh():
    r = Room("D", GAME)
    r.join("w", "W", False)
    r.join("b", "B", False)
    r.start("w")
    return r


def place(r, where):
    """Nur diese Steine aufs Brett, alle anderen in die Ablage."""
    n = 0
    for pid in r.pieces:
        r.pieces[pid] = {"field": f"tray-{r.layout['pieces'][pid]['seat']}-{n % 12}", "held_by": None}
        n += 1
    for pid, (field, kind) in where.items():
        r.pieces[pid] = {"field": field, "held_by": None, **({"kind": kind} if kind else {})}


print("== Aufstellung ==")
r = fresh()
ok(len(r.pieces) == 24 and r.status == "playing", "24 Steine, Partie läuft")
ok(all(r.layout["fields"][p["field"]]["color"] == "dark" for p in r.pieces.values()), "alle auf dunklen Feldern")
moves = r.rules.actions(r, 0)
ok(len(moves) == 7 and all(m["captures"] == [] for m in moves), f"Weiß hat 7 Eröffnungszüge ({len(moves)})")
st = r.play_state()
ok(st["scores"] == [0, 0] and st["marks"] == [], "Standard-Anzeige: Punkte, keine Markierung")

print("== Schlagen ==")
r = fresh()
place(r, {"w0": ("c3", None), "b0": ("d4", None), "b1": ("h8", None)})
acts = r.rules.actions(r, 0)
ok([a["to"] for a in acts] == ["e5"], f"Schlagzwang: nur der Sprung ({[a['to'] for a in acts]})")
ok(r.play_state()["say"]["me"] == "Du musst schlagen!", "Statuszeile sagt es")
ok(r.grab("w", "w0") and r.drop("w", "w0", "e5"), "Sprung am Tisch")
ok(r.pieces["b0"]["field"].startswith("tray-0-"), "geschlagener Stein liegt in Weiß' Ablage")
ok(r.play_state()["scores"] == [1, 0] and len(r.play_state()["marks"]) == 2, "Punkte + letzter Zug markiert")

print("== Mehrfachsprung + Dame ==")
r = fresh()
place(r, {"w0": ("a3", None), "b0": ("b4", None), "b1": ("d6", None), "b2": ("h2", None)})
acts = r.rules.actions(r, 0)
ok(any(a["to"] == "e7" and len(a["captures"]) == 2 for a in acts), "Doppelsprung a3 → c5 → e7")
r.grab("w", "w0")
evs = r.drop("w", "w0", "e7")
ok(r.pieces["b0"]["field"].startswith("tray") and r.pieces["b1"]["field"].startswith("tray"), "beide geschlagen")
place(r, {"w0": ("c7", None), "b2": ("h2", None)})
r.game["turn"] = 0
r.grab("w", "w0")
evs = [m["event"] for m in r.drop("w", "w0", "d8")]
ok(r.pieces["w0"].get("kind") == "king", "Stein auf Reihe 8 wird Dame")
ok(any(e["type"] == "NOTE" for e in evs), "… mit Hinweis an alle")
r.game["turn"] = 0
acts = r.rules.actions(r, 0)
ok(any(a["to"] == "h4" for a in acts), "Dame zieht weit (d8 → h4)")

print("== Ende ==")
r = fresh()
place(r, {"w0": ("c3", None), "b0": ("d4", None)})
r.grab("w", "w0")
r.drop("w", "w0", "e5")
ok(r.status == "finished" and r.game["result"]["winners"] == [0], "Schwarz ohne Steine → Weiß gewinnt")

print("== Pflicht-Prüfung ==")
try:
    check_game(GAME, games=int(sys.argv[1]) if len(sys.argv) > 1 else 10)
except AssertionError as e:
    ok(False, f"Pflicht-Prüfung: {e}")

print()
if fails:
    print(f"❌ {len(fails)} Fehler")
    sys.exit(1)
print("✅ Alle Dame-Tests bestanden")
