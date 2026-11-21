"""Unit-Tests der Bot-KI + 40 simulierte Bot-Partien über den echten Bot-Treiber (ohne Server/Netz).

Prüft nach jedem Schritt Regel-Invarianten (Bank-Limits, gleichmäßiges Bauen, keine Häuser mit
Hypothek, Bankrotte ohne Besitz). Ausführen über tests/run_tests.sh.
"""
import os, sys, asyncio, random, collections
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
import game_state as gs, bot_ai, main as srv
from game_state import GameRoom, COLOR_GROUPS, SQUARES

FAILS=[]
def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c: FAILS.append(m)
    return c

print("== Unit-Tests Bot-Entscheidungen ==")
def room2():
    r = GameRoom("U", "h"); r.add_player("h", "Mensch", "dog", "#e74c3c"); r.add_player("b", "Bot", "hat", "#3498db", is_bot=True)
    r.start_game(); return r, r.players[0], r.players[1]
r, H, Bt = room2()
r.board_state[16]["owner"] = "b"; r.board_state[18]["owner"] = "b"
ok(bot_ai.should_buy(r, Bt, 19), "kauft die letzte Straße der eigenen Gruppe")
Bt.money = 260; ok(bot_ai.should_buy(r, Bt, 19), "… auch wenn danach nur 60 DM übrig bleiben")
r, H, Bt = room2(); r.board_state[37]["owner"] = "h"; Bt.money = 500
ok(bot_ai.should_buy(r, Bt, 39), "blockt die Schlossallee, wenn der Mensch die Parkstraße hat")
ok(bot_ai.auction_limit(r, Bt, 39) > 400, f"bietet beim Blocken über Listenpreis: {bot_ai.auction_limit(r, Bt, 39)} DM")

r, H, Bt = room2()
for i in (16, 18, 19): r.board_state[i]["owner"] = "b"
Bt.money = 1500; builds = []
for _ in range(9):
    idx = bot_ai.choose_build(r, Bt)
    if idx is None: break
    assert r.build_house("b", idx).get("success"); builds.append(r.board_state[idx]["houses"])
hs = [r.board_state[i]["houses"] for i in (16, 18, 19)]
ok(max(hs) - min(hs) <= 1 and sum(hs) >= 6, f"baut gleichmäßig auf Orange: {hs}, Geld übrig {Bt.money}")
ok(Bt.money >= bot_ai.cash_reserve(r, Bt), f"hält Reserve ({bot_ai.cash_reserve(r, Bt)} DM)")

r, H, Bt = room2()
r.board_state[37]["owner"] = "h"; r.board_state[39]["owner"] = "b"
t = {"sender_id": "h", "target_id": "b", "offer_money": 450, "offer_props": [], "req_money": 0, "req_props": [39], "offer_jail_cards": 0, "req_jail_cards": 0}
ok(not bot_ai.evaluate_trade(r, Bt, t), "verkauft Schlossallee NICHT für 450 DM, wenn der Mensch damit Dunkelblau komplett hat (alt: angenommen)")
t["offer_money"] = 1000; ok(bot_ai.evaluate_trade(r, Bt, t), "… aber für 1000 DM")
r, H, Bt = room2(); r.board_state[1]["owner"] = "b"; r.board_state[3]["owner"] = "b"
t = {"sender_id": "h", "target_id": "b", "offer_money": 900, "offer_props": [], "req_money": 0, "req_props": [3], "offer_jail_cards": 0, "req_jail_cards": 0}
ok(not bot_ai.evaluate_trade(r, Bt, t), "gibt eine eigene komplette Gruppe nie ab")
r, H, Bt = room2(); r.board_state[6]["owner"] = "b"
t = {"sender_id": "h", "target_id": "b", "offer_money": 130, "offer_props": [], "req_money": 0, "req_props": [6], "offer_jail_cards": 0, "req_jail_cards": 0}
ok(bot_ai.evaluate_trade(r, Bt, t), "fairer Kauf einer Einzelstraße (130 für 100) wird angenommen")

r, H, Bt = room2()
for i in (16, 18, 19): r.board_state[i].update(owner="b", houses=2)
r.board_state[5]["owner"] = "b"; r.board_state[12]["owner"] = "b"; Bt.money = -150
acts = bot_ai.resolve_debt(r, Bt)
ok(Bt.money >= 0 and all(a["type"] == "MORTGAGE" for a in acts) and sum(r.board_state[i]["houses"] for i in (16, 18, 19)) == 6,
   f"Schulden: erst Bahnhof/Werk beleihen, Häuser bleiben stehen ({acts})")

