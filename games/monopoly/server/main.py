import os
import sys
import json
import uuid
import time
import re
import random
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Set, Optional

BASE_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"

from game_state import GameRoom, TOKEN_OPTIONS, PLAYER_COLORS, SQUARES, MAX_PLAYERS, clean_text
import bot_ai

app = FastAPI(title="Monopoly 3D Web Edition")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def cache_static_assets(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/assets/"):
        response.headers["Cache-Control"] = "public, max-age=604800, immutable"
    return response

SOLO_ROOM_TTL_SEC = 60.0
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")  # Raum-/Spieler-IDs landen im DOM anderer Spieler

# In-memory rooms and WebSocket connections
rooms: Dict[str, GameRoom] = {}
connections: Dict[str, Dict[str, WebSocket]] = {} # room_id -> {player_id: ws}
auction_tasks: Dict[str, asyncio.Task] = {}
bot_tasks: Dict[str, asyncio.Task] = {}      # room_id -> laufender Bot-Treiber
away_tasks: Dict[tuple, asyncio.Task] = {}   # (room_id, player_id) -> Abwesenheits-Timer
room_locks: Dict[str, asyncio.Lock] = {}
room_empty_since: Dict[str, float] = {}      # room_id -> seit wann ohne Verbindung
room_expiry: Dict[str, float] = {} # room_id -> unix timestamp when room expires

AWAY_GRACE_SEC = float(os.environ.get("MONOPOLY_AWAY_GRACE_SEC", "30"))  # so lange darf ein Spieler weg sein, bevor der Computer übernimmt
EMPTY_ROOM_TTL_SEC = 30 * 60   # Räume ganz ohne Verbindung werden nach 30 min gelöscht
MAX_BOT_INVESTS_PER_TURN = 5   # Häuser/Ablösungen pro Bot-Zug (hält Bot-Züge kurz)


def get_lock(room_id: str) -> asyncio.Lock:
    """Ein Lock pro Raum: alle Zustandsänderungen (Spieler, Bots, Auktion) laufen nacheinander."""
    lock = room_locks.get(room_id)
    if lock is None:
        lock = room_locks[room_id] = asyncio.Lock()
    return lock


def delete_room(room_id: str):
    for registry in (auction_tasks, bot_tasks):
        task = registry.pop(room_id, None)
        if task and task is not asyncio.current_task() and not task.done():
            task.cancel()
    for key in [k for k in away_tasks if k[0] == room_id]:
        task = away_tasks.pop(key)
        if not task.done():
            task.cancel()
    rooms.pop(room_id, None)
    connections.pop(room_id, None)
    room_expiry.pop(room_id, None)
    room_empty_since.pop(room_id, None)
    room_locks.pop(room_id, None)

def update_room_expiry(room_id: str, force_reset: bool = False):
    room = rooms.get(room_id)
    if not room:
        room_expiry.pop(room_id, None)
        return
    if len(room.players) <= 1 and room.status == "LOBBY":
        if room_id not in room_expiry or force_reset:
            room_expiry[room_id] = time.time() + SOLO_ROOM_TTL_SEC
    else:
        room_expiry.pop(room_id, None)

async def cleanup_expired_rooms_loop():
    while True:
        await asyncio.sleep(1.0)
        now = time.time()
        for r_id in list(rooms.keys()):
            room = rooms.get(r_id)
            if not room:
                room_expiry.pop(r_id, None)
                continue
            update_room_expiry(r_id, False)
            exp = room_expiry.get(r_id)
            if exp and now >= exp and len(room.players) <= 1 and room.status == "LOBBY":
                await broadcast_room(r_id, {
                    "type": "ROOM_EXPIRED",
                    "room_id": r_id,
                    "message": "Ungenutzter Raum (max. 1 Person) wurde nach 60 Sekunden automatisch gelöscht."
                })
                conns = connections.pop(r_id, {})
                for ws in list(conns.values()):
                    try:
                        await ws.close()
                    except Exception:
                        pass
                delete_room(r_id)
                continue

            if room.status == "PLAYING":
                await tick_room_timers(r_id)

            # Laufende/beendete Räume ohne jede Verbindung irgendwann aufräumen
            if connections.get(r_id):
                room_empty_since.pop(r_id, None)
            else:
                since = room_empty_since.setdefault(r_id, now)
                if now - since >= EMPTY_ROOM_TTL_SEC:
                    print(f"[Room {r_id}] Seit {EMPTY_ROOM_TTL_SEC // 60} min ohne Verbindung – wird gelöscht.")
                    delete_room(r_id)

async def tick_room_timers(room_id: str):
    """Einmal pro Sekunde: Handelsangebote verfallen lassen, Spieldauer und Zug-Timer prüfen."""
    room = rooms.get(room_id)
    if not room:
        return
    kick = False
    async with get_lock(room_id):
        if room.status != "PLAYING":
            return
        now = time.time()
        if room.expire_trade_if_stale():
            await broadcast_room(room_id, {"type": "TRADE_REJECTED", "result": {"success": True, "expired": True},
                                           "state": room.to_dict()})

        # Spieldauer: sofort beenden (nach einer laufenden Versteigerung)
        if room.game_ends_at and now >= room.game_ends_at and not room.auction_state:
            cancel_auction_flow(room_id)
            res = room.finish_by_time()
            await broadcast_room(room_id, {"type": "GAME_OVER", "result": res, "state": room.to_dict()})
            return

        # Zug-Timer: Computer beendet den Zug eines Menschen, der zu lange braucht
        deadline = room.turn_deadline()
        curr = room.current_player()
        if (deadline and now >= deadline and curr and not room.is_auto_controlled(curr)
                and not room.auction_state):
            room.turn_autoplay_id = curr.id
            room.log(f"⏱️ Zeit für den Zug von {curr.name} abgelaufen – der Computer beendet ihn.")
            await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})
            kick = True
    if kick:
        kick_bot_driver(room_id)


