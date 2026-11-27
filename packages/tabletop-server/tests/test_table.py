"""Engine 2.6: Bedenkzeit (Schachuhr) und Züge zurücknehmen (mit Zustimmung) – am Raum, ohne Netzwerk.

    python -I packages/tabletop-server/tests/test_table.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tabletop_server.rooms import GameDef, Room  # noqa: E402
from tabletop_server.rules import GameRules  # noqa: E402

fails = []


def ok(cond, msg):
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


class Line(GameRules):
    """Zwei Figuren auf einer Linie, abwechselnd ein Feld vor; wer f9 erreicht, gewinnt."""
    shared_view = True
    uses_clock = True

    def setup(self, room):
        room.game = {"turn": 0, "phase": "move", "moves_made": 0}
        return []

    def actions(self, room, seat):
        g = room.game
        if g.get("turn") != seat or g.get("phase") != "move":
            return []
        pid = f"p{seat}"
        i = int(room.pieces[pid]["field"][1:])
        return [{"type": "move", "piece": pid, "to": f"f{i + 1}"}] if i < 9 else []

    def apply(self, room, seat, action):
        acts = self.actions(room, seat)
        if not any(a["piece"] == action.get("piece") and a["to"] == action.get("to") for a in acts):
            return None
        frm = room.pieces[action["piece"]]["field"]
        room.pieces[action["piece"]]["field"] = action["to"]
        room.game["turn"] = 1 - seat
        room.game["moves_made"] += 1
        return [{"type": "PIECE_MOVED", "piece": action["piece"], "from": frm, "to": action["to"]}]


fields = {f"f{i}": {"x": i * 0.5, "z": 0, "kind": "spot"} for i in range(10)}
fields.update({f"g{i}": {"x": i * 0.5, "z": 1, "kind": "spot"} for i in range(10)})
pieces = {"p0": {"kind": "pawn", "seat": 0, "field": "f0"}, "p1": {"kind": "pawn", "seat": 1, "field": "f1"}}
GAME = GameDef("t", "T", ["#111", "#222"], layout={"fields": fields, "pieces": pieces}, rules=Line())


def room(**settings):
    r = Room("T", GAME)
    r.join("a", "A", False)
    r.join("b", "B", False)
    r.set_settings("a", settings)
    r.start("a")
    return r


def move(r, member, pid, to):
    r.grab(member, pid)
    return r.drop(member, pid, to)


print("== Hausregeln ==")
schema = Room("X", GAME).settings_schema()
ok(schema["clock"]["default"] == 0 and 5 in schema["clock"]["choices"], "„Bedenkzeit“ (Standard: ohne Uhr)")
ok(schema["undo"]["default"] is False, "„Züge zurücknehmen“ (Standard: aus)")
ok(not Room("X", GAME).set_settings("a", {"clock": 4}), "nur angebotene Zeiten")

print("== Schachuhr ==")
r = room(clock=1)
c = r.clock_view()
ok(c and c["left"]["0"] == 60 and c["running"] == [0], "1 Minute je Spieler, Weiß' Uhr läuft")
r.clock["since"] -= 7                                   # 7 Sekunden nachgedacht
move(r, "a", "p0", "f1")
c = r.clock_view()
ok(52.5 < c["left"]["0"] < 53.5 and c["left"]["1"] == 60 and c["running"] == [1], f"Zug drückt die Uhr ({c})")
ok(r.play_state()["clock"]["running"] == [1], "Uhr steht im Spielstand")
saved = json.loads(json.dumps(r.to_saved()))
back = Room.from_saved(saved, GAME)
ok(back.clock and abs(back.clock_view()["left"]["0"] - c["left"]["0"]) < 0.5, "Uhr übersteht Speichern/Laden")
r.clock["since"] -= 61
evs = r.check_clock()
ok(r.status == "finished" and r.game["result"]["winners"] == [0], "Zeit abgelaufen → verloren")
ok(any(e["event"]["type"] == "NOTE" for e in evs), "… mit Hinweis")
ok(room().clock is None, "ohne Hausregel keine Uhr")

print("== Zurücknehmen ==")
r = room(undo=True)
move(r, "a", "p0", "f1")
move(r, "b", "p1", "f2")
ok(r.play_state()["undoable"] == [0, 1], "beide haben etwas zum Zurücknehmen")
ok(r.undo_request("b") and r.undo_ask, "B fragt")
ok(r.play_state()["undo_ask"]["need"] == ["a"], "… A muss zustimmen")
ok(not r.undo_answer("b", True), "B kann sich nicht selbst zustimmen")
evs = r.undo_answer("a", True)
ok(any(e["event"]["type"] == "STATE_RESTORED" for e in evs), "A stimmt zu → zurückgenommen")
ok(r.pieces["p1"]["field"] == "f1" and r.game["turn"] == 1 and r.game["moves_made"] == 1, "Stand vor Bs Zug")
move(r, "b", "p1", "f2")
r.undo_request("a")                                      # A nimmt zurück → auch Bs späterer Zug geht mit
r.undo_answer("b", False)
ok(r.undo_ask is None and r.pieces["p0"]["field"] == "f1", "B lehnt ab → bleibt")
r.undo_request("a")
move(r, "a", "p0", "f2")
ok(r.undo_ask is None, "Wer weiterzieht, beantwortet die Frage (erledigt)")
bot = Room("U", GAME)
bot.join("a", "A", False)
bot.set_settings("a", {"undo": True})
bot.add_bot("a", 1)
bot.start("a")
move(bot, "a", "p0", "f1")
bot.bot_move(1)
evs = bot.undo_request("a")
ok(any(e["event"]["type"] == "STATE_RESTORED" for e in evs) and bot.pieces["p0"]["field"] == "f0"
   and bot.pieces["p1"]["field"] == "f1", "gegen den Computer: sofort, Computerzug geht mit zurück")
ok(room().undo_request("a") == [], "ohne Hausregel kein Zurücknehmen")

print()
if fails:
    print(f"❌ {len(fails)} Fehler")
    sys.exit(1)
print("✅ Uhr und Zurücknehmen bestanden")
