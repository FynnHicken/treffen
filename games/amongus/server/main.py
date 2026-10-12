import os
import sys
import json
import time
import asyncio
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

from game_state import AmongUsRoom, MAP_WIDTH, MAP_HEIGHT, ROOMS, TASKS_DEF, VENTS, AVAILABLE_COLORS

app = FastAPI(title="PartyHub Among Us Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rooms: Dict[str, AmongUsRoom] = {}
connections: Dict[str, Dict[str, WebSocket]] = {} # room_code -> {pid: ws}

async def broadcast_room(room_code: str, message: dict):
    if room_code in connections:
        payload = json.dumps(message)
        dead = []
        for pid, ws in connections[room_code].items():
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(pid)
        for pid in dead:
            connections[room_code].pop(pid, None)

async def meeting_timer_loop():
    while True:
        await asyncio.sleep(1.0)
        now = time.time()
        for r_code, room in list(rooms.items()):
            if room.status == "MEETING":
                # Bot voting in meetings
                for p in room.players.values():
                    if p.is_bot and p.alive and not p.has_voted and random.random() < 0.25:
                        targets = [cand.id for cand in room.players.values() if cand.alive] + ["SKIP"]
                        room.cast_vote(p.id, random.choice(targets))
                        await broadcast_room(r_code, {
                            "type": "VOTE_CAST",
                            "voter_id": p.id,
                            "has_voted": True
                        })

                if now >= room.meeting_end_time or all(p.has_voted for p in room.players.values() if p.alive):
                    res = room.resolve_votes()
                    await broadcast_room(r_code, {
                        "type": "MEETING_RESOLVED",
                        "result": res,
                        "state": room.to_state_dict()
                    })

async def bot_game_loop():
    last_t = time.time()
    while True:
        await asyncio.sleep(0.1) # 10 ticks/sec
        now = time.time()
        dt = min(0.2, now - last_t)
        last_t = now

        for r_code, room in list(rooms.items()):
            if room.status == "PLAYING" and any(p.is_bot and p.alive for p in room.players.values()):
                events = room.update_bots(dt)
                for ev in events:
                    if ev["type"] == "MOVE":
                        await broadcast_room(r_code, {
                            "type": "PLAYER_MOVED",
                            "player_id": ev["pid"],
                            "x": ev["x"],
                            "y": ev["y"]
                        })
                    elif ev["type"] == "TASK":
                        await broadcast_room(r_code, {
                            "type": "TASK_UPDATED",
                            "player_id": ev["pid"],
                            "task_id": ev["task_id"],
                            "task_progress": room.get_task_progress(),
                            "state": room.to_state_dict()
                        })
                    elif ev["type"] == "KILL":
                        await broadcast_room(r_code, {
                            "type": "PLAYER_KILLED",
                            "killer_id": ev["killer"],
                            "victim_id": ev["victim"],
                            "body": ev["body"],
                            "state": room.to_state_dict()
                        })
                    elif ev["type"] == "EMERGENCY":
                        await broadcast_room(r_code, {
                            "type": "EMERGENCY_CALLED",
                            "caller_id": ev["caller"],
                            "reason": ev["reason"],
                            "state": room.to_state_dict()
                        })

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(meeting_timer_loop())
    asyncio.create_task(bot_game_loop())

@app.get("/api/config")
async def get_config():
    return {
        "map_width": MAP_WIDTH,
        "map_height": MAP_HEIGHT,
        "rooms": ROOMS,
        "tasks": TASKS_DEF,
        "vents": VENTS,
        "colors": AVAILABLE_COLORS
    }

@app.get("/health")
async def health():
    return {"status": "ok", "service": "amongus", "rooms_count": len(rooms)}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    query = websocket.query_params
    room_code = (query.get("room") or "PARTY").upper()
    user_name = query.get("name") or "Crewmate"
    player_id = query.get("id") or f"p_{int(time.time()*1000)}"
    is_host = query.get("host") == "1"

    if room_code not in rooms:
        rooms[room_code] = AmongUsRoom(room_code)
    room = rooms[room_code]

    if room_code not in connections:
        connections[room_code] = {}
    connections[room_code][player_id] = websocket

    player = room.add_player(player_id, user_name, is_host)

    # Initial state to this player
    await websocket.send_text(json.dumps({
        "type": "INIT_PLAYER",
        "player_id": player_id,
        "player": player.to_dict(viewer_role=player.role, show_roles=True),
        "state": room.to_state_dict(viewer_id=player_id)
    }))

    # Broadcast updated room
    await broadcast_room(room_code, {
        "type": "ROOM_UPDATE",
        "state": room.to_state_dict()
    })

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            action = data.get("action")

            if action == "MOVE":
                x = float(data.get("x", player.x))
                y = float(data.get("y", player.y))
                room.update_player_pos(player_id, x, y)
                # Broadcast positions efficiently
                await broadcast_room(room_code, {
                    "type": "PLAYER_MOVED",
                    "player_id": player_id,
                    "x": x,
                    "y": y
                })

            elif action == "START_GAME":
                if player.is_host and room.status in ["LOBBY", "GAME_OVER"]:
                    room.start_game()
                    # Broadcast each player's individual role
                    for pid, ws in connections.get(room_code, {}).items():
                        try:
                            p = room.players.get(pid)
                            if p:
                                await ws.send_text(json.dumps({
                                    "type": "GAME_STARTED",
                                    "your_role": p.role,
                                    "your_tasks": p.tasks,
                                    "state": room.to_state_dict(viewer_id=pid)
                                }))
                        except Exception:
                            pass

            elif action == "ADD_BOT":
                if player.is_host and room.status == "LOBBY":
                    room.add_bot()
                    await broadcast_room(room_code, {
                        "type": "ROOM_UPDATE",
                        "state": room.to_state_dict()
                    })

            elif action == "KILL":
                target_id = data.get("target_id")
                res = room.kill_target(player_id, target_id)
                if res:
                    await broadcast_room(room_code, {
                        "type": "PLAYER_KILLED",
                        "killer_id": player_id,
                        "victim_id": target_id,
                        "body": res["body"],
                        "state": room.to_state_dict()
                    })

            elif action == "TASK_COMPLETE":
                task_id = data.get("task_id")
                if room.complete_task(player_id, task_id):
                    await broadcast_room(room_code, {
                        "type": "TASK_UPDATED",
                        "player_id": player_id,
                        "task_id": task_id,
                        "task_progress": room.get_task_progress(),
                        "state": room.to_state_dict()
                    })

            elif action == "VENT_TOGGLE":
                vent_id = data.get("vent_id")
                room.enter_or_exit_vent(player_id, vent_id)
                await broadcast_room(room_code, {
                    "type": "VENT_UPDATED",
                    "player_id": player_id,
                    "in_vent": player.in_vent,
                    "current_vent": player.current_vent,
                    "x": player.x,
                    "y": player.y
                })

            elif action == "VENT_MOVE":
                target_vent = data.get("target_vent")
                room.switch_vent(player_id, target_vent)
                await broadcast_room(room_code, {
                    "type": "VENT_UPDATED",
                    "player_id": player_id,
                    "in_vent": player.in_vent,
                    "current_vent": player.current_vent,
                    "x": player.x,
                    "y": player.y
                })

            elif action == "CALL_EMERGENCY":
                reason = data.get("reason", "EMERGENCY")
                if room.trigger_emergency(player_id, reason):
                    await broadcast_room(room_code, {
                        "type": "EMERGENCY_CALLED",
                        "caller_id": player_id,
                        "reason": reason,
                        "state": room.to_state_dict()
                    })

            elif action == "VOTE":
                target_id = data.get("target_id") # pid or "SKIP"
                room.cast_vote(player_id, target_id)
                await broadcast_room(room_code, {
                    "type": "VOTE_CAST",
                    "voter_id": player_id,
                    "has_voted": True
                })
                # If resolved early (all voted)
                if room.status == "PLAYING":
                    res = room.resolve_votes()
                    await broadcast_room(room_code, {
                        "type": "MEETING_RESOLVED",
                        "result": res,
                        "state": room.to_state_dict()
                    })

            elif action == "SABOTAGE_LIGHTS":
                if player.role == "IMPOSTOR" and player.alive and room.status == "PLAYING":
                    room.sabotage_lights = not room.sabotage_lights
                    await broadcast_room(room_code, {
                        "type": "SABOTAGE_UPDATE",
                        "sabotage_lights": room.sabotage_lights
                    })

            elif action == "RESTART":
                if player.is_host:
                    room.status = "LOBBY"
                    room.dead_bodies = []
                    room.winner = None
                    room.winner_reason = None
                    for p in room.players.values():
                        p.alive = True
                        p.in_vent = False
                        p.tasks = []
                        p.completed_tasks = []
                        p.has_voted = False
                    await broadcast_room(room_code, {
                        "type": "ROOM_UPDATE",
                        "state": room.to_state_dict()
                    })

    except WebSocketDisconnect:
        connections.get(room_code, {}).pop(player_id, None)
        room.remove_player(player_id)
        if len(room.players) == 0:
            rooms.pop(room_code, None)
        else:
            await broadcast_room(room_code, {
                "type": "PLAYER_LEFT",
                "player_id": player_id,
                "state": room.to_state_dict()
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
    port = int(os.environ.get("PORT", 8093))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
