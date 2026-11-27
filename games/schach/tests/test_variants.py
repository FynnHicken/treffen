"""Schach-Varianten: Teamschach, Tandem, Vierschach – gezielte Regelfälle und Computer-Partien (ohne Netzwerk).

    python -I games/schach/tests/test_variants.py
"""
import json
import os
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "tabletop-server"))
os.environ.setdefault("TABLETOP_DB", "")
os.environ["TABLETOP_CONFORMANCE"] = "1"                 # schneller eingebauter Computer statt Stockfish
NS = runpy.run_path(str(ROOT / "games" / "schach" / "server" / "main.py"), run_name="test")
GAME = NS["GAME"]
from tabletop_server import Room  # noqa: E402
from tabletop_server.conformance import check_game  # noqa: E402

FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


def room(variant, humans=4, settings=None):
    """Raum mit Variante; Menschen m0…m3 sitzen auf den Plätzen 0…3 (Rest Computer)."""
    r = Room("V", GAME)
    r.join("m0", "M0", False)
    r.set_settings("m0", {"variant": variant, **(settings or {})})
    for i in range(1, humans):
        r.join(f"m{i}", f"M{i}", False)
    for s in range(r.seats):
        if r.member_at(s) is None:
            r.add_bot("m0", s)
    r.start("m0")
    return r


def mid(r, seat):
    return r.member_at(seat).id


def move(r, seat, piece, to):
    m = mid(r, seat)
    r.grab(m, piece)
    evs = r.drop(m, piece, to)
    return [e["event"] for e in evs if e["event"]["type"] != "PIECE_RELEASED"]


def at(r, field):
    return next((pid for pid, p in r.pieces.items() if p["field"] == field), None)


