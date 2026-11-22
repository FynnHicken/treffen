import os
import re
import sys
import json
import uuid
import time
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict

BASE_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"

from game_state import GameRoom, COLORS, COLOR_META, TRACK_PIXELS, GOAL_PIXELS

app = FastAPI(title="Mensch ärgere dich nicht - Treffen Edition")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SOLO_ROOM_TTL_SEC = 60.0
EMPTY_ROOM_TTL_SEC = 1800.0
VALID_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

rooms: Dict[str, GameRoom] = {}
connections: Dict[str, Dict[str, WebSocket]] = {}  # room_id -> {player_id: ws}
room_locks: Dict[str, asyncio.Lock] = {}
bot_tasks: Dict[str, asyncio.Task] = {}
room_expiry: Dict[str, float] = {}
room_empty_since: Dict[str, float] = {}


def get_lock(room_id: str) -> asyncio.Lock:
    lock = room_locks.get(room_id)
    if lock is None:
        lock = asyncio.Lock()
        room_locks[room_id] = lock
    return lock


def sanitize_text(val: str, max_len: int = 24, default: str = "Spieler") -> str:
    cleaned = re.sub(r"[\x00-\x1f\x7f<>]", "", str(val or "")).strip()
    return cleaned[:max_len] or default


def delete_room(room_id: str):
    task = bot_tasks.pop(room_id, None)
    if task and not task.done():
        task.cancel()
    rooms.pop(room_id, None)
    connections.pop(room_id, None)
    room_locks.pop(room_id, None)
    room_expiry.pop(room_id, None)
    room_empty_since.pop(room_id, None)


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
            active_conns = len(connections.get(r_id, {}))
            if active_conns == 0:
                room_empty_since.setdefault(r_id, now)
                if now - room_empty_since[r_id] >= EMPTY_ROOM_TTL_SEC:
                    delete_room(r_id)
                    continue
            else:
                room_empty_since.pop(r_id, None)

            update_room_expiry(r_id, False)
            exp = room_expiry.get(r_id)
            if exp and now >= exp and len(room.players) <= 1 and room.status == "LOBBY":
                await broadcast_room(r_id, {
                    "type": "ROOM_EXPIRED",
                    "room_id": r_id,
                    "message": "Ungenutzter Raum (max. 1 Person) wurde nach 60 Sekunden automatisch gelöscht."
                })
                conns = connections.get(r_id, {})
                for ws in list(conns.values()):
                    try:
                        await ws.close()
                    except Exception:
                        pass
                delete_room(r_id)


@app.on_event("startup")
async def start_cleanup_task():
    asyncio.create_task(cleanup_expired_rooms_loop())


async def broadcast_room(room_id: str, message: dict):
    if room_id in connections:
        payload = json.dumps(message)
        dead = []
        for pid, ws in list(connections[room_id].items()):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(pid)
        for pid in dead:
            connections[room_id].pop(pid, None)


async def send_error(websocket: WebSocket, message: str, code: str = "ERROR"):
    try:
        await websocket.send_text(json.dumps({"type": "ERROR", "code": code, "message": message}))
    except Exception:
        pass


@app.get("/api/config")
async def get_config():
    return {
        "colors": COLOR_META,
        "track_pixels": TRACK_PIXELS,
        "goal_pixels": GOAL_PIXELS
    }


@app.get("/api/rooms")
async def list_rooms():
    now = time.time()
    room_list = []
    for r_id, room in list(rooms.items()):
        active_conns = len(connections.get(r_id, {}))
        human_players = [p for p in room.players if not p.is_bot]
        if active_conns == 0 and len(room.players) == 0:
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
            "max_players": 4,
            "connected_count": active_conns,
            "status": room.status,
            "players": [p.name for p in room.players],
            "remaining_ms": rem_ms,
            "ttl_total_ms": int(SOLO_ROOM_TTL_SEC * 1000)
        })
    return {"rooms": room_list}