@app.on_event("startup")
async def start_cleanup_task():
    asyncio.create_task(cleanup_expired_rooms_loop())

async def broadcast_room(room_id: str, message: dict):
    if room_id in connections:
        payload = json.dumps(message)
        dead = []
        for pid, ws in connections[room_id].items():
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(pid)
        for pid in dead:
            connections[room_id].pop(pid, None)

@app.get("/api/config")
async def get_config():
    return {
        "tokens": TOKEN_OPTIONS,
        "colors": PLAYER_COLORS,
        "squares": SQUARES
    }

@app.get("/api/rooms")
async def list_rooms():
    now = time.time()
    room_list = []
    for r_id, room in list(rooms.items()):
        active_conns = len(connections.get(r_id, {}))
        human_players = [p for p in room.players if not p.is_bot]
        if active_conns == 0:
            continue
        update_room_expiry(r_id, False)
        exp = room_expiry.get(r_id)
        rem_ms = max(0, int((exp - now) * 1000)) if exp else None
        host_player = next((p for p in room.players if p.id == room.host_id), None)
        host_name = host_player.name if host_player else (human_players[0].name if human_players else "Host")
        room_list.append({
            "room_id": r_id,
            "host_name": host_name,
            "player_count": len(room.players),
            "max_players": MAX_PLAYERS,
            "connected_count": active_conns,
            "status": room.status,
            "players": [p.name for p in room.players],
            "remaining_ms": rem_ms,
            "ttl_total_ms": int(SOLO_ROOM_TTL_SEC * 1000)
        })
    return {"rooms": room_list}

@app.post("/api/create_room")
async def create_room(data: dict):
    room_id = str(data.get("room_id") or uuid.uuid4().hex[:6].upper())
    host_id = str(data.get("player_id") or uuid.uuid4().hex[:8])
    if not SAFE_ID_RE.match(room_id) or not SAFE_ID_RE.match(host_id):
        return JSONResponse({"error": "Ungültige Raum- oder Spieler-ID."}, status_code=400)
    party_id = data.get("party_id")

    # Bestehenden Raum nie überschreiben (sonst ist ein laufendes Spiel weg)
    existing = rooms.get(room_id)
    if existing:
        return {"room_id": room_id, "host_id": existing.host_id, "existing": True}

    room = GameRoom(room_id, host_id, party_id)
    rooms[room_id] = room
    connections[room_id] = {}
    update_room_expiry(room_id, True)
    return {"room_id": room_id, "host_id": host_id}

@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    if not SAFE_ID_RE.match(room_id) or not SAFE_ID_RE.match(player_id):
        await websocket.close(code=1008)
        return
    await websocket.accept()

    # Create room on the fly if not exists
    if room_id not in rooms:
        rooms[room_id] = GameRoom(room_id, player_id)
        connections[room_id] = {}
        update_room_expiry(room_id, True)

    room = rooms[room_id]
    connections.setdefault(room_id, {})[player_id] = websocket
    room_empty_since.pop(room_id, None)

    # Rückkehr: Abwesenheits-Timer stoppen und Kontrolle zurückgeben
    timer = away_tasks.pop((room_id, player_id), None)
    if timer and not timer.done():
        timer.cancel()
    if player_id in room.away_players:
        async with get_lock(room_id):
            room.away_players.discard(player_id)
            p = next((pl for pl in room.players if pl.id == player_id), None)
            if p:
                room.log(f"👋 {p.name} ist zurück und spielt wieder selbst.")
    kick_bot_driver(room_id)  # falls der Treiber mangels Zuschauer pausiert hat

    try:
        while True:
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
                if not isinstance(data, dict):
                    continue
                async with get_lock(room_id):
                    await handle_message(websocket, room_id, player_id, data)
            except WebSocketDisconnect:
                raise
            except Exception as e:
                # Eine fehlerhafte Nachricht darf die Verbindung nicht beenden
                print(f"[Room {room_id}] Fehler bei Aktion von {player_id}: {e!r}")
                try:
                    await websocket.send_text(json.dumps({"type": "ERROR", "message": "Aktion konnte nicht ausgeführt werden."}))
                except Exception:
                    pass

    except WebSocketDisconnect:
        pass
    finally:
        conns = connections.get(room_id)
        # Nur entfernen, wenn das wirklich noch dieser Socket ist (Reconnect hat evtl. schon ersetzt)
        if conns is not None and conns.get(player_id) is websocket:
            conns.pop(player_id, None)
            room = rooms.get(room_id)
            if room:
                schedule_away_timer(room_id, player_id)
                await broadcast_room(room_id, {
                    "type": "PLAYER_DISCONNECTED",
                    "player_id": player_id,
                    "state": room.to_dict()
                })


