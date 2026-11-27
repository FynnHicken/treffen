"""Schach-Regeln am Spieltisch: Zuggenerator (Perft), Tisch-Abbildung, Sonderzüge, Partie-Ende, Computer.

    python -I games/schach/tests/test_rules.py
"""
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "packages" / "tabletop-server"))
sys.path.insert(0, str(HERE.parents[1] / "server"))

from chess import START_FEN, Position, perft  # noqa: E402
from tabletop_server import GameDef, Room  # noqa: E402
from tabletop_server.conformance import check_game  # noqa: E402
from layout import LAYOUT, SEAT_COLORS  # noqa: E402
from rules import SchachRules  # noqa: E402
import stockfish_uci  # noqa: E402

FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


GAME = GameDef("schach", "Schach", SEAT_COLORS, 2, LAYOUT, SchachRules(), version="test")


def new_room(settings=None):
    r = Room("T", GAME)
    r.join("w", "Weiß", False)
    r.join("b", "Schwarz", False)
    if settings:
        r.set_settings("w", settings)
    r.start("w")
    return r


def at(r, field):
    return next((pid for pid, p in r.pieces.items() if p["field"] == field), None)


def play(r, *moves):
    """Züge wie am Tisch: Figur auf dem Startfeld greifen und aufs Zielfeld setzen ("e2e4")."""
    out = []
    for mv in moves:
        frm, to = mv[:2], mv[2:4]
        pid = at(r, frm)
        mid = "w" if r.game["turn"] == 0 else "b"
        r.grab(mid, pid)
        evs = r.drop(mid, pid, to)
        ok_move = any(e["event"]["type"] == "PIECE_MOVED" and e["event"]["piece"] == pid for e in evs)
        if not ok_move:
            return None
        out += [e["event"] for e in evs]
    return out


