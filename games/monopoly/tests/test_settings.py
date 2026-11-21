"""Gameplay-Paket G1–G10: Raum-Einstellungen, Hausregeln, Spieldauer, Zug-Timer,
Bot-Schwierigkeit, Bot-Angebote an Menschen, Handelsablauf.

Läuft im Prozess gegen den echten Server-Code (main.py/game_state.py/bot_ai.py) mit Fake-Sockets –
dadurch lassen sich Zeitlimits ohne Warten testen. Ausführen über tests/run_tests.sh settings.
"""
import os, sys, json, time, asyncio, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
import game_state as gs, bot_ai, main as srv
from game_state import GameRoom

FAILS = []
def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c: FAILS.append(m)
    return c


class FakeWS:
    def __init__(self): self.sent = []
    async def send_text(self, text): self.sent.append(json.loads(text))
    def types(self): return [m.get("type") for m in self.sent]


def make_room(rid, humans=("h",), bots=("b",), settings=None, start=True):
    room = GameRoom(rid, humans[0] if humans else bots[0])
    srv.rooms[rid] = room
    srv.connections[rid] = {}
    for i, h in enumerate(humans):
        room.add_player(h, f"Mensch{i}", gs.TOKEN_OPTIONS[i]["id"], gs.PLAYER_COLORS[i]["hex"])
        srv.connections[rid][h] = FakeWS()
    for j, b in enumerate(bots):
        room.add_player(b, f"Bot{j}", gs.TOKEN_OPTIONS[(4 + j) % 8]["id"], gs.PLAYER_COLORS[(4 + j) % 8]["hex"], is_bot=True)
    if settings:
        assert room.update_settings(settings).get("success"), settings
    if start:
        room.start_game()
    return room


async def send(rid, pid, **data):
    ws = srv.connections[rid][pid]
    async with srv.get_lock(rid):
        await srv.handle_message(ws, rid, pid, data)
    return ws


