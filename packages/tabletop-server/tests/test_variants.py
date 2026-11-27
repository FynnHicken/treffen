"""Engine 2.1: Spielvarianten (Brett/Plätze/Regeln je Variante) am Raum, ohne Netzwerk.

    python -I packages/tabletop-server/tests/test_variants.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tabletop_server.rooms import GameDef, Room, Variant  # noqa: E402
from tabletop_server.rules import GameRules  # noqa: E402

fails = []


def ok(cond, msg):
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


def layout(n):
    fields = {f"f{i}": {"x": i * 0.5, "z": 0, "kind": "spot"} for i in range(n * 2)}
    pieces = {f"p{s}": {"kind": "pawn", "seat": s, "field": f"f{s}"} for s in range(n)}
    return {"board": {"kind": "test", "size": 4}, "fields": fields, "pieces": pieces}


class Shared(GameRules):
    """Alle dürfen jede Figur ziehen (wie Team-Figuren) – prüft, dass bei API 2 allein die Regeln entscheiden."""
    shared_view = True

    def setup(self, room):
        room.game = {"turn": 0, "phase": "move"}
        return []

    def actions(self, room, seat):
        return [{"type": "move", "piece": "p0", "to": "f5"}] if room.game.get("phase") == "move" else []

    def apply(self, room, seat, action):
        if action.get("piece") != "p0" or action.get("to") != "f5":
            return None
        room.pieces["p0"]["field"] = "f5"
        room.game["phase"] = "over"
        room.status = "finished"
        return [{"type": "PIECE_MOVED", "piece": "p0", "from": "f0", "to": "f5"}]


def variant(n, players):
    return Variant(str(n), f"für {n}", [f"#00000{i}" for i in range(n)], layout(n), Shared(), players=players,
                   seat_angles=[i * 360 / n for i in range(n)])


GAME = GameDef("t", "Test", variants=[variant(2, (1, 2)), variant(4, (3, 4)), variant(6, (5, 6))], auto_variant=True)


def events_of(msgs, typ):
    return [m["event"] for m in msgs if m["event"]["type"] == typ]


print("== Varianten ==")
r = Room("V1", GAME)
schema = r.settings_schema()
ok(schema["variant"]["default"] == "auto" and schema["variant"]["choices"] == ["auto", "2", "4", "6"],
   "Hausregel „Spielvariante“ mit automatisch + allen Varianten")
ok(r.variant_id == "2" and r.state()["game"]["seats"] == 2, "Start mit der ersten Variante (2 Plätze)")
r.join("a", "A", True)
r.join("b", "B", False)
msgs = r.join("c", "C", False)
ok(events_of(msgs, "BOARD_CHANGED") and r.variant_id == "4", "Dritter kommt dazu → automatisch das 4er-Brett")
ok(r.members["c"].seat is not None, "… und bekommt sofort einen Platz")
bc = events_of(msgs, "BOARD_CHANGED")[0]
ok(bc["game"]["seats"] == 4 and len(bc["layout"]["pieces"]) == 4 and set(bc["pieces"]) == {"p0", "p1", "p2", "p3"},
   "BOARD_CHANGED bringt Plätze, Layout und Figuren mit")
ok(bc["game"]["seat_angles"] == [0, 90, 180, 270], "… und die Lage der Plätze")
ok(json.dumps(bc) and bc["members"] and all("seat" in m for m in bc["members"]), "… und die Mitglieder (Plätze neu)")
for x in "de":
    r.join(x, x.upper(), False)
ok(r.variant_id == "6", "Fünfter → 6er-Brett")
r.stand_up("e")
ok(r.variant_id == "4", "Einer steht auf → zurück aufs 4er-Brett")
ok(sorted(m.seat for m in r.members.values() if m.seat is not None) == [0, 1, 2, 3], "Plätze rücken zusammen")

print("== Feste Wahl durch den Host ==")
ok(not r.set_settings("b", {"variant": "2"}), "Nur der Host wählt die Variante")
msgs = r.set_settings("a", {"variant": "2"})
ok(r.variant_id == "2" and events_of(msgs, "BOARD_CHANGED"), "Host wählt 2er-Brett")
seated = [m.id for m in r.members.values() if m.seat is not None]
ok(len(seated) == 2 and "a" in seated, "Zu viele → die übrigen schauen zu (Host behält den Platz)")
r.join("f", "F", False)
ok(r.variant_id == "2" and r.members["f"].seat is None, "Feste Wahl: Neue wechseln das Brett nicht (schauen zu)")
ok(r.set_settings("a", {"variant": "zehn"}) == [], "Unbekannte Variante wird abgelehnt")
r.set_settings("a", {"variant": "6"})
r.add_bot("a", 5)
ok(r.members.get("bot_5") is not None, "Computer auf Platz 6 im 6er-Brett")
r.set_settings("a", {"variant": "4"})
ok("bot_5" not in r.members or r.members["bot_5"].seat is not None, "Computer ohne Platz verschwindet")

print("== Speichern/Laden ==")
r.start("a")
ok(r.status == "playing" and r.variant_id == "4", "Start mit der gewählten Variante")
saved = json.loads(json.dumps(r.to_saved()))
back = Room.from_saved(saved, GAME)
ok(back.variant_id == "4" and back.seats == 4 and set(back.pieces) == set(r.pieces), "Variante übersteht Speichern/Laden")
ok(not back.fit_variant(), "Im Spiel wechselt das Brett nie")

print("== Figuren nach Regeln (API 2) ==")
seat_b = r.members["b"].seat
ok(seat_b is not None and seat_b != 0, "B sitzt nicht auf Platz 0")
ok(r.grab("b", "p0") and r.drop("b", "p0", "f5"), "Fremde Figur greifen + ziehen, wenn die Regeln es erlauben")
ok(r.pieces["p0"]["field"] == "f5" and r.status == "finished", "Zug ausgeführt")

print("== Einfaches Spiel ohne Varianten ==")
simple = GameDef("s", "S", ["#111", "#222"], layout=layout(2), rules=Shared())
rs = Room("S", simple)
ok("variant" not in rs.settings_schema() and rs.variant_id == "standard" and rs.seats == 2,
   "Keine Hausregel „Variante“, alles wie bisher")
ok(rs.state()["game"]["seat_angles"] is None, "Plätze gleichmäßig verteilt (keine Winkel)")

print()
if fails:
    print(f"❌ {len(fails)} Fehler")
    sys.exit(1)
print("✅ Alle Varianten-Tests bestanden")