@app.post("/api/create_room")
async def create_room(data: dict):
    req_room = str(data.get("room_id") or "").strip().upper()
    if req_room and not VALID_ID_RE.match(req_room):
        return {"error": "Ungültige Raum-ID."}
    room_id = req_room or uuid.uuid4().hex[:6].upper()
    req_host = str(data.get("player_id") or "").strip()
    host_id = req_host if (req_host and VALID_ID_RE.match(req_host)) else uuid.uuid4().hex[:8]
    if room_id in rooms:
        return {"room_id": room_id, "host_id": rooms[room_id].host_id, "existing": True}
    room = GameRoom(room_id, host_id)
    rooms[room_id] = room
    connections[room_id] = {}
    update_room_expiry(room_id, True)
    return {"room_id": room_id, "host_id": host_id}


def kick_bot_driver(room_id: str):
    existing = bot_tasks.get(room_id)
    if existing and not existing.done():
        return
    room = rooms.get(room_id)
    if not room or room.status != "PLAYING":
        return
    curr = room.current_player()
    if not curr or not curr.is_bot:
        return
    bot_tasks[room_id] = asyncio.create_task(_bot_driver_loop(room_id))


async def _bot_driver_loop(room_id: str):
    try:
        while True:
            await asyncio.sleep(0.85)
            room = rooms.get(room_id)
            if not room or room.status != "PLAYING":
                break
            async with get_lock(room_id):
                room = rooms.get(room_id)
                if not room or room.status != "PLAYING":
                    break
                curr = room.current_player()
                if not curr or not curr.is_bot:
                    break
                res = room.auto_bot_turn()
                if not res:
                    break
                await broadcast_room(room_id, {
                    "type": "STATE_UPDATE",
                    "bot_action": res,
                    "state": room.to_dict()
                })
    except asyncio.CancelledError:
        pass
    finally:
        if bot_tasks.get(room_id) is asyncio.current_task():
            bot_tasks.pop(room_id, None)


async def _delayed_auto_end_turn(room_id: str, expected_player_id: str):
    await asyncio.sleep(0.75)
    kick = False
    async with get_lock(room_id):
        room = rooms.get(room_id)
        if not room or room.status != "PLAYING":
            return
        curr = room.current_player()
        if curr and curr.id == expected_player_id and not room.valid_moves and room.rolls_left <= 0:
            room.end_turn()
            await broadcast_room(room_id, {
                "type": "TURN_ENDED",
                "state": room.to_dict()
            })
            kick = True
    if kick:
        kick_bot_driver(room_id)