def schedule_away_timer(room_id: str, player_id: str):
    room = rooms.get(room_id)
    if not room or room.status != "PLAYING":
        return
    if not any(p.id == player_id and not p.is_bot and not p.is_bankrupt for p in room.players):
        return  # Zuschauer oder Bot
    old = away_tasks.pop((room_id, player_id), None)
    if old and not old.done():
        old.cancel()
    away_tasks[(room_id, player_id)] = asyncio.create_task(_mark_away_after_grace(room_id, player_id))


async def _mark_away_after_grace(room_id: str, player_id: str):
    try:
        await asyncio.sleep(AWAY_GRACE_SEC)
    except asyncio.CancelledError:
        return
    away_tasks.pop((room_id, player_id), None)
    room = rooms.get(room_id)
    if not room or room.status != "PLAYING" or player_id in connections.get(room_id, {}):
        return
    async with get_lock(room_id):
        p = next((pl for pl in room.players if pl.id == player_id), None)
        if not p or p.is_bankrupt:
            return
        room.away_players.add(player_id)
        room.log(f"💤 {p.name} ist nicht mehr verbunden – der Computer spielt, bis {p.name} zurück ist.")
        await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})
    kick_bot_driver(room_id)


def is_room_member(room: GameRoom, player_id: str) -> bool:
    return any(p.id == player_id and not p.is_bot for p in room.players)


def host_is_present(room: GameRoom, room_id: str) -> bool:
    return any(p.id == room.host_id for p in room.players) and room.host_id in connections.get(room_id, {})


