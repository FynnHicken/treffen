"""Engine 2.5: Freies Spiel (Hausregel) – keine Regelprüfung, alle am Tisch dürfen alles, Karten umdrehen, mischen.

    python -I packages/tabletop-server/tests/test_free.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tabletop_server.cards import card_pieces, pieces_on, zone  # noqa: E402
from tabletop_server.rooms import GameDef, Room  # noqa: E402
from tabletop_server.rules import GameRules  # noqa: E402

fails = []


def ok(cond, msg):
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


class Strict(GameRules):
    """Erlaubt nur einen einzigen Zug – im freien Spiel darf trotzdem alles."""
    shared_view = True

    def setup(self, room):
        room.game = {"turn": 0, "phase": "move"}
        for i, pid in enumerate(sorted(p for p in room.pieces if p.startswith("k"))):
            room.pieces[pid]["face"] = f"F{i}"
        return []

    def actions(self, room, seat):
        return [{"type": "move", "piece": "p0", "to": "f1"}] if seat == 0 else []

    def apply(self, room, seat, action):
        return None


fields = {f"f{i}": {"x": i * 0.8, "z": 0, "kind": "spot"} for i in range(6)}
fields["deck"] = zone(0, 2, "stack")
fields["hand-1"] = zone(0, 4, "hand", owner=1)
pieces = {"p0": {"kind": "pawn", "seat": 0, "field": "f0"}, "p1": {"kind": "pawn", "seat": 1, "field": "f5"},
          **card_pieces(3, "deck")}
GAME = GameDef("frei", "Frei", ["#111", "#222"], layout={"fields": fields, "pieces": pieces, "dice": {"count": 1, "sides": 6}},
               rules=Strict())


def room(free):
    r = Room("F", GAME)
    r.ROLL_LOCK_SEC = 0
    r.join("a", "A", False)
    r.join("b", "B", False)
    if free:
        r.set_settings("a", {"free": True})
    r.start("a")
    return r


print("== Hausregel ==")
r = Room("F", GAME)
ok(r.settings_schema()["free"]["default"] is False, "„Freies Spiel“ ist eine Hausregel, Standard aus")
ok("free" not in Room("S", GameDef("s", "S", ["#1", "#2"], layout={"fields": {}, "pieces": {}}, rules=Strict(),
                                   free_play=False)).settings_schema(), "Spiele können sie abschalten")

print("== Mit Regeln (Standard) ==")
r = room(False)
ok(not r.free and not r.grab("b", "p0"), "B darf Weiß nicht anfassen")
ok(r.grab("a", "p0") and not [m for m in r.drop("a", "p0", "f3") if m["event"]["type"] == "PIECE_MOVED"],
   "A darf nur den erlaubten Zug")

print("== Freies Spiel ==")
r = room(True)
st = r.play_state(1)
ok(r.free and st["free"] and st["to_move"] == [], "läuft, niemand ist „am Zug“")
ok(r.grab("b", "p0"), "B darf A's Figur greifen")
ok(any(m["event"]["type"] == "PIECE_MOVED" for m in r.drop("b", "p0", "f3")) and r.pieces["p0"]["field"] == "f3",
   "… und irgendwohin setzen")
r.grab("a", "p1")
ok(not any(m["event"]["type"] == "PIECE_MOVED" for m in r.drop("a", "p1", "f3")), "besetztes Feld (ohne Zone) geht nicht")
ok(r.roll("b", 0.5) and r.roll("a", 0.5), "alle dürfen würfeln, jederzeit")
k = pieces_on(r, "deck")[-1]
r.grab("b", k)
msgs = r.drop("b", k, "hand-1")
mv = next(m for m in msgs if m["event"]["type"] == "PIECE_MOVED")
ok(r.personalize(mv, "b")["event"].get("show") and "show" not in r.personalize(mv, "a")["event"],
   "Karte in die eigene Hand: nur B sieht sie")
msgs = r.act("a", {"type": "flip", "piece": pieces_on(r, "deck")[-1]})
fl = next(m for m in msgs if m["event"]["type"] == "PIECE_FLIPPED")
ok(fl["event"]["up"] is True and fl["event"].get("show"), "Karte umdrehen → alle sehen sie")
ok(st["acts"] == {"1": [{"type": "shuffle", "field": "deck", "label": "🔀 Stapel mischen"}]}, "Knopf „Stapel mischen“")
before = {p: r.pieces[p].get("face") for p in pieces_on(r, "deck")}
msgs = r.act("b", {"type": "shuffle", "field": "deck"})
ok(any(m["event"]["type"] == "STACK_SHUFFLED" for m in msgs), "Stapel gemischt")
ok(sorted(filter(None, before.values())) == sorted(filter(None, (r.pieces[p].get("face") for p in pieces_on(r, "deck")))),
   "… gleiche Karten")
ok(r.auto_member(0) is None, "Computer spielen im freien Spiel nicht")
ok('"face"' not in json.dumps(r.state(0)) and '"face"' not in json.dumps([r.personalize(m, "a") for m in msgs]),
   "Vorderseiten bleiben beim Server")
ok(r.new_round("a") and r.status == "lobby", "Host beendet die Runde")

print()
if fails:
    print(f"❌ {len(fails)} Fehler")
    sys.exit(1)
print("✅ Freies Spiel bestanden")