print("== Simulation: 40 komplette Bot-Partien (2–6 Bots) mit echtem Bot-Treiber ==")
class FakeWS:
    async def send_text(self, _): pass
real_sleep = asyncio.sleep
async def no_sleep(_=0): await real_sleep(0)
asyncio.sleep = no_sleep

def check_invariants(room):
    errs = []
    houses = sum(st["houses"] for st in room.board_state.values() if 0 < st["houses"] < 5)
    hotels = sum(1 for st in room.board_state.values() if st["houses"] == 5)
    if houses > gs.MAX_BANK_HOUSES or hotels > gs.MAX_BANK_HOTELS: errs.append(f"Bank-Limit {houses}/{hotels}")
    for g, sqs in COLOR_GROUPS.items():
        hs = [room.board_state[s]["houses"] for s in sqs]
        if max(hs) - min(hs) > 1: errs.append(f"ungleich {g} {hs}")
        if any(h > 0 for h in hs):
            owners = {room.board_state[s]["owner"] for s in sqs}
            if len(owners) != 1: errs.append(f"Häuser ohne Monopol {g}")
            if any(room.board_state[s]["mortgaged"] for s in sqs): errs.append(f"Häuser + Hypothek {g}")
    for p in room.players:
        if p.is_bankrupt and any(st["owner"] == p.id for st in room.board_state.values()): errs.append(f"Bankrotter besitzt noch {p.name}")
    return errs

async def run_game(n_bots, seed, max_steps=6000):
    random.seed(seed)
    rid = f"SIM{seed}"
    room = GameRoom(rid, "x"); srv.rooms[rid] = room; srv.connections[rid] = {"watcher": FakeWS()}
    for i in range(n_bots): room.add_player(f"b{i}", f"Bot{i}", "dog", "#e74c3c", is_bot=True)
    room.update_anim_config({"stepDuration": 40, "stepPause": 0, "landingHold": 0, "diceDuration": 200, "dicePostPause": 0})
    room.start_game()
    steps = 0; errs = []; stuck = 0; built = 0; turns = 0
    while room.status == "PLAYING" and steps < max_steps:
        steps += 1
        if room.auction_state:
            await real_sleep(0); task = srv.auction_tasks.get(rid)
            if not task or task.done():
                srv.schedule_auction_flow(rid)
            await real_sleep(0); continue
        curr = room.current_player()
        async with srv.get_lock(rid):
            before = (room.current_player_idx, room.rolled, str(room.pending_action), curr.money, curr.position)
            wait, ok_ = await srv._bot_step(rid, room, curr)
            after = (room.current_player_idx, room.rolled, str(room.pending_action), curr.money, curr.position)
        if wait is None:  # Auktion läuft
            for _ in range(200):
                await real_sleep(0)
                if not room.auction_state: break
        stuck = stuck + 1 if before == after and not room.auction_state else 0
        if stuck > 20: errs.append(f"hängt bei {curr.name}: {room.pending_action}"); break
        e = check_invariants(room)
        if e: errs += e; break
    built = sum(st["houses"] for st in room.board_state.values())
    srv.delete_room(rid)
    return room, steps, errs, built

async def sim():
    results = collections.Counter(); all_errs = []; max_houses = []; ended = 0
    for seed in range(40):
        n = 2 + seed % 5
        room, steps, errs, built = await run_game(n, seed)
        if errs: all_errs.append((seed, n, errs[:2]))
        if room.status == "GAME_OVER": ended += 1
        max_houses.append(built)
    ok(not all_errs, f"keine Regelverletzung/Hänger in 40 Partien {all_errs[:3]}")
    ok(ended >= 25, f"{ended}/40 Partien bis zum Sieger durchgespielt (Rest: Schrittlimit 6000)")
    ok(sum(1 for h in max_houses if h > 0) >= 30, f"Bots bauen: in {sum(1 for h in max_houses if h > 0)}/40 Partien Häuser (vorher: nie)")
asyncio.run(sim())
print(f"\n{len(FAILS)} Fehler" if FAILS else "\nAlle Prüfungen bestanden.")
sys.exit(1 if FAILS else 0)
