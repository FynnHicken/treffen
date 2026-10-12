import os
import sys
import json
import time
import asyncio
import random
from pathlib import Path
from typing import Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"

from game_state import ImposterRoom, CATEGORIES

app = FastAPI(title="PartyHub Imposter Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rooms: Dict[str, ImposterRoom] = {}
connections: Dict[str, Dict[str, WebSocket]] = {} # room_code -> {pid: ws}

async def broadcast_room(room_code: str):
    if room_code not in connections or room_code not in rooms:
        return
    room = rooms[room_code]
    dead = []
    for pid, ws in list(connections[room_code].items()):
        try:
            await ws.send_text(json.dumps({
                "type": "ROOM_STATE",
                "state": room.to_dict(viewer_id=pid)
            }))
        except Exception:
            dead.append(pid)
    for pid in dead:
        connections[room_code].pop(pid, None)

async def game_flow_loop():
    while True:
        await asyncio.sleep(0.5)
        now = time.time()
        for r_code, room in list(rooms.items()):
            # 1. Bot clue submissions
            if room.status == "CLUES" and room.current_turn_index < len(room.turn_order):
                curr_pid = room.turn_order[room.current_turn_index]
                curr_player = room.players.get(curr_pid)
                if curr_player and curr_player.is_bot:
                    await asyncio.sleep(1.2) # realistic thinking delay
                    bot_clue = room.generate_bot_clue(curr_player)
                    room.submit_clue(curr_pid, bot_clue)
                    await broadcast_room(r_code)

            # 2. Discussion timeout -> Auto-start voting
            elif room.status == "DISCUSSION" and now >= room.discussion_end_time:
                room.start_voting()
                await broadcast_room(r_code)

            # 3. Bot voting in voting phase
            elif room.status == "VOTING":
                bots_unvoted = [p for p in room.players.values() if p.is_bot and not p.has_voted]
                if bots_unvoted:
                    bot = random.choice(bots_unvoted)
                    # Vote for anyone except self
                    candidates = [cand.id for cand in room.players.values() if cand.id != bot.id]
                    if candidates:
                        room.cast_vote(bot.id, random.choice(candidates))
                        await broadcast_room(r_code)

            # 4. Imposter bot guessing word if caught
            elif room.status == "GUESSING":
                imposters = [p for p in room.players.values() if p.role == "IMPOSTER"]
                if imposters and all(imp.is_bot for imp in imposters):
                    await asyncio.sleep(2.0)
                    # Guess a random word from category
                    cat_words = CATEGORIES.get(room.category, ["Pizza"])
                    guess = random.choice(cat_words)
                    room.submit_imposter_guess(guess)
                    await broadcast_room(r_code)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(game_flow_loop())

@app.get("/health")
async def health():
    return {"status": "ok", "service": "imposter", "rooms_count": len(rooms)}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    query = websocket.query_params
    room_code = (query.get("room") or "PARTY").upper()
    user_name = query.get("name") or "Spieler"
    player_id = query.get("id") or f"p_{int(time.time()*1000)}"
    is_host = query.get("host") == "1"

    if room_code not in rooms:
        rooms[room_code] = ImposterRoom(room_code)
    room = rooms[room_code]

    if room_code not in connections:
        connections[room_code] = {}
    connections[room_code][player_id] = websocket

    player = room.add_player(player_id, user_name, is_host)

    # Send initial state
    await broadcast_room(room_code)

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            action = data.get("action")

            if action == "START_ROUND":
                if player.is_host:
                    cat = data.get("category")
                    try:
                        room.start_round(cat)
                        await broadcast_room(room_code)
                    except Exception as e:
                        await websocket.send_text(json.dumps({"type": "ERROR", "message": str(e)}))

            elif action == "SUBMIT_CLUE":
                clue = data.get("clue", "")
                if room.submit_clue(player_id, clue):
                    await broadcast_room(room_code)

            elif action == "START_VOTING":
                if player.is_host and room.status == "DISCUSSION":
                    room.start_voting()
                    await broadcast_room(room_code)

            elif action == "VOTE":
                target_id = data.get("target_id")
                room.cast_vote(player_id, target_id)
                await broadcast_room(room_code)

            elif action == "SUBMIT_GUESS":
                guess = data.get("guess", "")
                room.submit_imposter_guess(guess)
                await broadcast_room(room_code)

            elif action == "ADD_BOT":
                if player.is_host and room.status == "LOBBY":
                    room.add_bot()
                    await broadcast_room(room_code)

            elif action == "RETURN_TO_LOBBY":
                if player.is_host:
                    room.status = "LOBBY"
                    await broadcast_room(room_code)

    except WebSocketDisconnect:
        connections.get(room_code, {}).pop(player_id, None)
        room.remove_player(player_id)
        if len(room.players) == 0:
            rooms.pop(room_code, None)
        else:
            await broadcast_room(room_code)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return FileResponse(
        str(INDEX_HTML),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8094))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
