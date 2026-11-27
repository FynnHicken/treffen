"""Mau-Mau-Regeln, Karten-Bausteine der Engine (2.4: Stapel, Hände, Geheimhaltung, Knöpfe) + Pflicht-Prüfung.

    python -I games/maumau/tests/test_rules.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "tabletop-server"))
sys.path.insert(0, str(ROOT / "games" / "maumau" / "server"))
from tabletop_server.cards import pieces_on, top  # noqa: E402
from tabletop_server.conformance import check_game  # noqa: E402
from tabletop_server.rooms import Room  # noqa: E402
from main import GAME  # noqa: E402

fails = []


def ok(cond, msg):
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


def fresh(n=2):
    r = Room("M", GAME)
    for i in range(n):
        r.join(f"m{i}", f"M{i}", False)
    r.start("m0")
    return r


def set_hand(r, seat, faces):
    """Hand gezielt füllen: Karten mit diesen Vorderseiten aus dem Stapel nehmen."""
    for pid in pieces_on(r, f"hand-{seat}"):
        r.move_piece(pid, "deck", up=False)
    for f in faces:
        pid = next(p for p, q in r.pieces.items() if q.get("face") == f)
        r.move_piece(pid, f"hand-{seat}")


def set_pile(r, face):
    pid = next(p for p, q in r.pieces.items() if q.get("face") == face)
    r.move_piece(pid, "pile", up=True)


print("== Austeilen ==")
r = fresh()
ok(all(len(pieces_on(r, f"hand-{s}")) == 5 for s in (0, 1)), "je 5 Karten")
ok(len(pieces_on(r, "pile")) == 1 and r.pieces[top(r, "pile")]["up"], "eine offene Karte auf der Ablage")
ok(len(pieces_on(r, "deck")) == 32 - 11, "Rest im Stapel")
faces = [r.pieces[p]["face"] for p in r.pieces]
ok(sorted(faces) == sorted(r.layout["cards"]), "jede Karte genau einmal")

print("== Geheimhaltung ==")
s0 = r.state(0)["pieces"]
own = [p for p in pieces_on(r, "hand-0")]
other = [p for p in pieces_on(r, "hand-1")]
ok(all(s0[p].get("show") for p in own), "eigene Hand sichtbar")
ok(not any(s0[p].get("show") for p in other), "fremde Hand verdeckt")
ok(not any(s0[p].get("show") for p in pieces_on(r, "deck")), "Stapel verdeckt")
ok(s0[top(r, "pile")].get("show"), "Ablage offen")
ok('"face"' not in json.dumps(r.state(0)) and '"face"' not in json.dumps(r.state(None)), "keine Vorderseite im Zustand")
ok(all(p not in json.dumps(r.state(None)["pieces"]) or not r.state(None)["pieces"][p].get("show") for p in own),
   "Zuschauer sieht keine Hand")

print("== Legen und Ziehen ==")
r = fresh()
set_pile(r, "♥9")
set_hand(r, 0, ["♥7", "♠9", "♣K", "♦B", "♠A"])
r.game["turn"] = 0
acts = r.rules.actions(r, 0)
playable = sorted(r.pieces[a["piece"]]["face"] for a in acts if a["type"] == "move" and a["to"] == "pile")
ok(playable == ["♠9", "♥7", "♦B"], f"passend: Farbe, Wert, Bube ({playable})")
ok(any(a.get("draw") for a in acts), "Stapel antippen = ziehen")
seven = next(p for p in pieces_on(r, "hand-0") if r.pieces[p]["face"] == "♥7")
r.grab("m0", seven)
msgs = r.drop("m0", seven, "pile")
ok(r.pieces[seven]["field"] == "pile" and r.game["draw"] == 2 and r.game["turn"] == 1, "7 gelegt → Nächster zieht 2")
ev = next(m["event"] for m in msgs if m["event"]["type"] == "PIECE_MOVED")
ok(ev.get("show") == "♥7" and ev.get("up") is True, "gelegte Karte offen für alle")
set_hand(r, 1, ["♣8", "♣9"])
before = len(pieces_on(r, "hand-1"))
draw = next(a for a in r.rules.actions(r, 1) if a.get("draw"))
r.grab("m1", draw["piece"])
msgs = r.drop("m1", draw["piece"], "hand-1")
ok(len(pieces_on(r, "hand-1")) == before + 2 and r.game["turn"] == 0, "zwei gezogen, dann ist der Nächste dran")
moved = [m for m in msgs if m["event"]["type"] == "PIECE_MOVED"]
ok(all("secret" in m["event"] and "show" not in m["event"] for m in moved), "gezogene Karten nur für den Zieher")
p1 = r.personalize(moved[0], "m1")["event"]
p0 = r.personalize(moved[0], "m0")["event"]
ok(p1.get("show") and "show" not in p0 and "secret" not in p0, "… der andere sieht sie nicht")

print("== Bube und Wunsch (Knöpfe) ==")
r = fresh()
set_pile(r, "♥9")
set_hand(r, 0, ["♦B", "♠A"])
r.game["turn"] = 0
jack = next(p for p in pieces_on(r, "hand-0") if r.pieces[p]["face"] == "♦B")
r.grab("m0", jack)
r.drop("m0", jack, "pile")
st = r.play_state(0)
ok(r.game["phase"] == "wish" and len(st["acts"]["0"]) == 4, "Bube → vier Knöpfe zum Wünschen")
ok("acts" not in r.play_state(1) or not r.play_state(1)["acts"], "… nur für den, der wünscht")
ok(r.act("m1", {"type": "choose", "suit": "♠"}) == [], "andere dürfen nicht wünschen")
msgs = r.act("m0", {"type": "choose", "suit": "♠", "label": "egal"})
ok(r.game["wish"] == "♠" and r.game["turn"] == 1, "Pik gewünscht, Nächster")
ok(any(m["event"]["type"] == "NOTE" for m in msgs), "Hinweis an alle")
ok(r.act("m1", {"type": "choose", "suit": {"x": 1}}) == [], "kaputte Aktion abgelehnt")

print("== Ende ==")
r = fresh()
set_pile(r, "♥9")
set_hand(r, 0, ["♥K"])
r.game["turn"] = 0
k = pieces_on(r, "hand-0")[0]
r.grab("m0", k)
r.drop("m0", k, "pile")
ok(r.status == "finished" and r.game["result"]["winners"] == [0], "letzte Karte gelegt → gewonnen")

print("== Speichern/Laden ==")
r = fresh()
back = Room.from_saved(json.loads(json.dumps(r.to_saved())), GAME)
ok(all(back.pieces[p].get("face") == r.pieces[p].get("face") for p in r.pieces), "Vorderseiten überstehen Speichern/Laden")

print("== Pflicht-Prüfung ==")
try:
    check_game(GAME, games=int(sys.argv[1]) if len(sys.argv) > 1 else 10)
except AssertionError as e:
    ok(False, f"Pflicht-Prüfung: {e}")

print()
if fails:
    print(f"❌ {len(fails)} Fehler")
    sys.exit(1)
print("✅ Alle Mau-Mau-Tests bestanden")