async def handle_message(websocket: WebSocket, room_id: str, player_id: str, data: dict):
    room = rooms.get(room_id)
    if not room:
        return
    action = data.get("action")

    if action == "JOIN":
        already_in_room = any(p.id == player_id for p in room.players)
        if not already_in_room and room.status != "LOBBY":
            # Laufendes Spiel: neue Leute schauen zu statt mit 1500 DM einzusteigen
            await websocket.send_text(json.dumps({
                "type": "SPECTATOR",
                "message": "Das Spiel läuft bereits – du schaust zu. In der nächsten Runde kannst du mitspielen.",
                "state": room.to_dict()
            }))
            return
        if not already_in_room and len(room.players) >= MAX_PLAYERS:
            await websocket.send_text(json.dumps({
                "type": "ERROR",
                "code": "ROOM_FULL",
                "message": f"Dieser Raum ist bereits voll (maximal {MAX_PLAYERS} Spieler & Bots)!"
            }))
            return
        name = data.get("name", f"Spieler {len(room.players)+1}")
        token = data.get("token", "dog")
        color = data.get("color", "#e74c3c")
        # Host-Flag vom Hub nur einmal pro Raum akzeptieren (sonst kann sich jeder zum Host machen)
        if data.get("is_host") is True and not room.host_claimed and room.status == "LOBBY":
            room.host_id = player_id
            room.host_claimed = True
        room.add_player(player_id, name, token, color)
        update_room_expiry(room_id, False)
        await broadcast_room(room_id, {
            "type": "STATE_UPDATE",
            "state": room.to_dict(),
            "remaining_ms": max(0, int((room_expiry[room_id] - time.time()) * 1000)) if room_id in room_expiry else None
        })

    elif action == "START_GAME":
        if room.status != "LOBBY" or not is_room_member(room, player_id):
            return
        # Nur der Host startet – ist er nicht (mehr) da, übernimmt der startende Spieler
        if room.host_id != player_id:
            if host_is_present(room, room_id):
                await websocket.send_text(json.dumps({"type": "ERROR", "message": "Nur der Host kann das Spiel starten."}))
                return
            room.host_id = player_id
        try:
            room.start_game()
            await broadcast_room(room_id, {
                "type": "GAME_STARTED",
                "state": room.to_dict()
            })
            # Wer schon beim Start nicht verbunden ist, bekommt ebenfalls die Gnadenfrist
            for p in room.players:
                if not p.is_bot and p.id not in connections.get(room_id, {}):
                    schedule_away_timer(room_id, p.id)
            kick_bot_driver(room_id)
        except Exception as e:
            await websocket.send_text(json.dumps({"type": "ERROR", "message": str(e)}))

    elif action == "SET_SETTINGS":
        if room.host_id != player_id:
            await websocket.send_text(json.dumps({"type": "ERROR", "message": "Nur der Host kann die Regeln ändern."}))
            return
        res = room.update_settings(data.get("settings", {}))
        if res.get("error"):
            await websocket.send_text(json.dumps({"type": "ERROR", "message": res["error"]}))
            return
        await broadcast_room(room_id, {"type": "SETTINGS_UPDATED", "result": res, "state": room.to_dict()})

    elif action == "ADD_BOT":
        if room.status == "LOBBY" and is_room_member(room, player_id):
            if len(room.players) >= MAX_PLAYERS:
                await websocket.send_text(json.dumps({
                    "type": "ERROR",
                    "code": "MAX_PLAYERS",
                    "message": f"Maximale Anzahl von {MAX_PLAYERS} Spielern & Bots erreicht!"
                }))
                return
            bot_num = sum(1 for p in room.players if p.is_bot) + 1
            bot_id = f"bot_{uuid.uuid4().hex[:6]}"
            bot_name = f"Computer {bot_num}"
            bot_token = TOKEN_OPTIONS[bot_num % len(TOKEN_OPTIONS)]["id"]
            bot_color = PLAYER_COLORS[bot_num % len(PLAYER_COLORS)]["hex"]
            room.add_player(bot_id, bot_name, bot_token, bot_color, is_bot=True)
            await broadcast_room(room_id, {
                "type": "STATE_UPDATE",
                "state": room.to_dict()
            })

    elif action == "ROLL_DICE":
        curr = room.current_player()
        if curr and curr.id == player_id:
            res = room.roll_dice()
            await broadcast_room(room_id, {
                "type": "DICE_ROLLED",
                "result": res,
                "state": room.to_dict()
            })

    elif action == "BUY_PROPERTY":
        sq_idx = data.get("sq_idx")
        res = room.buy_property(player_id, sq_idx)
        await broadcast_room(room_id, {
            "type": "PROPERTY_BOUGHT",
            "result": res,
            "state": room.to_dict()
        })

    elif action == "START_AUCTION":
        sq_idx = data.get("sq_idx")
        res = room.start_auction(player_id, sq_idx)
        await broadcast_room(room_id, {
            "type": "AUCTION_UPDATED",
            "result": res,
            "state": room.to_dict()
        })
        if res.get("auction_ended"):
            kick_bot_driver(room_id)
        elif room.auction_state:
            schedule_auction_flow(room_id)

    elif action == "AUCTION_BID":
        amount = int(data.get("amount", 0))
        res = room.place_auction_bid(player_id, amount)
        if res.get("error"):
            # Ungültige Aktion nur dem Absender melden – Timer NICHT neu starten
            await websocket.send_text(json.dumps({"type": "ERROR", "message": res["error"]}))
            return
        await broadcast_room(room_id, {
            "type": "AUCTION_UPDATED",
            "result": res,
            "state": room.to_dict()
        })
        if res.get("auction_ended"):
            kick_bot_driver(room_id)
        elif room.auction_state:
            schedule_auction_flow(room_id)

    elif action == "AUCTION_PASS":
        res = room.pass_auction(player_id)
        if res.get("error"):
            # Ungültige Aktion nur dem Absender melden – Timer NICHT neu starten
            await websocket.send_text(json.dumps({"type": "ERROR", "message": res["error"]}))
            return
        await broadcast_room(room_id, {
            "type": "AUCTION_UPDATED",
            "result": res,
            "state": room.to_dict()
        })
        if res.get("auction_ended"):
            cancel_auction_flow(room_id)
            kick_bot_driver(room_id)
        elif room.auction_state:
            schedule_auction_flow(room_id)

    elif action == "AUCTION_TIMEOUT":
        if room.auction_state:
            cancel_auction_flow(room_id)
            res = room.finalize_auction_timeout()
            await broadcast_room(room_id, {
                "type": "AUCTION_UPDATED",
                "result": res,
                "state": room.to_dict()
            })
            kick_bot_driver(room_id)

    elif action == "CONFIRM_CARD":
        res = room.confirm_card(player_id)
        await broadcast_room(room_id, {
            "type": "CARD_APPLIED",
            "result": res,
            "state": room.to_dict()
        })

    elif action == "PAY_INCOME_TAX":
        mode = data.get("mode", "flat")
        res = room.pay_income_tax(player_id, mode)
        await broadcast_room(room_id, {
            "type": "TAX_PAID",
            "result": res,
            "state": room.to_dict()
        })

    elif action == "BUILD_HOUSE":
        sq_idx = data.get("sq_idx")
        res = room.build_house(player_id, sq_idx)
        await broadcast_room(room_id, {
            "type": "HOUSE_BUILT",
            "actor_id": player_id,
            "sq_idx": sq_idx,
            "result": res,
            "state": room.to_dict()
        })

    elif action == "SELL_HOUSE":
        sq_idx = data.get("sq_idx")
        res = room.sell_house(player_id, sq_idx)
        await broadcast_room(room_id, {
            "type": "HOUSE_SOLD",
            "actor_id": player_id,
            "sq_idx": sq_idx,
            "result": res,
            "state": room.to_dict()
        })

    elif action == "PROPOSE_TRADE":
        target_id = data.get("target_id")
        offer_money = int(data.get("offer_money", 0))
        offer_props = [int(x) for x in data.get("offer_props", [])]
        req_money = int(data.get("req_money", 0))
        req_props = [int(x) for x in data.get("req_props", [])]
        offer_jail_cards = int(data.get("offer_jail_cards", 0))
        req_jail_cards = int(data.get("req_jail_cards", 0))
        res = room.propose_trade(
            player_id, target_id, offer_money, offer_props,
            req_money, req_props, offer_jail_cards, req_jail_cards
        )
        await broadcast_room(room_id, {
            "type": "TRADE_PROPOSED",
            "actor_id": player_id,
            "result": res,
            "state": room.to_dict()
        })
        # Auto-evaluate if target is a Bot
        target_p = next((p for p in room.players if p.id == target_id), None)
        if res.get("success") and target_p and target_p.is_bot:
            asyncio.create_task(bot_answer_trade(room_id, res["trade"]["id"]))

    elif action == "ACCEPT_TRADE":
        res = room.accept_trade(player_id)
        await broadcast_room(room_id, {
            "type": "TRADE_ACCEPTED",
            "result": res,
            "state": room.to_dict()
        })

    elif action == "REJECT_TRADE":
        res = room.reject_trade(player_id)
        await broadcast_room(room_id, {
            "type": "TRADE_REJECTED",
            "result": res,
            "state": room.to_dict()
        })

    elif action == "TOGGLE_MORTGAGE":
        sq_idx = data.get("sq_idx")
        res = room.toggle_mortgage(player_id, sq_idx)
        await broadcast_room(room_id, {
            "type": "MORTGAGE_TOGGLED",
            "actor_id": player_id,
            "sq_idx": sq_idx,
            "result": res,
            "state": room.to_dict()
        })

    elif action == "PAY_BAIL":
        res = room.pay_bail(player_id)
        await broadcast_room(room_id, {
            "type": "BAIL_PAID",
            "actor_id": player_id,
            "result": res,
            "state": room.to_dict()
        })

    elif action == "USE_JAIL_CARD":
        res = room.use_jail_card(player_id)
        await broadcast_room(room_id, {
            "type": "JAIL_CARD_USED",
            "actor_id": player_id,
            "result": res,
            "state": room.to_dict()
        })

    elif action == "END_TURN":
        res = room.end_turn(player_id)
        await broadcast_room(room_id, {
            "type": "TURN_ENDED",
            "result": res,
            "state": room.to_dict()
        })
        kick_bot_driver(room_id)

    elif action == "BANKRUPTCY":
        res = room.declare_bankruptcy(player_id)
        await broadcast_room(room_id, {
            "type": "BANKRUPTCY",
            "result": res,
            "state": room.to_dict()
        })
        kick_bot_driver(room_id)

    elif action == "RESET_LOBBY":
        # Host jederzeit, alle Mitspieler erst nach Spielende
        if not is_room_member(room, player_id):
            return
        if room.host_id != player_id and room.status != "GAME_OVER" and host_is_present(room, room_id):
            await websocket.send_text(json.dumps({"type": "ERROR", "message": "Nur der Host kann ein laufendes Spiel abbrechen."}))
            return
        cancel_auction_flow(room_id)
        room.reset_to_lobby()
        await broadcast_room(room_id, {
            "type": "LOBBY_RESET",
            "state": room.to_dict()
        })

    elif action == "CHAT":
        msg = clean_text(data.get("message", ""), 200)
        if msg and is_room_member(room, player_id):
            p = next((pl for pl in room.players if pl.id == player_id), None)
            p_name = p.name if p else "Gast"
            room.log(f"💬 {p_name}: {msg}")
            await broadcast_room(room_id, {
                "type": "CHAT",
                "sender": p_name,
                "message": msg,
                "state": room.to_dict()
            })

    elif action == "UPDATE_ANIM_CONFIG":
        pwd = str(data.get("password", "")).strip()
        if pwd == "admin123":
            room.update_anim_config(data.get("config", {}))
            room.log("🛠️ Debug-Einstellungen für Bewegungs- & Animations-Timings aktualisiert.")
            await broadcast_room(room_id, {
                "type": "ANIM_CONFIG_UPDATED",
                "anim_config": room.anim_config,
                "state": room.to_dict()
            })

    elif action == "DEBUG_ACTION":
        pwd = str(data.get("password", "")).strip()
        if pwd == "admin123":
            cmd = str(data.get("cmd", "")).strip()
            target_id = data.get("target_id") or player_id
            val = data.get("value")
            if cmd == "FORCE_DOUBLES_ROLL":
                d_val = random.randint(1, 6)
                if val is not None:
                    try:
                        d_val = max(1, min(6, int(val)))
                    except ValueError:
                        pass
                res = room.roll_dice(forced_dice=[d_val, d_val], ignore_already_rolled=True)
                await broadcast_room(room_id, {
                    "type": "DICE_ROLLED",
                    "result": res,
                    "state": room.to_dict()
                })
            else:
                res = room.execute_debug_action(cmd, target_id, val)
                if res.get("teleport_roll"):
                    await broadcast_room(room_id, {
                        "type": "DICE_ROLLED",
                        "result": res["teleport_roll"],
                        "state": room.to_dict()
                    })
                elif cmd == "FORCE_BANKRUPTCY":
                    await broadcast_room(room_id, {
                        "type": "BANKRUPTCY",
                        "result": res.get("bankruptcy", res),
                        "state": room.to_dict()
                    })
                    kick_bot_driver(room_id)
                else:
                    await broadcast_room(room_id, {
                        "type": "DEBUG_ACTION_APPLIED",
                        "actor_id": player_id,
                        "result": res,
                        "state": room.to_dict()
                    })



