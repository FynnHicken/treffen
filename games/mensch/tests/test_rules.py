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

    big_boards()

    print()
    print("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Alle Regel-Tests bestanden")
    sys.exit(1 if FAILS else 0)


def big_boards():
    """Bretter für 6 und 8 (Spielvarianten): Geometrie, Laufbahn-Übergänge, Schlagen, ganze Partien."""
    import math
    from layout import LAYOUTS, colors_for
    from tabletop_server.rooms import Variant
    print("== Klassisches Brett unverändert (Formel = früheres 11×11-Raster) ==")
    track = [(4, 0), (4, 1), (4, 2), (4, 3), (4, 4), (3, 4), (2, 4), (1, 4), (0, 4), (0, 5),
             (0, 6), (1, 6), (2, 6), (3, 6), (4, 6), (4, 7), (4, 8), (4, 9), (4, 10), (5, 10),
             (6, 10), (6, 9), (6, 8), (6, 7), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6), (10, 5),
             (10, 4), (9, 4), (8, 4), (7, 4), (6, 4), (6, 3), (6, 2), (6, 1), (6, 0), (5, 0)]
    goal = {"yellow": [(5, 1), (5, 2), (5, 3), (5, 4)], "green": [(1, 5), (2, 5), (3, 5), (4, 5)],
            "red": [(5, 9), (5, 8), (5, 7), (5, 6)], "black": [(9, 5), (8, 5), (7, 5), (6, 5)]}
    home = {"yellow": [(0, 0), (0, 1), (1, 0), (1, 1)], "green": [(0, 9), (0, 10), (1, 9), (1, 10)],
            "red": [(9, 9), (9, 10), (10, 9), (10, 10)], "black": [(9, 0), (9, 1), (10, 0), (10, 1)]}
    grid = lambda rc: (round((rc[0] - 5) * 0.8, 4), round(-(rc[1] - 5) * 0.8, 4))  # noqa: E731
    want = {f"t{i}": grid(rc) for i, rc in enumerate(track)}
    for c in goal:
        want.update({f"g-{c}-{k}": grid(rc) for k, rc in enumerate(goal[c])})
        want.update({f"h-{c}-{k}": grid(rc) for k, rc in enumerate(home[c])})
    have = {k: (f["x"], f["z"]) for k, f in LAYOUTS[4]["fields"].items()}
    ok(have == want, "Alle 72 Felder des 4er-Bretts liegen exakt wie vorher (Spielstände bleiben gültig)")

    print("== Bretter für 6 und 8 ==")
    for n in (6, 8):
        lay = LAYOUTS[n]
        pts = [(f["x"], f["z"]) for f in lay["fields"].values()]
        gap = min(math.dist(a, b) for i, a in enumerate(pts) for b in pts[i + 1:])
        ok(len(lay["fields"]) == 18 * n and abs(gap - lay["board"]["spacing"]) < 1e-3,
           f"{n}er: {18 * n} Felder, keine zwei näher als ein Feldabstand ({gap:.3f})")
        far = max(math.hypot(*p) for p in pts)
        ok(far + lay["board"]["spacing"] * 0.4 < lay["board"]["size"] / 2, f"{n}er: alle Felder auf dem runden Brett")
        track = [lay["fields"][f"t{i}"] for i in range(10 * n)]
        steps = [math.dist((a["x"], a["z"]), (b["x"], b["z"])) for a, b in zip(track, track[1:] + track[:1])]
        ok(max(steps) < lay["board"]["spacing"] * 1.35, f"{n}er: Laufbahn ohne Sprünge (längster Schritt {max(steps):.2f})")
        colors = colors_for(n)
        gd = GameDef("mensch", "Mensch", variants=[
            Variant(str(n), str(n), [PALETTE[c] for c in colors], layout=lay, rules=MenschRules(colors))])
        r = Room("B", gd)
        r._rng = random.Random(3)
        r.join("a", "A", False)
        r.stand_up("a")
        for seat in range(n):
            r.add_bot("a", seat)
        r.start("a")
        last = colors[-1]
        # Letzte Farbe fährt über das Ende der Laufbahn (t{10n-1} → t0) und ins Ziel
        r.game.update(turn=n - 1, phase="move", dice=4, rolls_left=0)
        put(r, **{f"p-{last}-0": f"t{10 * n - 2}"})
        ms = r.rules.moves(r, n - 1)
        ok(any(m["to"] == f"t{10 * (n - 1) + 2}" for m in ms) is False and
           any(m["piece"] == f"p-{last}-0" and m["to"] == "t2" for m in ms), f"{n}er: Laufbahn läuft rundherum (… → t0 → t2)")
        put(r, **{f"p-{last}-0": f"t{10 * (n - 1) - 2}"})
        r.game.update(dice=3)
        ms = r.rules.moves(r, n - 1)
        ok(any(m["to"] == f"g-{last}-1" for m in ms), f"{n}er: {last} fährt vor seinem Start ins Ziel")
        # Schlagen
        put(r, **{"p-yellow-0": f"t{10 * (n - 1) + 1}", f"p-{last}-0": f"t{10 * (n - 1)}"})
        r.game.update(dice=1)
        evs = r.rules.move(r, n - 1, f"p-{last}-0", f"t{10 * (n - 1) + 1}")
        ok(evs and r.pieces["p-yellow-0"]["field"].startswith("h-yellow-"), f"{n}er: Schlagen schickt ins Häuschen")
        # ganze Partien
        ends = 0
        for seed in range(3):
            r = Room(f"B{seed}", gd)
            r._rng = random.Random(seed)
            r.ROLL_LOCK_SEC = 0
            r.join("a", "A", False)
            r.stand_up("a")
            for seat in range(n):
                r.add_bot("a", seat)
            r.start("a")
            t = 0
            for _ in range(40000):
                if r.status != "playing":
                    break
                seat = r.game["turn"]
                if r.rules.wants_roll(r, seat):
                    r.roll(f"bot_{seat}", now=t, auto=True)
                    t += 2
                else:
                    r.bot_move(seat)
            ends += r.status == "finished" and len(r.game["finished"]) == n
        ok(ends == 3, f"{n}er: 3 Computer-Partien zu {n} enden sauber, Rangliste vollständig")


main()