async def handle_message(websocket: WebSocket, room_id: str, player_id: str, data: dict):
    room = rooms.get(room_id)
    if not room:
        return
    action = data.get("action")

    if action == "JOIN":
        already_in = any(p.id == player_id for p in room.players)
        if not already_in and len(room.players) >= 4:
            await send_error(websocket, "Dieser Raum ist bereits voll (maximal 4 Spieler)!", "ROOM_FULL")
            return
        if not already_in and room.status != "LOBBY":
            await send_error(websocket, "Das Spiel läuft bereits – bitte warte auf die nächste Runde.", "GAME_RUNNING")
            return

        name = sanitize_text(data.get("name"), 20, f"Spieler {len(room.players)+1}")
        color = data.get("color") if data.get("color") in COLORS else None
        if data.get("is_host") is True and not room.host_claimed:
            room.host_id = player_id
            room.host_claimed = True
        elif not any(p.id == room.host_id for p in room.players):
            room.host_id = player_id

        room.away_players.discard(player_id)
        room.add_player(player_id, name, color=color)
        update_room_expiry(room_id, False)
        await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})

    elif action == "SET_COLOR":
        res = room.set_player_color(player_id, str(data.get("color", "")))
        if res.get("error"):
            await send_error(websocket, res["error"])
            return
        await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})

    elif action == "SET_SETTINGS":
        if room.host_id != player_id:
            await send_error(websocket, "Nur der Host darf Regeln ändern.")
            return
        res = room.update_settings(data.get("settings") or {})
        if res.get("error"):
            await send_error(websocket, res["error"])
            return
        await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})

    elif action == "ADD_BOT":
        if room.status != "LOBBY":
            await send_error(websocket, "Bots können nur in der Lobby hinzugefügt werden.")
            return
        if room.host_id != player_id:
            await send_error(websocket, "Nur der Host darf Bots hinzufügen.")
            return
        if len(room.players) >= 4:
            await send_error(websocket, "Maximale Anzahl von 4 Spielern/Bots erreicht!", "MAX_PLAYERS")
            return
        bot_num = sum(1 for p in room.players if p.is_bot) + 1
        bot_id = f"bot_{uuid.uuid4().hex[:6]}"
        room.add_player(bot_id, f"Computer {bot_num}", is_bot=True)
        await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})

    elif action == "REMOVE_BOT":
        if room.host_id != player_id:
            await send_error(websocket, "Nur der Host darf Bots entfernen.")
            return
        res = room.remove_bot(str(data.get("bot_id", "")))
        if res.get("error"):
            await send_error(websocket, res["error"])
            return
        await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})

    elif action == "START_GAME":
        if room.status != "LOBBY":
            return
        if room.host_id != player_id and any(p.id == room.host_id and not p.is_bot for p in room.players):
            await send_error(websocket, "Nur der Host kann das Spiel starten.")
            return
        try:
            room.start_game()
            await broadcast_room(room_id, {"type": "GAME_STARTED", "state": room.to_dict()})
            kick_bot_driver(room_id)
        except Exception as e:
            await send_error(websocket, str(e))

    elif action == "ROLL_DICE":
        res = room.roll_dice(player_id)
        if res.get("error"):
            await send_error(websocket, res["error"])
            return
        await broadcast_room(room_id, {
            "type": "DICE_ROLLED",
            "result": res,
            "state": room.to_dict()
        })
        if res.get("auto_end"):
            asyncio.create_task(_delayed_auto_end_turn(room_id, player_id))

    elif action == "MOVE_PIECE":
        try:
            piece_id = int(data.get("piece_id", -1))
        except (TypeError, ValueError):
            await send_error(websocket, "Ungültige Figuren-ID.")
            return
        res = room.execute_move(player_id, piece_id)
        if res.get("error"):
            await send_error(websocket, res["error"])
            return
        await broadcast_room(room_id, {
            "type": "PIECE_MOVED",
            "result": res,
            "state": room.to_dict()
        })
        if not res.get("roll_again"):
            kick_bot_driver(room_id)

    elif action == "RESET_LOBBY":
        if room.status != "GAME_OVER" and room.host_id != player_id:
            await send_error(websocket, "Nur der Host kann ein laufendes Spiel abbrechen.")
            return
        task = bot_tasks.pop(room_id, None)
        if task and not task.done():
            task.cancel()
        room.reset_lobby()
        await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})

    elif action == "CHAT":
        msg = sanitize_text(data.get("message"), 120, "")
        sender = next((p.name for p in room.players if p.id == player_id), None)
        if msg and sender:
            room.log(f"💬 {sender}: {msg}")
            await broadcast_room(room_id, {"type": "STATE_UPDATE", "state": room.to_dict()})


@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    if not VALID_ID_RE.match(room_id) or not VALID_ID_RE.match(player_id):
        await websocket.close(code=1008)
        return

    await websocket.accept()

    async with get_lock(room_id):
        if room_id not in rooms:
            rooms[room_id] = GameRoom(room_id, player_id)
            connections[room_id] = {}
            update_room_expiry(room_id, True)
        connections.setdefault(room_id, {})[player_id] = websocket
        room_empty_since.pop(room_id, None)

    try:
        while True:
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                await send_error(websocket, "Ungültiges Nachrichtenformat.")
                continue
            if not isinstance(data, dict):
                continue
            async with get_lock(room_id):
                await handle_message(websocket, room_id, player_id, data)

    except WebSocketDisconnect:
        async with get_lock(room_id):
            conns = connections.get(room_id, {})
            if conns.get(player_id) is websocket:
                conns.pop(player_id, None)
                room = rooms.get(room_id)
                if room:
                    room.away_players.add(player_id)
                    update_room_expiry(room_id, False)
                    await broadcast_room(room_id, {
                        "type": "PLAYER_DISCONNECTED",
                        "player_id": player_id,
                        "state": room.to_dict()
                    })


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return FileResponse(
        str(INDEX_HTML),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8092))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
