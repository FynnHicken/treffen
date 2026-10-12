import os
import sys
import json
import uuid
import time
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

rooms: Dict[str, GameRoom] = {}
connections: Dict[str, Dict[str, WebSocket]] = {} # room_id -> {player_id: ws}
room_expiry: Dict[str, float] = {}

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
                rooms.pop(r_id, None)
                room_expiry.pop(r_id, None)

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
    room_id = data.get("room_id") or uuid.uuid4().hex[:6].upper()
    host_id = data.get("player_id") or uuid.uuid4().hex[:8]
    room = GameRoom(room_id, host_id)
    rooms[room_id] = room
    connections[room_id] = {}
    update_room_expiry(room_id, True)
    return {"room_id": room_id, "host_id": host_id}

async def handle_bot_turns_if_needed(room_id: str):
    room = rooms.get(room_id)
    if not room or room.status != "PLAYING":
        return

    # Loop as long as current player is a bot
    while room and room.status == "PLAYING":
        curr = room.current_player()
        if not curr or not curr.is_bot:
            break

        await asyncio.sleep(0.9)
        res = room.auto_bot_turn()
        if not res:
            break

        await broadcast_room(room_id, {
            "type": "STATE_UPDATE",
            "bot_action": res,
            "state": room.to_dict()
        })

@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    await websocket.accept()

    if room_id not in rooms:
        rooms[room_id] = GameRoom(room_id, player_id)
        connections[room_id] = {}
        update_room_expiry(room_id, True)

    room = rooms[room_id]
    connections[room_id][player_id] = websocket

    try:
        while True:
            text = await websocket.receive_text()
            data = json.loads(text)
            action = data.get("action")

            if action == "JOIN":
                already_in = any(p.id == player_id for p in room.players)
                if not already_in and len(room.players) >= 4:
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "code": "ROOM_FULL",
                        "message": "Dieser Raum ist bereits voll (maximal 4 Spieler)!"
                    }))
                    continue

                name = data.get("name", f"Spieler {len(room.players)+1}")
                color = data.get("color")
                if data.get("is_host") is True:
                    room.host_id = player_id

                room.add_player(player_id, name, color=color)
                update_room_expiry(room_id, False)
                await broadcast_room(room_id, {
                    "type": "STATE_UPDATE",
                    "state": room.to_dict()
                })

            elif action == "ADD_BOT":
                if room.status == "LOBBY":
                    if len(room.players) >= 4:
                        await websocket.send_text(json.dumps({
                            "type": "ERROR",
                            "code": "MAX_PLAYERS",
                            "message": "Maximale Anzahl von 4 Spielern/Bots erreicht!"
                        }))
                        continue
                    bot_num = sum(1 for p in room.players if p.is_bot) + 1
                    bot_id = f"bot_{uuid.uuid4().hex[:6]}"
                    bot_name = f"Computer {bot_num}"
                    room.add_player(bot_id, bot_name, is_bot=True)
                    await broadcast_room(room_id, {
                        "type": "STATE_UPDATE",
                        "state": room.to_dict()
                    })

            elif action == "START_GAME":
                if room.host_id == player_id or len(room.players) >= 2:
                    try:
                        room.start_game()
                        await broadcast_room(room_id, {
                            "type": "GAME_STARTED",
                            "state": room.to_dict()
                        })
                        asyncio.create_task(handle_bot_turns_if_needed(room_id))
                    except Exception as e:
                        await websocket.send_text(json.dumps({"type": "ERROR", "message": str(e)}))

            elif action == "ROLL_DICE":
                res = room.roll_dice(player_id)
                await broadcast_room(room_id, {
                    "type": "DICE_ROLLED",
                    "result": res,
                    "state": room.to_dict()
                })
                if res.get("auto_end"):
                    await asyncio.sleep(0.8)
                    room.end_turn()
                    await broadcast_room(room_id, {
                        "type": "TURN_ENDED",
                        "state": room.to_dict()
                    })
                    asyncio.create_task(handle_bot_turns_if_needed(room_id))

            elif action == "MOVE_PIECE":
                piece_id = int(data.get("piece_id", 0))
                res = room.execute_move(player_id, piece_id)
                await broadcast_room(room_id, {
                    "type": "PIECE_MOVED",
                    "result": res,
                    "state": room.to_dict()
                })
                if not res.get("roll_again"):
                    asyncio.create_task(handle_bot_turns_if_needed(room_id))

            elif action == "RESET_LOBBY":
                room.status = "LOBBY"
                room.winner = None
                room.finishers = []
                for p in room.players:
                    p.won = False
                    p.rank = 0
                    for piece in p.pieces:
                        piece.state = "BASE"
                        piece.track_pos = -1
                        piece.goal_pos = -1
                        piece.steps_taken = 0
                await broadcast_room(room_id, {
                    "type": "STATE_UPDATE",
                    "state": room.to_dict()
                })

            elif action == "CHAT":
                msg = str(data.get("message", "")).strip()[:120]
                sender = next((p.name for p in room.players if p.id == player_id), "Spieler")
                if msg:
                    room.log(f"💬 {sender}: {msg}")
                    await broadcast_room(room_id, {
                        "type": "STATE_UPDATE",
                        "state": room.to_dict()
                    })

    except WebSocketDisconnect:
        if room_id in connections and player_id in connections[room_id]:
            connections[room_id].pop(player_id, None)
        update_room_expiry(room_id, False)
        # Notify remaining
        await broadcast_room(room_id, {
            "type": "PLAYER_DISCONNECTED",
            "player_id": player_id,
            "state": room.to_dict()
        })

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
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
