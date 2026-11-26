"""Mensch-Regeln auf dem Spieltisch (games/mensch/server/rules.py) – gezielte Fälle + 100 Computer-Partien.

    python -I games/mensch/tests/test_rules.py
"""
import random, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "tabletop-server"))
sys.path.insert(0, str(ROOT / "games" / "mensch" / "server"))
from tabletop_server.rooms import GameDef, Room  # noqa: E402
from layout import LAYOUT, COLORS, PALETTE  # noqa: E402
from rules import MenschRules  # noqa: E402

FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


def new_room(players=("a", "b"), bots=(), seed=1):
    gd = GameDef("mensch", "Mensch", [PALETTE[c] for c in COLORS], layout=LAYOUT, rules=MenschRules())
    r = Room("R", gd)
    r._rng = random.Random(seed)
    for p in players:
        r.join(p, p.upper(), False)
    for seat in bots:
        r.add_bot(players[0], seat)
    return r


def put(room, **fields):
    """Figuren hinstellen: put(room, **{'p-yellow-0': 't5'})"""
    for pid, f in fields.items():
        room.pieces[pid]["field"] = f


def roll_value(room, member, value, t):
    room._rng = type("R", (), {"randint": lambda self, a, b: value, "getrandbits": lambda self, n: 1})()
    return room.roll(member, 0.5, now=t)


def types(evs):
    return [e["event"]["type"] for e in evs]