def cancel_auction_flow(room_id: str):
    task = auction_tasks.pop(room_id, None)
    if task and task is not asyncio.current_task() and not task.done():
        task.cancel()


def schedule_auction_flow(room_id: str):
    cancel_auction_flow(room_id)
    auction_tasks[room_id] = asyncio.create_task(_auction_lifecycle_loop(room_id))


async def _auction_lifecycle_loop(room_id: str):
    """5-s-Hammer-Timer + Bot-Gebote. Wartet außerhalb, ändert Zustand nur innerhalb des Raum-Locks."""
    try:
        while True:
            room = rooms.get(room_id)
            if not room or room.status != "PLAYING" or not room.auction_state:
                return
            current_seq = room.auction_state.get("bid_seq", 1)
            has_bot_candidate = any(
                p.is_bot and p.id in room.auction_state["active_bidders"] and p.id != room.auction_state["high_bidder_id"]
                for p in room.players
            )
            elapsed = 0.0
            if has_bot_candidate:
                await asyncio.sleep(1.1)
                elapsed = 1.1
                async with get_lock(room_id):
                    room = rooms.get(room_id)
                    if not room or room.status != "PLAYING" or not room.auction_state:
                        return
                    if room.auction_state.get("bid_seq", 1) != current_seq:
                        continue
                    prev_active_len = len(room.auction_state["active_bidders"])
                    bot_res = room.step_bot_auction_bid()
                    if bot_res:
                        await broadcast_room(room_id, {"type": "AUCTION_UPDATED", "result": bot_res, "state": room.to_dict()})
                        continue
                    if len(room.auction_state["active_bidders"]) != prev_active_len:
                        if not room.auction_state["high_bidder_id"] and not room.auction_state["active_bidders"]:
                            fin_res = room.finalize_auction_timeout()
                            await broadcast_room(room_id, {"type": "AUCTION_UPDATED", "result": fin_res, "state": room.to_dict()})
                            kick_bot_driver(room_id)
                            return
                        await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})

            await asyncio.sleep(max(0.1, 5.0 - elapsed))

            async with get_lock(room_id):
                room = rooms.get(room_id)
                if not room or room.status != "PLAYING" or not room.auction_state:
                    return
                if room.auction_state.get("bid_seq", 1) != current_seq:
                    continue
                fin_res = room.finalize_auction_timeout()
                await broadcast_room(room_id, {"type": "AUCTION_UPDATED", "result": fin_res, "state": room.to_dict()})
            kick_bot_driver(room_id)
            return
    except asyncio.CancelledError:
        return
    finally:
        if auction_tasks.get(room_id) is asyncio.current_task():
            auction_tasks.pop(room_id, None)