async def main():
    print("== G10 Einstellungen setzen (Rechte & Validierung) ==")
    room = make_room("S1", humans=("host", "gast"), bots=(), start=False)
    room.host_id = "host"
    await send("S1", "gast", action="SET_SETTINGS", settings={"start_money": 2500})
    ok(room.settings["start_money"] == 1500 and srv.connections["S1"]["gast"].sent[-1]["type"] == "ERROR",
       "Gast darf Regeln nicht ändern")
    await send("S1", "host", action="SET_SETTINGS", settings={"start_money": 2500, "jail_rolls": 2, "free_parking_pot": "ja", "bogus": 1})
    ok(room.settings["start_money"] == 2500 and room.settings["jail_rolls"] == 3 and room.settings["free_parking_pot"] is False,
       f"Host setzt gültige Werte, ungültige werden ignoriert: {room.settings}")
    ok("SETTINGS_UPDATED" in srv.connections["S1"]["gast"].types(), "Alle bekommen SETTINGS_UPDATED")
    room.start_game()
    ok(all(p.money == 2500 for p in room.players), "G1 Startgeld 2500 DM wird beim Start gesetzt")
    await send("S1", "host", action="SET_SETTINGS", settings={"start_money": 1000})
    ok(room.settings["start_money"] == 2500, "Während des Spiels keine Regeländerung")

    print("== G2 Frei-Parken-Topf ==")
    room = make_room("S2", settings={"free_parking_pot": True})
    h = room.players[0]; m0 = h.money
    room.evaluate_square(h, gs.SQUARES[38], 7)                      # Zusatzsteuer 100
    room.apply_card(h, {"action": "PAY_MONEY", "value": 50}, 7)      # Strafe 50
    ok(room.free_parking_pot == 150 and h.money == m0 - 150, f"Steuer + Strafe landen im Topf ({room.free_parking_pot} DM)")
    h.money = 30
    room.evaluate_square(h, gs.SQUARES[38], 7)
    ok(room.free_parking_pot == 180, f"Nur der bezahlte Anteil geht in den Topf (180 statt 250): {room.free_parking_pot}")
    other = room.players[1]; o0 = other.money
    room.evaluate_square(other, gs.SQUARES[20], 7)
    ok(other.money == o0 + 180 and room.free_parking_pot == 0, "Wer auf Frei Parken landet, räumt den Topf ab")
    room2 = make_room("S2b")
    room2.evaluate_square(room2.players[0], gs.SQUARES[38], 7)
    ok(room2.free_parking_pot == 0, "Ohne Regel bleibt der Topf leer")

    print("== G3 Doppeltes Gehalt auf Los ==")
    room = make_room("S3", settings={"double_go": True})
    p = room.players[0]; p.position = 35; m0 = p.money
    room.move_player(p, 5, False)
    ok(p.money == m0 + 400, f"Genau auf Los: +400 DM ({p.money - m0})")
    p.position = 35; m0 = p.money
    room.move_player(p, 7, False)
    ok(p.money - m0 == 200, f"Über Los hinaus (auf Gemeinschaftsfeld): nur 200 DM ({p.money - m0})")

    print("== G4 Gefängnis-Würfe ==")
    room = make_room("S4", settings={"jail_rolls": 1})
    p = room.current_player(); room.send_to_jail(p)
    res = room.roll_dice(forced_dice=[1, 2])
    ok(not res.get("jail_reroll") and p.in_jail and p.jail_turns == 1, "Einstellung 1: nach einem Fehlwurf ist die Runde vorbei")
    room = make_room("S4b")
    p = room.current_player(); room.send_to_jail(p)
    res = room.roll_dice(forced_dice=[1, 2])
    ok(res.get("jail_reroll") and res.get("jail_max_attempts") == 3, "Standard 3: weiterer Versuch in derselben Runde")

    print("== G5 Spieldauer ==")
    room = make_room("S5", humans=("h",), bots=("b1", "b2"), settings={"time_limit_min": 30})
    ok(room.game_ends_at and abs(room.game_ends_at - room.game_started_at - 1800) < 1, "Ende = Start + 30 Min")
    room.players[2].money = 9999
    room.game_ends_at = time.time() - 1
    await srv.tick_room_timers("S5")
    w = room.winner or {}
    ok(room.status == "GAME_OVER" and w.get("reason") == "time" and w.get("id") == "b2" and len(w.get("ranking", [])) == 3,
       f"Nach Ablauf: Spielende, Sieger nach Vermögen ({w.get('name')}), Rangliste mit {len(w.get('ranking', []))} Einträgen")
    ok("GAME_OVER" in srv.connections["S5"]["h"].types(), "GAME_OVER wird gesendet")

    print("== G6 Zug-Timer ==")
    room = make_room("S6", humans=("h",), bots=("b",), settings={"turn_timer_sec": 60})
    room.current_player_idx = 0; room._begin_turn()
    ok(room.to_dict()["turn_deadline"] and room.turn_deadline() - room.turn_started_at == 60, "turn_deadline im State")
    await srv.tick_room_timers("S6")
    ok(room.turn_autoplay_id is None, "Vor Ablauf passiert nichts")
    room.turn_started_at = time.time() - 61
    turn_before = room.turn_counter
    await srv.tick_room_timers("S6")
    ok(room.turn_autoplay_id == "h", "Nach Ablauf übernimmt der Computer den Zug")
    for _ in range(5000):        # Bot-Treiber Schritt für Schritt laufen lassen (Sleeps sind gepatcht)
        await real_sleep(0)
        if room.turn_counter > turn_before and room.current_player().id != "h":
            break
    ok(room.current_player().id == "b" and room.turn_autoplay_id is None,
       f"Zug wurde beendet, Bot ist dran, Übernahme zurückgesetzt (aktuell: {room.current_player().name})")
    room_b = make_room("S6b", humans=("h",), bots=("b",), settings={"turn_timer_sec": 60})
    room_b.current_player_idx = 1; room_b._begin_turn()
    ok(room_b.turn_deadline() is None, "Kein Zug-Timer für Bots")
    srv.cancel_auction_flow("S6"); srv.delete_room("S6")

    print("== G7 Bot-Schwierigkeit ==")
    for diff, should_accept in (("easy", True), ("normal", False), ("hard", False)):
        room = make_room(f"S7{diff}", settings={"bot_difficulty": diff})
        bot = room.players[1]
        room.board_state[37]["owner"] = "h"; room.board_state[39]["owner"] = "b"
        trade = {"sender_id": "h", "target_id": "b", "offer_money": 450, "offer_props": [], "req_money": 0,
                 "req_props": [39], "offer_jail_cards": 0, "req_jail_cards": 0}
        ok(bot_ai.evaluate_trade(room, bot, trade) == should_accept,
           f"{diff}: Schlossallee für 450 DM an den Parkstraßen-Besitzer {'angenommen' if should_accept else 'abgelehnt'}")
    room = make_room("S7b", settings={"bot_difficulty": "easy", "build_rule": "anytime"})
    bot = room.players[1]; bot.money = 5000
    for i in (16, 18, 19): room.board_state[i]["owner"] = "b"
    while (idx := bot_ai.choose_build(room, bot)) is not None:
        room.build_house("b", idx)
    ok(max(room.board_state[i]["houses"] for i in (16, 18, 19)) == 2, "easy: baut höchstens 2 Häuser")
    rn = make_room("S7n"); rh = make_room("S7h", settings={"bot_difficulty": "hard"})
    ok(bot_ai.auction_limit(rh, rh.players[1], 24) > bot_ai.auction_limit(rn, rn.players[1], 24),
       "hard bietet höher als normal")

    print("== G8 Bot-Angebote an Menschen ==")
    room = make_room("S8", humans=("h",), bots=("b",))
    bot = room.players[1]
    for i in (16, 18): room.board_state[i]["owner"] = "b"
    room.board_state[19]["owner"] = "h"
    offer = bot_ai.find_human_offer(room, bot)
    ok(offer and offer["req_props"] == [19] and offer["offer_money"] == 320 and offer["target_id"] == "h",
       f"Bot bietet für Berliner Straße 1,6 × 200 = 320 DM: {offer and offer['offer_money']}")
    # über den echten Bot-Schritt: Angebot geht raus, Bot wartet nicht
    room.current_player_idx = 1; room.rolled = True; room.pending_action = None; room._bot_invest_count = 0
    async with srv.get_lock("S8"):
        await srv._bot_step("S8", room, bot)
    ok(room.pending_trade and room.pending_trade["target_id"] == "h", "Bot-Schritt schickt das Angebot an den Menschen")
    ok("TRADE_PROPOSED" in srv.connections["S8"]["h"].types(), "Mensch bekommt TRADE_PROPOSED")
    ok(bot_ai.find_human_offer(room, bot) is None, "Cooldown: kein zweites Angebot direkt danach")
    room.turn_counter += 10
    ok(bot_ai.find_human_offer(room, bot) is not None, "Nach 10 Zügen darf er wieder fragen")
    # Mensch antwortet mit eigenem Angebot (ersetzt das Bot-Angebot)
    res = room.propose_trade("h", "b", 0, [19], 500, [], 0, 0)
    ok(res.get("success") and room.pending_trade["sender_id"] == "h", "Mensch kann mit eigenem Angebot antworten")
    room.pending_trade["created_at"] -= 61
    await srv.tick_room_timers("S8")
    ok(room.pending_trade is None and "TRADE_REJECTED" in srv.connections["S8"]["h"].types(), "Angebote verfallen nach 60 s")
    room_e = make_room("S8e", settings={"bot_difficulty": "easy"})
    for i in (16, 18): room_e.board_state[i]["owner"] = "b"
    room_e.board_state[19]["owner"] = "h"
    ok(bot_ai.find_human_offer(room_e, room_e.players[1]) is None, "easy macht keine Angebote")

    print("== Playtest-Regeln: Gefängnis-Pasch und Bauen auf der eigenen Farbe ==")
    room = make_room("P1")
    p = room.current_player(); room.send_to_jail(p)
    res = room.roll_dice(forced_dice=[4, 4])
    ok(res.get("jail_freed") and not p.in_jail and p.position == 10 and not room.rolled,
       "Pasch im Gefängnis befreit, Figur bleibt stehen, Spieler würfelt erneut")
    res = room.roll_dice(forced_dice=[2, 3])
    ok(p.position == 15 and res.get("new_pos") == 15, f"Erst der neue Wurf bewegt die Figur (Feld {p.position})")
    ok(p.doubles_count == 0, "Der Befreiungs-Pasch zählt nicht als Pasch-Serie")

    room = make_room("P2", humans=("h", "g"), bots=())
    for i in (16, 18, 19): room.board_state[i]["owner"] = "h"
    room.current_player_idx = 0; h = room.players[0]; h.money = 3000
    h.position = 5
    ok("Farbgruppe" in room.build_house("h", 16).get("error", ""), "Standard: nicht auf Orange → kein Bau")
    h.position = 18
    ok(room.build_house("h", 16).get("success"), "Auf Wiener Straße (Orange) → Bau auf Münchner Straße erlaubt")
    room.current_player_idx = 1
    ok("eigenen Zug" in room.build_house("h", 18).get("error", ""), "Im fremden Zug kein Bau")
    room.current_player_idx = 0; room.send_to_jail(h)
    ok(room.build_house("h", 18).get("error"), "Aus dem Gefängnis heraus kein Bau")
    room = make_room("P3", humans=("h",), bots=("b",), settings={"build_rule": "anytime"})
    for i in (16, 18, 19): room.board_state[i]["owner"] = "b"
    room.current_player_idx = 0; bot = room.players[1]; bot.money = 3000; bot.position = 5
    ok(room.build_house("b", 16).get("success"), "Regel „jederzeit“: Bauen überall und auch im fremden Zug")
    room = make_room("P4", humans=("h",), bots=("b",))
    for i in (16, 18, 19): room.board_state[i]["owner"] = "b"
    room.current_player_idx = 1; bot = room.players[1]; bot.money = 3000; bot.position = 5
    ok(bot_ai.choose_build(room, bot) is None, "Bot baut nicht, wenn er nicht auf seiner Farbe steht")
    bot.position = 19
    ok(bot_ai.choose_build(room, bot) in (16, 18, 19), "… aber sobald er auf Orange steht")

    room = make_room("P5")
    p = room.current_player()
    jf = [i for i, c in enumerate(gs.CHANCE_CARDS) if c["action"] == "GET_OUT_OF_JAIL_FREE"][0]
    room.chance_deck.remove(jf); room.chance_deck.insert(0, jf)
    p.position = 4; room.roll_dice(forced_dice=[1, 2])
    ok(room.last_card is not None, "Gezogene Karte liegt auf dem Stapel, solange sie offen ist")
    room.confirm_card(p.id)
    ok(room.last_card is None and p.jail_cards == 1, "Nach dem Bestätigen verschwindet sie vom Stapel, Gefängnisfrei-Karte ist im Besitz")
    room.last_card = {"deck": "Ereignis", "card": {}, "text": "x", "image": "", "player": p.name}
    room.pending_action = None; room.rolled = True; room.dice = [1, 2]
    room.end_turn(p.id)
    ok(room.last_card is None, "Spätestens beim Zugwechsel ist der Stapel wieder leer")

    print("== Simulation: 30 Bot-Partien mit gemischten Regeln ==")
    errs = []; ended = {"easy": 0, "normal": 0, "hard": 0}
    for seed in range(30):
        random.seed(seed)
        settings = {"bot_difficulty": ["easy", "normal", "hard"][seed % 3],
                    "free_parking_pot": seed % 2 == 0, "double_go": seed % 4 < 2,
                    "jail_rolls": [1, 3][seed % 2], "start_money": [1000, 1500, 2000, 2500][seed % 4],
                    "build_rule": ["on_group", "anytime"][(seed // 3) % 2]}
        rid = f"SIM{seed}"
        room = make_room(rid, humans=(), bots=tuple(f"b{i}" for i in range(2 + seed % 4)), settings=settings)
        srv.connections[rid] = {"watcher": FakeWS()}
        steps = 0
        while room.status == "PLAYING" and steps < 6000:
            steps += 1
            if room.auction_state:
                if not srv.auction_tasks.get(rid) or srv.auction_tasks[rid].done():
                    srv.schedule_auction_flow(rid)
                for _ in range(200):
                    await real_sleep(0)
                    if not room.auction_state: break
                continue
            curr = room.current_player()
            async with srv.get_lock(rid):
                await srv._bot_step(rid, room, curr)
            houses = sum(st["houses"] for st in room.board_state.values() if 0 < st["houses"] < 5)
            if houses > gs.MAX_BANK_HOUSES or room.free_parking_pot < 0:
                errs.append((seed, "Limit/Topf")); break
            for g, sqs in gs.COLOR_GROUPS.items():
                hs = [room.board_state[s]["houses"] for s in sqs]
                if max(hs) - min(hs) > 1:
                    errs.append((seed, f"ungleich {g}")); break
        if room.status == "GAME_OVER": ended[settings["bot_difficulty"]] += 1
        srv.delete_room(rid)
    ok(not errs, f"keine Regelverletzung mit gemischten Einstellungen {errs[:3]}")
    ok(ended["normal"] == 10 and ended["hard"] == 10,
       f"normal/schwer: alle Partien enden mit Sieger ({ended['normal']}/10, {ended['hard']}/10); "
       f"leicht: {ended['easy']}/10 (handelt nicht → Patt erlaubt)")


real_sleep = asyncio.sleep
async def _fast_sleep(_=0):
    await real_sleep(0)
asyncio.sleep = _fast_sleep

asyncio.run(main())
print(f"\n{len(FAILS)} Fehler" if FAILS else "\nAlle Prüfungen bestanden.")
sys.exit(1 if FAILS else 0)