def main():
    print("== Lobby & Start ==")
    r = new_room(players=("a", "b"))
    ok(r.status == "lobby" and r.member_at(0).id == "a" and r.member_at(1).id == "b", "Lobby: a auf Gelb, b auf Grün")
    ok(r.start("b") == [] and r.status == "lobby", "Nur der Host startet")
    r.add_bot("a", 2)
    ok(r.member_at(2) and r.member_at(2).is_bot, "Host setzt Computer auf Rot")
    ok(r.add_bot("b", 3) == [], "Gast kann keinen Computer setzen")
    evs = r.start("a")
    ok(r.status == "playing" and r.game["turn"] == 0 and r.game["rolls_left"] == 3, "Start: Gelb beginnt, 3 Versuche (keine Figur draußen)")
    ok(types(evs)[-1] == "GAME_UPDATED", "GAME_UPDATED nach dem Start")
    ok(r.sit("b", 3) == [] and r.add_bot("a", 3) == [], "Im Spiel keine Platzwechsel/Computer mehr")
    ok(r.roll("b", 0.5, now=0) == [], "Grün darf nicht würfeln, wenn Gelb dran ist")

    print("== Drei Versuche, 6 = raus ==")
    t = 0
    roll_value(r, "a", 3, t); t += 2
    ok(r.game["turn"] == 0 and r.game["rolls_left"] == 2, "Keine 6: noch 2 Versuche")
    roll_value(r, "a", 2, t); t += 2
    roll_value(r, "a", 5, t); t += 2
    ok(r.game["turn"] == 1, "Nach 3 Fehlversuchen ist Grün dran")
    roll_value(r, "b", 6, t); t += 2
    mv = r.rules.moves(r, 1)
    ok(r.game["phase"] == "move" and {m["to"] for m in mv} == {"t10"} and len(mv) == 4, "6: jede Figur aus dem Häuschen darf auf Start (t10)")
    ok(r.grab("a", "p-yellow-0") == [], "Gelb kann im Zug von Grün nichts greifen")
    r.grab("b", "p-green-2")
    evs = r.drop("b", "p-green-2", "t11")
    ok(r.pieces["p-green-2"]["field"] == "h-green-2" and types(evs) == ["PIECE_RELEASED"], "Falsches Ziel → zurück")
    r.grab("b", "p-green-2")
    evs = r.drop("b", "p-green-2", "t10")
    ok(r.pieces["p-green-2"]["field"] == "t10" and r.game["phase"] == "roll" and r.game["turn"] == 1, "Raus aufs Startfeld, nach der 6 nochmal würfeln")
    roll_value(r, "b", 4, t); t += 2
    ok([m["to"] for m in r.rules.moves(r, 1)] == ["t14"], "Startfeld räumen: nur die Figur auf dem Start darf ziehen")
    r.grab("b", "p-green-2"); evs = r.drop("b", "p-green-2", "t14")
    moved = [e["event"] for e in evs if e["event"]["type"] == "PIECE_MOVED"][0]
    ok(moved["path"] == ["t11", "t12", "t13", "t14"], f"Pfad Feld für Feld: {moved['path']}")
    ok(r.game["turn"] == 2, "Nach normalem Zug ist Rot dran")

    print("== Schlagen, eigene Figur, Ziel ==")
    r = new_room(players=("a", "b"))
    r.start("a")
    put(r, **{"p-yellow-0": "t5", "p-yellow-1": "t8", "p-green-0": "t9"})
    r.game.update(turn=0, phase="roll", rolls_left=1)
    roll_value(r, "a", 3, 0)
    tos = {m["piece"]: m["to"] for m in r.rules.moves(r, 0)}
    ok("p-yellow-0" not in tos, "Kann nicht auf eigene Figur ziehen (t5+3 = t8)")
    ok(tos.get("p-yellow-1") == "t11", "Andere Figur darf")
    r.game["dice"] = 1
    m = next(m for m in r.rules.moves(r, 0) if m["piece"] == "p-yellow-1")
    ok(m["capture"] == "p-green-0", "t8+1 schlägt Grün auf t9")
    r.grab("a", "p-yellow-1"); evs = r.drop("a", "p-yellow-1", "t9")
    ok(r.pieces["p-green-0"]["field"].startswith("h-green-"), "Geschlagene Figur zurück ins Häuschen")
    ok([e["event"].get("reason") for e in evs if e["event"]["type"] == "PIECE_MOVED"] == [None, "captured"], "Erst der Zug, dann die geschlagene Figur")

    r = new_room(players=("a", "b"))
    r.start("a")
    put(r, **{"p-yellow-0": "t38", "p-yellow-1": "g-yellow-1"})
    r.game.update(turn=0, phase="roll", rolls_left=1)
    roll_value(r, "a", 3, 0)        # 38→39→g0→g1: g1 besetzt → blockiert (nichts überspringen)
    ok(not any(m["piece"] == "p-yellow-0" for m in r.rules.moves(r, 0)), "Im Ziel wird nicht übersprungen")
    ok(r.game["turn"] == 1, "Kein möglicher Zug mit der 3 → Grün ist dran")
    r.game.update(turn=0, phase="move", dice=2)
    m = next((m for m in r.rules.moves(r, 0) if m["piece"] == "p-yellow-0"), None)
    ok(m and m["to"] == "g-yellow-0" and m["path"] == ["t39", "g-yellow-0"], f"Exakt ins Ziel: {m and m['path']}")
    r.game["dice"] = 6
    ok(not any(m["piece"] == "p-yellow-0" and m["to"].startswith("g") for m in r.rules.moves(r, 0)), "Zu weit fürs Ziel → kein Zug")
    r.game["dice"] = 2
    m = next((m for m in r.rules.moves(r, 0) if m["piece"] == "p-yellow-1"), None)
    ok(m and m["to"] == "g-yellow-3", "Im Ziel weiterrücken (g1→g3)")

    print("== Hausregeln ==")
    r = new_room(players=("a", "b"))
    ok(r.set_settings("b", {"must_capture": True}) == [], "Nur der Host stellt Hausregeln ein")
    r.set_settings("a", {"must_capture": True})
    r.start("a")
    put(r, **{"p-yellow-0": "t5", "p-yellow-1": "t20", "p-green-0": "t8"})
    r.game.update(turn=0, phase="move", dice=3)
    ms = r.rules.moves(r, 0)
    ok([m["piece"] for m in ms] == ["p-yellow-0"] and ms[0]["capture"] == "p-green-0", f"Schlagzwang: nur der schlagende Zug ({[m['piece'] for m in ms]})")
    r.game["dice"] = 2
    ok(len(r.rules.moves(r, 0)) == 2, "Ohne Schlagmöglichkeit freie Wahl")
    r = new_room(players=("a", "b"))
    r.set_settings("a", {"clear_start": False})
    r.start("a")
    put(r, **{"p-yellow-0": "t0", "p-yellow-1": "t20"})
    r.game.update(turn=0, phase="move", dice=2)
    ok({m["piece"] for m in r.rules.moves(r, 0)} == {"p-yellow-0", "p-yellow-1"}, "Ohne „Startfeld räumen“ darf auch die andere Figur ziehen")

    print("== Ende ==")
    r = new_room(players=("a", "b"))
    r.start("a")
    put(r, **{"p-yellow-0": "g-yellow-3", "p-yellow-1": "g-yellow-2", "p-yellow-2": "g-yellow-1", "p-yellow-3": "t39"})
    r.game.update(turn=0, phase="roll", rolls_left=1)
    roll_value(r, "a", 1, 0)
    r.grab("a", "p-yellow-3"); r.drop("a", "p-yellow-3", "g-yellow-0")
    ok(r.status == "finished" and r.game["finished"] == [0, 1] and r.game["phase"] == "over", f"Gelb gewinnt, Spiel vorbei (Rangfolge {r.game['finished']})")
    ok(r.roll("a", 0.5, now=10) == [], "Nach dem Ende kein Würfeln")
    r.new_round("a")
    ok(r.status == "lobby", "Neue Runde → Lobby")
    r.start("a")
    ok(all(p["field"].startswith("h-") for p in r.pieces.values()), "Neue Runde: alle Figuren im Häuschen")

    print("== 100 Computer-Partien ==")
    longest, wins = 0, [0, 0, 0, 0]
    for seed in range(100):
        n = 2 + seed % 3
        r = new_room(players=("host",), seed=seed)
        r.stand_up("host")
        for s in range(n):
            r.add_bot("host", s)
        r.start("host")
        t, actions, seqs = 0.0, 0, []
        while r.status == "playing" and actions < 5000:
            seat = r.game["turn"]
            bot = r.member_at(seat)
            if r.rules.wants_roll(r, seat):
                evs = r.roll(bot.id, 0.5, now=t, auto=True)
                t += 2
            else:
                evs = r.bot_move(seat)
            seqs += [e["seq"] for e in evs]
            actions += 1
        longest = max(longest, actions)
        winner = r.game["finished"][0] if r.game and r.game["finished"] else None
        if winner is not None:
            wins[winner] += 1
        if r.status != "finished" or seqs != list(range(seqs[0], seqs[0] + len(seqs))):
            ok(False, f"Partie {seed} hängt oder Ereignisnummern lückenhaft ({actions} Aktionen)")
            break
        fin = r.game["finished"]
        if any(not all(r.pieces[f"p-{COLORS[s]}-{k}"]["field"].startswith("g-") for k in range(4)) for s in fin[:-1]):
            ok(False, f"Partie {seed}: Fertige haben nicht alle Figuren im Ziel")
            break
    else:
        ok(True, f"100 Partien enden sauber (längste: {longest} Aktionen, Siege je Platz {wins})")

    print()
    print("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Alle Regel-Tests bestanden")
    sys.exit(1 if FAILS else 0)


main()