def main():
    print("== Zuggenerator (Perft) ==")
    cases = [
        (START_FEN, [20, 400, 8902]),
        ("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039]),
        ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812]),
        ("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]),
        ("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486]),
    ]
    for fen, exp in cases:
        p = Position.from_fen(fen)
        got = [perft(p, d + 1) for d in range(len(exp))]
        ok(got == exp, f"Perft {fen.split()[0][:18]}…: {got}")

    print("== Aufstellung & Zugrecht ==")
    r = new_room()
    ok(r.status == "playing" and r.game["turn"] == 0, "Weiß beginnt")
    ok(len(r.play_state()["moves"]) == 20, "20 erlaubte Züge am Anfang (im Spielstand für den Tisch)")
    ok(not r.grab("b", at(r, "e7")), "Schwarz darf vor Weiß nichts greifen")
    ok(not r.grab("w", at(r, "e7")), "Weiß darf keine schwarze Figur greifen")
    r.grab("w", at(r, "e2"))
    ok(r.drop("w", at(r, "e2"), "e5")[-1]["event"]["type"] == "PIECE_RELEASED", "e2–e5 abgelehnt (gleitet zurück)")
    ok(play(r, "e2e4") is not None and r.game["turn"] == 1 and r.game["ep"] == "e3", "e2–e4, Schwarz am Zug, en passant e3")
    ok(r.game["last"] == {"from": "e2", "to": "e4"}, "letzter Zug gemerkt (Hervorhebung am Brett)")

    print("== Schlagen → Ablage neben dem Brett ==")
    r = new_room()
    evs = play(r, "e2e4", "d7d5", "e4d5")
    victim = next(e for e in evs if e.get("reason") == "captured")
    ok(victim["piece"] == "b-P-d7" and victim["to"] == "x-b-0", "geschlagener Bauer liegt in der Ablage von Weiß (x-b-0)")
    ok(r.pieces["b-P-d7"]["field"] == "x-b-0", "Zustand: Figur in der Ablage")
    play(r, "d8d5")
    ok(r.pieces["w-P-e2"]["field"] == "x-w-0", "Schwarz schlägt zurück → Ablage von Schwarz (x-w-0)")

    print("== Rochade, en passant, Umwandlung ==")
    r = new_room()
    play(r, "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6")
    evs = play(r, "e1g1")
    ok(evs is not None and r.pieces["w-R-h1"]["field"] == "f1" and r.pieces["w-K-e1"]["field"] == "g1",
       "kurze Rochade: König zwei Felder, Turm springt nach f1")
    ok(any(e.get("reason") == "castle" for e in evs), "Turmzug als eigenes Ereignis (Animation)")
    ok("K" not in r.game["castling"] and "Q" not in r.game["castling"], "Rochaderechte von Weiß verfallen")

    r = new_room()
    play(r, "e2e4", "a7a6", "e4e5", "d7d5")
    evs = play(r, "e5d6")
    ok(evs is not None and r.pieces["b-P-d7"]["field"].startswith("x-b-"), "en passant: d5-Bauer geschlagen")

    r = new_room()
    ok(play(r, "h2h4", "g7g5", "h4g5", "g8f6", "a2a3", "f8g7", "a3a4", "e8g8") is not None, "Zugfolge bis zur schwarzen Rochade erlaubt")
    ok(r.game["turn"] == 0 and r.pieces["b-R-h8"]["field"] == "f8", "kurze Rochade von Schwarz")
    r2 = new_room()
    play(r2, "a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "b8c6")
    evs = play(r2, "b7a8")
    ok(evs is not None and r2.pieces["w-P-a2"].get("kind") == "queen", "Bauer auf a8 wird ohne Nachfrage zur Dame")
    ok(any(e["type"] == "PIECE_CHANGED" and e["kind"] == "queen" for e in evs), "PIECE_CHANGED gemeldet")
    ok(r2.state()["pieces"]["w-P-a2"]["kind"] == "queen", "Art steht im Zustand (SNAPSHOT)")
    restored = Room.from_saved(json.loads(json.dumps(r2.to_saved())), GAME)
    ok(restored.pieces["w-P-a2"].get("kind") == "queen", "Umwandlung übersteht Speichern/Laden")
    ok(any(m["piece"] == "w-P-a2" for m in [a for a in restored.play_state()["moves"]]) or restored.game["turn"] == 1,
       "Stellung nach dem Laden spielbar")

    print("== Partie-Ende ==")
    r = new_room()
    play(r, "f2f3", "e7e5", "g2g4", "d8h4")
    ok(r.status == "finished" and r.game["result"]["reason"] == "checkmate" and r.game["result"]["winners"] == [1],
       "Narrenmatt: Schwarz gewinnt durch Schachmatt")
    ok(r.game["finished"] == [1, 0], "Rangfolge für den Hub: Sieger zuerst")
    ok(not r.grab("w", at(r, "e2")), "nach dem Ende nichts mehr greifbar")
    r.new_round("w")
    r.start("w")
    ok(r.status == "playing" and r.pieces["b-Q-d8"]["field"] == "d8", "neue Runde: alles zurück auf Anfang")

    r = new_room()
    seq = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]
    play(r, *seq)
    ok(r.status == "finished" and r.game["result"]["reason"] == "repetition", "dreifache Wiederholung = Remis")
    ok(r.game["result"]["winners"] == [], "Remis: keine Sieger")

    print("== Computer ==")
    os.environ["SCHACH_STOCKFISH"] = "off"             # hier: eingebauter Python-Computer
    r = new_room({"bot_level": 3})
    t = time.time()
    a = r.bot_plan(0)
    ok(a is not None and a["type"] == "move", f"Python-Computer Stufe 3 findet einen Zug ({time.time() - t:.2f} s)")
    # Matt in 1 wird gefunden: Weiß Dh5xf7# nach 1.e4 e5 2.Lc4 Sc6 3.Dh5 Sf6??
    r = new_room({"bot_level": 2})
    play(r, "e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6")
    a = r.bot_plan(0)
    ok(a == {"type": "move", "piece": "w-Q-d1", "to": "f7"}, f"Python-Computer sieht das Schäfermatt ({a})")
    del os.environ["SCHACH_STOCKFISH"]

    print("== Stockfish ==")
    path = stockfish_uci.find_binary()
    if not path:
        ok(not os.environ.get("SCHACH_REQUIRE_STOCKFISH"), "Stockfish nicht gefunden (STOCKFISH_PATH) – übersprungen")
    else:
        sf = stockfish_uci.engine()
        r = new_room({"bot_level": 5})
        play(r, "e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6")
        t = time.time()
        a = r.bot_plan(0)
        ok(a == {"type": "move", "piece": "w-Q-d1", "to": "f7"}, f"Stockfish (Stufe 5) setzt matt: {a} ({time.time() - t:.2f} s)")
        ok(sf.proc is not None, "ein Stockfish-Prozess läuft (startet beim ersten Zug)")
        for level in range(1, 6):
            r = new_room({"bot_level": level})
            play(r, "e2e4")
            t = time.time()
            a = r.bot_plan(1)
            legal = any(m["piece"] == a["piece"] and m["to"] == a["to"] for m in r.play_state()["moves"]) if a else False
            ok(legal and time.time() - t < 3, f"Stufe {level}: erlaubter Zug {a['to'] if a else None} in {time.time() - t:.2f} s")
        sf.proc.kill()                                   # Absturz nachstellen
        sf.proc.wait()
        r = new_room({"bot_level": 2})
        ok(r.bot_plan(0) is not None and sf.proc is not None and sf.proc.poll() is None, "nach Absturz neu gestartet")
        r = new_room({"bot_level": 4})
        play(r, "a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "b8c6")
        a = r.bot_plan(0)
        ok(a is not None and r.apply_action("w", 0, a) != [], f"Umwandlungs-Stellung: Stockfish-Zug wird am Tisch angenommen ({a})")
    broken = stockfish_uci.Stockfish("/gibt/es/nicht")
    ok(not broken.available and broken.best_move("8/8/8/8/8/8/8/K6k w - - 0 1", 50) is None, "ohne Stockfish: kein Absturz")
    os.environ["SCHACH_STOCKFISH"] = "off"
    r = new_room({"bot_level": 5})
    ok(r.bot_plan(0) is not None, "Ersatz: eingebauter Computer spielt, wenn Stockfish fehlt/aus ist")
    del os.environ["SCHACH_STOCKFISH"]

    print("== Pflicht-Prüfung (Engine) ==")
    os.environ["TABLETOP_CONFORMANCE"] = "1"
    check_game(GAME, games=5, settings={"bot_level": 1})

    print()
    if FAILS:
        print(f"❌ {len(FAILS)} Schach-Test(s) fehlgeschlagen")
        sys.exit(1)
    print("✅ Alle Schach-Tests bestanden")


if __name__ == "__main__":
    main()
