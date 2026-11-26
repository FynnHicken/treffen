"""FastAPI-App für ein Tisch-Spiel: WebSocket, Räume, Präsenz, Auslieferung des Clients.

    from tabletop_server import GameDef, create_app
    app = create_app(GameDef("mensch", "Mensch ärgere dich nicht", ["#f2c230", ...]), client_dist=Path(...))

Lehren aus Monopoly, hier von Anfang an eingebaut:
- Senden an alle Clients parallel mit Timeout – ein langsames Handy bremst nicht den ganzen Raum.
- Ereignisse mit laufender Nummer statt bei jeder Änderung den vollen Zustand.
- Erste Nachricht AUTH {secret}, Spieler-ID daran gebunden; bot_-IDs gesperrt; Host per Hub-Ticket.
"""
import asyncio
import json
import math
import re
import time
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .rooms import GameDef, Room

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
SEND_TIMEOUT_SEC = 3.0
STALE_MEMBER_SEC = 90.0          # so lange bleibt ein getrennter Platz reserviert
EMPTY_ROOM_TTL_SEC = 30 * 60
PRESENCE_MAX_PER_SEC = 30
TABLE_EXTENT = 10.0              # Zeiger-Koordinaten müssen auf/um den Tisch liegen


def create_app(game: GameDef, client_dist: Optional[Path] = None) -> FastAPI:
    app = FastAPI(title=f"Treffen-Spieltisch: {game.title}")
    rooms: Dict[str, Room] = {}
    sockets: Dict[str, Dict[str, WebSocket]] = {}   # room -> member -> ws
    locks: Dict[str, asyncio.Lock] = {}
    app.state.rooms, app.state.sockets = rooms, sockets

    def lock(room_id: str) -> asyncio.Lock:
        return locks.setdefault(room_id, asyncio.Lock())

    async def send(ws: WebSocket, msg: dict) -> bool:
        try:
            await asyncio.wait_for(ws.send_text(json.dumps(msg)), SEND_TIMEOUT_SEC)
            return True
        except Exception:
            return False

    async def broadcast(room_id: str, msgs, exclude: Optional[str] = None):
        if not msgs:
            return
        targets = [(mid, ws) for mid, ws in sockets.get(room_id, {}).items() if mid != exclude]
        if not targets:
            return
        payloads = [json.dumps(m) for m in msgs]

        async def deliver(ws):
            try:
                for p in payloads:
                    await asyncio.wait_for(ws.send_text(p), SEND_TIMEOUT_SEC)
            except Exception:
                try:
                    await ws.close(code=1011)   # zu langsam/kaputt → Client verbindet neu und holt SNAPSHOT
                except Exception:
                    pass
        await asyncio.gather(*(deliver(ws) for _, ws in targets))

    async def housekeeping():
        while True:
            await asyncio.sleep(5)
            now = time.time()
            for room_id, room in list(rooms.items()):
                async with lock(room_id):
                    events = room.remove_stale(STALE_MEMBER_SEC)
                if events:
                    await broadcast(room_id, events)
                if sockets.get(room_id):
                    room.empty_since = None
                elif room.empty_since is None:
                    room.empty_since = now
                elif now - room.empty_since >= EMPTY_ROOM_TTL_SEC:
                    rooms.pop(room_id, None)
                    sockets.pop(room_id, None)
                    locks.pop(room_id, None)

    @app.on_event("startup")
    async def _start():
        asyncio.create_task(housekeeping())

    @app.get("/api/health")
    async def health():
        return {"ok": True, "game": game.id, "rooms": len(rooms)}

    @app.get("/api/rooms")
    async def list_rooms():
        return {"rooms": [
            {"room": r.id, "members": sum(1 for m in r.members.values() if m.connected),
             "seats": game.seats, "taken": sum(1 for m in r.members.values() if m.seat is not None)}
            for r in rooms.values() if sockets.get(r.id)
        ]}

    @app.websocket("/ws/{room_id}/{member_id}")
    async def ws_endpoint(websocket: WebSocket, room_id: str, member_id: str):
        if not SAFE_ID_RE.match(room_id) or not SAFE_ID_RE.match(member_id) or member_id.startswith("bot_"):
            await websocket.close(code=1008)
            return
        room_id = room_id.upper()
        await websocket.accept()

        # 1) AUTH
        try:
            first = json.loads(await asyncio.wait_for(websocket.receive_text(), auth.AUTH_TIMEOUT_SEC))
        except Exception:
            await websocket.close(code=1008)
            return
        secret = first.get("secret") if isinstance(first, dict) and first.get("action") == "AUTH" else None
        if not auth.valid_client_secret(secret):
            await websocket.close(code=1008)
            return
        room = rooms.get(room_id) or rooms.setdefault(room_id, Room(room_id, game))
        digest = auth.hash_secret(secret)
        if room.secrets.get(member_id, digest) != digest:
            await send(websocket, {"type": "ERROR", "code": "ID_IN_USE", "message": "Diese ID gehört einem anderen Browser."})
            await websocket.close(code=4003)
            return
        room.secrets[member_id] = digest

        old = sockets.setdefault(room_id, {}).get(member_id)
        sockets[room_id][member_id] = websocket
        if old is not None and old is not websocket:
            try:
                await old.close(code=4000)   # zweiter Tab/Reconnect ersetzt den alten
            except Exception:
                pass

        presence_budget, presence_t = PRESENCE_MAX_PER_SEC, time.monotonic()
        joined = False
        try:
            while True:
                try:
                    data = json.loads(await websocket.receive_text())
                except (ValueError, TypeError):
                    continue
                if not isinstance(data, dict):
                    continue
                action = data.get("action")

                if action == "PRESENCE":
                    if not joined:
                        continue
                    now = time.monotonic()
                    presence_budget = min(PRESENCE_MAX_PER_SEC, presence_budget + (now - presence_t) * PRESENCE_MAX_PER_SEC)
                    presence_t = now
                    if presence_budget < 1:
                        continue
                    presence_budget -= 1
                    p = clean_presence(data.get("p"))
                    if p is not None:
                        await broadcast(room_id, [{"type": "PRESENCE", "from": member_id, "p": p}], exclude=member_id)
                    continue

                async with lock(room_id):
                    if action == "JOIN":
                        if auth.tickets_enabled():
                            ticket = auth.verify_ticket(data.get("ticket"), room_id)
                            wants_host = bool(ticket and ticket.get("host") is True)
                        else:
                            wants_host = False
                        events = room.join(member_id, data.get("name"), wants_host)
                        joined = True
                        await send(websocket, room.snapshot_for(member_id))
                        await broadcast(room_id, events, exclude=member_id)
                    elif not joined:
                        continue
                    elif action == "SYNC":
                        await send(websocket, room.snapshot_for(member_id))
                    elif action == "SIT":
                        await broadcast(room_id, room.sit(member_id, data.get("seat")))
                    elif action == "STAND":
                        await broadcast(room_id, room.stand_up(member_id))
                    elif action == "ROLL":
                        await broadcast(room_id, room.roll(member_id, data.get("power")))
                    elif action == "GRAB":
                        await broadcast(room_id, room.grab(member_id, data.get("piece")))
                    elif action == "RELEASE":
                        await broadcast(room_id, room.release(member_id, data.get("piece")))
                    elif action == "DROP":
                        events = room.drop(member_id, data.get("piece"), data.get("field"))
                        await broadcast(room_id, events)
                        if events and events[-1]["event"]["type"] == "PIECE_RELEASED":
                            await send(websocket, {"type": "ERROR", "code": "DROP_REJECTED",
                                                   "piece": data.get("piece"), "message": "Dort kann die Figur nicht hin."})
        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[{room_id}] Fehler bei {member_id}: {e!r}")
        finally:
            if sockets.get(room_id, {}).get(member_id) is websocket:
                del sockets[room_id][member_id]
                async with lock(room_id):
                    events = room.disconnected(member_id)
                await broadcast(room_id, events)
                await broadcast(room_id, [{"type": "PRESENCE", "from": member_id, "p": None}])

    if client_dist is not None:
        index = client_dist / "index.html"
        if (client_dist / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=str(client_dist / "assets")), name="assets")

        @app.middleware("http")
        async def cache_headers(request, call_next):
            response = await call_next(request)
            if request.url.path.startswith("/assets/"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response

        @app.get("/")
        async def root():
            if not index.is_file():
                return JSONResponse({"error": "Client nicht gebaut (npm run build)"}, status_code=503)
            return FileResponse(str(index), headers={"Cache-Control": "no-cache"})

    return app


def clean_presence(p) -> Optional[dict]:
    """Zeigerdaten prüfen: {x, z} auf dem Tisch, optional down (gedrückt) und hold (Objekt-ID)."""
    if p is None:
        return None
    if not isinstance(p, dict):
        return None
    try:
        x, z = float(p.get("x")), float(p.get("z"))
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(x) and math.isfinite(z)) or abs(x) > TABLE_EXTENT or abs(z) > TABLE_EXTENT:
        return None
    out = {"x": round(x, 3), "z": round(z, 3), "down": bool(p.get("down"))}
    hold = p.get("hold")
    if isinstance(hold, str) and SAFE_ID_RE.match(hold):
        out["hold"] = hold
    return out