def _calc_anim_wait_seconds(room, old_pos: int, new_pos: int, include_dice: bool = True) -> float:
    cfg = getattr(room, "anim_config", {}) or {}
    step_ms = cfg.get("stepDuration", 280) + cfg.get("stepPause", 75)
    hold_ms = cfg.get("landingHold", 900) if cfg.get("cinematicFollow", True) else 200
    dice_ms = (cfg.get("diceDuration", 1350) + cfg.get("dicePostPause", 550)) if include_dice else 0
    if old_pos is not None and new_pos is not None and old_pos != new_pos:
        fwd = (new_pos - old_pos + 40) % 40
        bwd = (old_pos - new_pos + 40) % 40
        steps = bwd if (0 < bwd <= 3) else fwd
    else:
        steps = 0
    total_ms = dice_ms + (steps * step_ms) + hold_ms + 350
    return max(1.5, min(20.0, total_ms / 1000.0))


def kick_bot_driver(room_id: str):
    """Startet den Bot-Treiber des Raums, falls er nicht schon läuft. Blockiert nie."""
    task = bot_tasks.get(room_id)
    if task and not task.done():
        return
    room = rooms.get(room_id)
    if not room or room.status != "PLAYING" or room.auction_state:
        return
    if not room.is_auto_controlled(room.current_player()):
        return
    bot_tasks[room_id] = asyncio.create_task(_bot_driver_loop(room_id))


