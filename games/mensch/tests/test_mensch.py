import asyncio
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import game_state as gs
import main as srv

FAILS = []


def ok(cond, msg):
    print(f"  {'OK  ' if cond else 'FAIL'} {msg}")
    if not cond:
        FAILS.append(msg)


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code=1000):
        pass


async def send(room_id, player_id, **payload):
    ws = srv.connections[room_id][player_id]
    async with srv.get_lock(room_id):
        await srv.handle_message(ws, room_id, player_id, payload)


async def main():
    print("== 1. Ziel-Überspringen blockiert & Startfeld-Räumzwang ==")
    room = gs.GameRoom("R1", "p1")
    p1 = room.add_player("p1", "Alice")
    room.add_player("p2", "Bob", is_bot=True)
    room.start_game()

    # Figur 0 steht auf Ziel-Feld a (0), Figur 1 auf Track-Feld 39 (1 Schritt vor Ziel)
    p1.pieces[0].state = "GOAL"
    p1.pieces[0].goal_pos = 0
    p1.pieces[1].state = "TRACK"
    p1.pieces[1].track_pos = 39
    p1.pieces[1].steps_taken = 39
    room.rolls_left = 1
    res = room.roll_dice("p1", forced_val=2)
    enter_moves = [m for m in res["valid_moves"] if m["type"] == "ENTER_GOAL"]
    ok(len(enter_moves) == 0, "Figur auf Track darf eigene Figur auf Zielfeld A nicht überspringen")

    # Startfeld-Räumzwang: Figur 2 im Haus, Figur 1 auf Startfeld (0) -> muss Startfeld räumen
    p1.pieces[0].state = "BASE"
    p1.pieces[0].goal_pos = -1
    p1.pieces[1].state = "TRACK"
    p1.pieces[1].track_pos = 0
    p1.pieces[1].steps_taken = 0
    p1.pieces[2].state = "TRACK"
    p1.pieces[2].track_pos = 15
    p1.pieces[2].steps_taken = 15
    room.has_rolled = False
    room.rolls_left = 1
    room.valid_moves = []
    res = room.roll_dice("p1", forced_val=3)
    ok(len(res["valid_moves"]) == 1 and res["valid_moves"][0]["piece_id"] == 1,
       f"Startfeld-Räumzwang aktiv: nur Figur auf Startfeld darf ziehen ({res['valid_moves']})")

    print("== 2. Schlagen & 6er-Wurf ==")
    p2 = room.players[1]
    p2.pieces[0].state = "TRACK"
    p2.pieces[0].track_pos = 3
    p2.pieces[0].steps_taken = 33
    room.has_rolled = False
    room.rolls_left = 1
    room.valid_moves = []
    room.roll_dice("p1", forced_val=3)
    exec_res = room.execute_move("p1", 1)
    ok(exec_res["beaten"] is not None and p2.pieces[0].state == "BASE",
       "Gegnerische Figur geschlagen und zurück ins Haus geschickt")

    print("== 3. Host-Rechte, XSS-Bereinigung, Farbwechsel ==")
    srv.rooms["WS1"] = gs.GameRoom("WS1", "h1")
    srv.connections["WS1"] = {"h1": FakeWS(), "g1": FakeWS()}
    await send("WS1", "h1", action="JOIN", name="<script>Alice</script>", is_host=True)
    await send("WS1", "g1", action="JOIN", name="Bob", is_host=True)
    r_ws = srv.rooms["WS1"]
    ok(r_ws.host_id == "h1", "Zweites is_host=True übernimmt Host nicht")
    ok("<" not in r_ws.players[0].name, f"Name bereinigt: {r_ws.players[0].name}")
    await send("WS1", "g1", action="START_GAME")
    ok(r_ws.status == "LOBBY", "Nicht-Host kann Spiel nicht starten")
    await send("WS1", "g1", action="SET_COLOR", color="black")
    ok(r_ws.players[1].color == "black", "Spieler kann freie Farbe in der Lobby wählen")
    await send("WS1", "h1", action="SET_SETTINGS", settings={"clear_start": False})
    ok(r_ws.settings["clear_start"] is False, "Host kann Regel-Toggle setzen")
    srv.delete_room("WS1")

    print("== 4. Bot-Simulation: 10 komplette 4-Bot-Partien ==")
    for seed in range(10):
        random.seed(seed)
        sim = gs.GameRoom(f"SIM{seed}", "b0")
        for i in range(4):
            sim.add_player(f"b{i}", f"Bot{i}", is_bot=True)
        sim.start_game()
        steps = 0
        while sim.status == "PLAYING" and steps < 5000:
            steps += 1
            sim.auto_bot_turn()
        ok(sim.status == "GAME_OVER" and sim.winner is not None,
           f"Partie {seed} endet sauber nach {steps} Zügen (Sieger: {sim.winner['name'] if sim.winner else None})")


asyncio.run(main())
print(f"\n{len(FAILS)} Fehler" if FAILS else "\nAlle Prüfungen bestanden.")
sys.exit(1 if FAILS else 0)