def main():
    print("== Varianten ==")
    r = Room("L", GAME)
    schema = r.settings_schema()
    ok(schema["variant"]["choices"] == ["klassisch", "team", "tandem", "vierer"] and schema["variant"]["default"] == "klassisch",
       "Hausregel „Spielart“: klassisch (Standard), Team, Tandem, Vierschach")
    ok(r.seats == 2 and "bot_level" in schema, "Klassisch: 2 Plätze, Stärke des Computers einstellbar")

    print("== Teamschach ==")
    r = room("team")
    ok(r.seats == 4 and r.state()["game"]["seat_angles"] == [20, -20, 160, 200], "4 Plätze, Partner nebeneinander")
    ok(r.game["turn"] == 0 and r.rules.to_move(r) == [0], "Weiß 1 beginnt")
    ok(not move(r, 1, "w-P-e2", "e4"), "Weiß 2 darf nicht, solange Weiß 1 dran ist")
    ok(move(r, 0, "w-P-e2", "e4") and r.game["turn"] == 2, "Weiß 1 zieht → Schwarz 1")
    ok(move(r, 2, "b-P-e7", "e5") and r.game["turn"] == 1, "Schwarz 1 → Weiß 2")
    ok(move(r, 1, "w-Q-d1", "h5") and r.game["turn"] == 3, "Weiß 2 bewegt die weiße Dame (Team-Figuren)")
    move(r, 3, "b-N-b8", "c6")
    move(r, 0, "w-B-f1", "c4")
    move(r, 2, "b-N-g8", "f6")
    ev = move(r, 1, "w-Q-d1", "f7")                        # Figuren-IDs nach Startfeld
    ok(ev and r.status == "finished" and sorted(r.game["result"]["winners"]) == [0, 1],
       "Schäfermatt durch Weiß 2: beide Weiß-Spieler gewinnen")

    print("== Tandem ==")
    r = room("tandem")
    ok(sorted(r.rules.to_move(r)) == [0, 3], "Beide Bretter gleichzeitig: A-Weiß (0) und B-Weiß (3)")
    ok(r.play_state(0)["moves"] and not r.play_state(1)["moves"], "Jeder sieht nur seine eigenen Züge")
    ok(not move(r, 0, "B-w-P-e2", "B-e4"), "A-Weiß darf nicht auf Brett B ziehen")
    move(r, 0, "A-w-P-e2", "A-e4")
    move(r, 2, "A-b-P-d7", "A-d5")
    ev = move(r, 0, "A-w-P-e2", "A-d5")
    ok(r.pieces["A-b-P-d7"]["field"] == "r-B-b-0", "Geschlagener schwarzer Bauer landet im Vorrat von B-Schwarz (Partner)")
    ok(any(e.get("reason") == "captured" for e in ev), "… als Ereignis „captured“")
    move(r, 3, "B-w-P-e2", "B-e4")
    ok(r.rules.mover(r, "B") == 1 and any(m["piece"] == "A-b-P-d7" for m in r.play_state(1)["moves"]),
       "B-Schwarz darf den Bauern einsetzen")
    r.pieces["B-b-N-b8"]["field"] = "B-a6"                # Feld b8 frei machen
    ok(not any(m["piece"] == "A-b-P-d7" and m["to"][-1] in "18" for m in r.play_state(1)["moves"])
       and any(m["piece"] == "A-b-P-d7" and m["to"] == "B-b7" for m in r.play_state(1)["moves"]) is False
       and not move(r, 1, "A-b-P-d7", "B-b8"), "Bauer nicht auf die erste/letzte Reihe (b8 frei, trotzdem nicht)")
    r.pieces["B-b-N-b8"]["field"] = "B-b8"
    ev = move(r, 1, "A-b-P-d7", "B-d6")
    ok(ev and r.pieces["A-b-P-d7"]["field"] == "B-d6" and ev[0].get("reason") == "drop", "Einsetzen auf freies Feld = Zug")
    ok(r.rules.mover(r, "B") == 3, "Danach ist auf Brett B wieder Weiß dran")
    # Umgewandelte Figur wird beim Schlagen wieder Bauer
    r.pieces["A-w-P-a2"]["kind"] = "queen"
    events = r.rules._to_partner(r, "A", "A-w-P-a2", "A-a2")
    ok(not r.pieces["A-w-P-a2"].get("kind") and any(e["type"] == "PIECE_CHANGED" and e["kind"] == "pawn" for e in events)
       and r.pieces["A-w-P-a2"]["field"].startswith("r-B-w-"), "Geschlagene umgewandelte Dame → Bauer im Vorrat des Partners")
    saved = Room.from_saved(json.loads(json.dumps(r.to_saved())), GAME)
    ok(saved.variant_id == "tandem" and saved.rules.to_move(saved) == r.rules.to_move(r), "Speichern/Laden mitten im Tandem")
    # Matt auf einem Brett beendet das Spiel
    r = room("tandem")
    for seat, pid, to in [(0, "A-w-P-f2", "A-f3"), (2, "A-b-P-e7", "A-e5"), (0, "A-w-P-g2", "A-g4")]:
        move(r, seat, pid, to)
    move(r, 2, "A-b-Q-d8", "A-h4")
    ok(r.status == "finished" and r.game["result"]["reason"] == "checkmate" and sorted(r.game["result"]["winners"]) == [2, 3],
       "Narrenmatt auf Brett A: Team A-Schwarz + B-Weiß gewinnt")

    print("== Vierschach ==")
    r = room("vierer")
    ok(r.seats == 4 and len([f for f in r.layout["fields"].values() if f["kind"] == "square"]) == 160,
       "Kreuzbrett: 160 Felder, 4 Plätze")
    first = r.rules.actions(r, 0)
    ok(len(first) == 20, f"Rot hat zu Beginn 20 Züge wie im Schach ({len(first)})")
    ok(all(len(r.rules.legal(r.game, r.rules.board(r), s)) == 20 for s in range(4)), "jedes Heer hat 20 Züge")
    ok(move(r, 0, "r-P-h2", "h4") and r.game["turn"] == 1, "Rot zieht, dann Blau (im Uhrzeigersinn)")
    ok(move(r, 1, "b-P-b8", "d8") and r.game["turn"] == 2, "Blau zieht nach rechts (seine Blickrichtung)")
    # Partner nicht schlagbar, Gegner schon
    g, board = r.game, r.rules.board(r)
    board2 = dict(board)
    board2[(6, 6)] = ("r-Q-g1", 0, "queen")
    board2[(6, 9)] = ("y-P-x", 2, "pawn")
    board2[(9, 6)] = ("g-P-x", 3, "pawn")
    targets = {to for frm, to, _ in r.rules.pseudo(g, board2, 0) if frm == (6, 6)}
    ok((6, 9) not in targets and (9, 6) in targets, "Zwei gegen zwei: Partner (Gelb) nicht schlagbar, Grün schon")
    # Umwandlung in der Mitte
    r.pieces["r-P-h2"]["field"] = "h7"
    r.game["turn"] = 0
    ev = move(r, 0, "r-P-h2", "h8")
    ok(any(e["type"] == "PIECE_CHANGED" and e["kind"] == "queen" for e in ev), "Bauer wird auf der 8. Reihe zur Dame")
    # Jeder gegen jeden: Matt → ausscheiden, Figuren verlassen das Brett
    r = room("vierer", settings={"mode": "ffa"})
    ok(r.game["mode"] == "ffa", "Spielart „jeder gegen jeden“")
    b = r.rules.board(r)
    blue = [pid for (sq, (pid, s, k)) in b.items() if s == 1 and k != "king"]
    for pid in blue:
        r.pieces[pid]["field"] = r.rules._tray_slot(r, 0)
    # Blauer König auf a7 (x=0,y=6): Rot-Türme auf b- und c-Linie decken a/b-Reihe … einfacher: Dame + Turm
    r.pieces["b-K-a7"]["field"] = "a4"                   # Ecke des linken Arms
    r.pieces["r-Q-g1"]["field"] = "c5"
    r.pieces["r-R-d1"]["field"] = "b11"
    r.game["turn"] = 0
    ev = move(r, 0, "r-Q-g1", "b4")
    ok(1 in r.game["out"] and r.game["turn"] == 2, "Blau matt → scheidet aus, Gelb ist dran")
    ok(all(r.pieces[p]["field"].startswith("x-") for p in r.pieces if p.startswith("b-")), "Blaue Figuren verlassen das Brett")
    ok(r.game["points"][0] >= 0 and not r.status == "finished", "Spiel läuft mit drei weiter")

    print("== Computer-Partien je Variante (Pflicht-Prüfung) ==")
    check_game(GAME, games=4, variants=["team", "tandem", "vierer"])
    check_game(GAME, games=2, variants=["vierer"], settings={"mode": "ffa"})

    print()
    if FAILS:
        print(f"❌ {len(FAILS)} Fehler")
        sys.exit(1)
    print("✅ Alle Varianten-Tests bestanden")


if __name__ == "__main__":
    main()