async def _bot_driver_loop(room_id: str):
    """Spielt Bots und abwesende Spieler – ein Schritt pro Iteration, Warten außerhalb des Locks.
    Ersetzt die frühere Rekursion, die im Socket-Handler eines Menschen lief."""
    try:
        await asyncio.sleep(1.2)
        failures = 0
        while True:
            room = rooms.get(room_id)
            if not room or room.status != "PLAYING" or room.auction_state:
                return
            if not connections.get(room_id):
                return  # niemand schaut zu → pausieren, beim nächsten Connect geht es weiter
            async with get_lock(room_id):
                curr = room.current_player()
                if not room.is_auto_controlled(curr) or curr.is_bankrupt or room.auction_state or room.status != "PLAYING":
                    return
                wait, ok = await _bot_step(room_id, room, curr)
            if not ok:
                failures += 1
                if failures >= 3:
                    print(f"[Room {room_id}] Bot-Treiber gibt auf (wiederholte Fehler) bei {curr.name}.")
                    return
            else:
                failures = 0
            if wait is None:
                return  # z. B. Auktion gestartet – deren Task stößt den Treiber danach wieder an
            await asyncio.sleep(wait)
    except asyncio.CancelledError:
        return
    finally:
        if bot_tasks.get(room_id) is asyncio.current_task():
            bot_tasks.pop(room_id, None)


async def _bot_step(room_id: str, room: GameRoom, curr) -> tuple:
    """Führt genau eine Aktion für den automatisch gesteuerten Spieler aus. Gibt (Wartezeit, Erfolg) zurück."""
    pa = room.pending_action or {}
    pa_type = pa.get("type")

    async def send(msg_type: str, result: Optional[dict] = None):
        payload = {"type": msg_type, "state": room.to_dict()}
        if result is not None:
            payload["result"] = result
        await broadcast_room(room_id, payload)

    def card_delay() -> float:
        return 2.4 if (room.pending_action or {}).get("type") == "CARD_DRAWN" else 0.0

    # 1. Schulden: Häuser verkaufen / Hypotheken, sonst Bankrott
    if curr.money < 0:
        bot_ai.resolve_debt(room, curr)
        if curr.money < 0:
            res = room.declare_bankruptcy(curr.id)
            await send("BANKRUPTCY", res)
            return 1.2, not res.get("error")
        await send("STATE_UPDATE")
        return 0.8, True

    # 2. Offene Karte bestätigen
    if pa_type == "CARD_DRAWN":
        res = room.confirm_card(curr.id)
        await send("CARD_APPLIED", res)
        if res.get("moved") and not curr.in_jail:
            wait = _calc_anim_wait_seconds(room, res.get("old_pos"), res.get("new_pos"), include_dice=False)
        else:
            wait = 1.2
        return wait + card_delay(), not res.get("error")

    # 3. Einkommensteuer (nur bei abwesenden Menschen – Bots zahlen direkt)
    if pa_type == "TAX_CHOICE":
        mode = "percent" if pa.get("percent_tax", 10**9) < pa.get("flat_tax", 200) else "flat"
        res = room.pay_income_tax(curr.id, mode)
        await send("TAX_PAID", res)
        return 1.0, not res.get("error")

    # 4. Kaufen oder versteigern
    if pa_type == "BUY_OR_AUCTION":
        sq = pa["square"]
        wants = bot_ai.should_buy(room, curr, sq["index"]) if curr.is_bot else curr.money >= sq["price"] + 120
        if wants:
            res = room.buy_property(curr.id, sq["index"])
            await send("PROPERTY_BOUGHT", res)
            return 1.0, not res.get("error")
        res = room.start_auction(curr.id, sq["index"])
        await send("AUCTION_UPDATED", res)
        if room.auction_state:
            schedule_auction_flow(room_id)
            return None, True
        return 0.8, not res.get("error")

    # 5. Gefängnis vor dem ersten Wurf: Karte oder Kaution
    if curr.in_jail and not room.rolled and curr.jail_rolls_this_turn == 0:
        if curr.is_bot:
            choice = bot_ai.jail_decision(room, curr)
        else:  # abwesender Mensch: vorsichtig wie bisher
            choice = "card" if curr.jail_cards > 0 else ("bail" if curr.jail_turns >= 2 and curr.money >= 250 else "roll")
        if choice == "card" and curr.jail_cards > 0:
            room.use_jail_card(curr.id)
            await send("JAIL_CARD_USED")
            return 0.6, True
        if choice == "bail" and curr.money >= 50:
            room.pay_bail(curr.id)
            await send("BAIL_PAID")
            return 0.6, True

    # 6. Würfeln
    if not room.rolled:
        res = room.roll_dice()
        await send("DICE_ROLLED", res)
        if res.get("error"):
            return 1.0, False
        wait = _calc_anim_wait_seconds(room, res.get("old_pos"), res.get("new_pos"), include_dice=True)
        return wait + card_delay(), True

    # 7. Vor dem Zugende investieren – je Schritt eine Aktion, damit der Client jede animiert
    invested = getattr(room, "_bot_invest_count", 0)
    if curr.is_bot and not room.pending_trade and invested < MAX_BOT_INVESTS_PER_TURN:
        room._bot_invest_count = invested + 1
        # Einmal pro Zug: Handel mit einem anderen Bot, der eine Farbgruppe komplettiert
        if invested == 0:
            offer = bot_ai.find_bot_trade(room, curr)
            if offer:
                res = room.propose_trade(curr.id, offer["target_id"], offer["offer_money"], offer["offer_props"],
                                         offer["req_money"], offer["req_props"], 0, 0)
                if res.get("success"):
                    await broadcast_room(room_id, {"type": "TRADE_PROPOSED", "actor_id": curr.id,
                                                   "result": res, "state": room.to_dict()})
                    acc = room.accept_trade(offer["target_id"])
                    await broadcast_room(room_id, {"type": "TRADE_ACCEPTED", "result": acc, "state": room.to_dict()})
                    return 1.5, True
            # Angebot an einen Menschen: der Bot wartet nicht auf die Antwort (verfällt nach 60 s)
            offer = bot_ai.find_human_offer(room, curr)
            if offer:
                res = room.propose_trade(curr.id, offer["target_id"], offer["offer_money"], offer["offer_props"],
                                         offer["req_money"], offer["req_props"], 0, 0)
                room.bot_offer_log[(curr.id, offer["target_id"], offer["group"])] = room.turn_counter
                if res.get("success"):
                    await broadcast_room(room_id, {"type": "TRADE_PROPOSED", "actor_id": curr.id,
                                                   "result": res, "state": room.to_dict()})
                    return 1.0, True
        idx = bot_ai.choose_unmortgage(room, curr)
        if idx is not None:
            res = room.toggle_mortgage(curr.id, idx)
            if res.get("success"):
                await broadcast_room(room_id, {"type": "MORTGAGE_TOGGLED", "actor_id": curr.id, "sq_idx": idx,
                                               "result": res, "state": room.to_dict()})
                return 0.7, True
        idx = bot_ai.choose_build(room, curr)
        if idx is not None:
            res = room.build_house(curr.id, idx)
            if res.get("success"):
                await broadcast_room(room_id, {"type": "HOUSE_BUILT", "actor_id": curr.id, "sq_idx": idx,
                                               "result": res, "state": room.to_dict()})
                return 0.7, True

    # 8. Zug beenden (bei Pasch setzt end_turn rolled zurück → nächster Schritt würfelt erneut)
    room._bot_invest_count = 0
    res = room.end_turn(curr.id)
    await send("TURN_ENDED", res)
    return 1.2, not res.get("error")


async def bot_answer_trade(room_id: str, trade_id: str):
    await asyncio.sleep(1.0)
    room = rooms.get(room_id)
    if not room:
        return
    async with get_lock(room_id):
        trade = room.pending_trade
        if not trade or trade.get("id") != trade_id:
            return
        target_p = next((p for p in room.players if p.id == trade["target_id"]), None)
        if not target_p or not target_p.is_bot:
            return
        if bot_ai.evaluate_trade(room, target_p, trade) and target_p.money >= trade["req_money"]:
            res = room.accept_trade(target_p.id)
            await broadcast_room(room_id, {"type": "TRADE_ACCEPTED", "result": res, "state": room.to_dict()})
        else:
            res = room.reject_trade(target_p.id)
            await broadcast_room(room_id, {"type": "TRADE_REJECTED", "result": res, "state": room.to_dict()})


# Mount static files dynamically
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def root():
    return FileResponse(
        str(INDEX_HTML),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8090))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
