import os
import sys
import json
import uuid
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Set

BASE_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"

from game_state import GameRoom, TOKEN_OPTIONS, PLAYER_COLORS, SQUARES

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

# In-memory rooms and WebSocket connections
rooms: Dict[str, GameRoom] = {}
connections: Dict[str, Dict[str, WebSocket]] = {} # room_id -> {player_id: ws}
auction_tasks: Dict[str, asyncio.Task] = {}

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
    room_list = []
    for r_id, room in list(rooms.items()):
        active_conns = len(connections.get(r_id, {}))
        human_players = [p for p in room.players if not p.is_bot]
        if active_conns == 0:
            continue
        host_player = next((p for p in room.players if p.id == room.host_id), None)
        host_name = host_player.name if host_player else (human_players[0].name if human_players else "Host")
        room_list.append({
            "room_id": r_id,
            "host_name": host_name,
            "player_count": len(room.players),
            "connected_count": active_conns,
            "status": room.status,
            "players": [p.name for p in room.players]
        })
    return {"rooms": room_list}

@app.post("/api/create_room")
async def create_room(data: dict):
    room_id = data.get("room_id") or uuid.uuid4().hex[:6].upper()
    host_id = data.get("player_id") or uuid.uuid4().hex[:8]
    party_id = data.get("party_id")
    
    room = GameRoom(room_id, host_id, party_id)
    rooms[room_id] = room
    connections[room_id] = {}
    return {"room_id": room_id, "host_id": host_id}

@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    await websocket.accept()

    # Create room on the fly if not exists
    if room_id not in rooms:
        rooms[room_id] = GameRoom(room_id, player_id)
        connections[room_id] = {}

    room = rooms[room_id]
    connections[room_id][player_id] = websocket

    try:
        while True:
            text = await websocket.receive_text()
            data = json.loads(text)
            action = data.get("action")

            if action == "JOIN":
                name = data.get("name", f"Spieler {len(room.players)+1}")
                token = data.get("token", "dog")
                color = data.get("color", "#e74c3c")
                room.add_player(player_id, name, token, color)
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
                        await handle_bot_turn_if_needed(room_id)
                    except Exception as e:
                        await websocket.send_text(json.dumps({"type": "ERROR", "message": str(e)}))

            elif action == "ADD_BOT":
                if room.status == "LOBBY":
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
                    await finish_bot_turn_after_auction_if_needed(room_id)
                elif room.auction_state:
                    schedule_auction_flow(room_id)

            elif action == "AUCTION_BID":
                amount = int(data.get("amount", 0))
                res = room.place_auction_bid(player_id, amount)
                await broadcast_room(room_id, {
                    "type": "AUCTION_UPDATED",
                    "result": res,
                    "state": room.to_dict()
                })
                if res.get("auction_ended"):
                    await finish_bot_turn_after_auction_if_needed(room_id)
                elif room.auction_state:
                    schedule_auction_flow(room_id)

            elif action == "AUCTION_PASS":
                res = room.pass_auction(player_id)
                await broadcast_room(room_id, {
                    "type": "AUCTION_UPDATED",
                    "result": res,
                    "state": room.to_dict()
                })
                if res.get("auction_ended"):
                    cancel_auction_flow(room_id)
                    await finish_bot_turn_after_auction_if_needed(room_id)
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
                    await finish_bot_turn_after_auction_if_needed(room_id)

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
                    "result": res,
                    "state": room.to_dict()
                })

            elif action == "SELL_HOUSE":
                sq_idx = data.get("sq_idx")
                res = room.sell_house(player_id, sq_idx)
                await broadcast_room(room_id, {
                    "type": "HOUSE_SOLD",
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
                    "result": res,
                    "state": room.to_dict()
                })
                # Auto-evaluate if target is a Bot
                target_p = next((p for p in room.players if p.id == target_id), None)
                if res.get("success") and target_p and target_p.is_bot:
                    await asyncio.sleep(1.0)
                    offer_val = offer_money + offer_jail_cards * 50 + sum(SQUARES[i]["price"] for i in offer_props)
                    req_val = req_money + req_jail_cards * 50 + sum(SQUARES[i]["price"] for i in req_props)
                    if offer_val >= req_val and target_p.money >= req_money:
                        acc_res = room.accept_trade(target_p.id)
                        await broadcast_room(room_id, {
                            "type": "TRADE_ACCEPTED",
                            "result": acc_res,
                            "state": room.to_dict()
                        })
                    else:
                        rej_res = room.reject_trade(target_p.id)
                        await broadcast_room(room_id, {
                            "type": "TRADE_REJECTED",
                            "result": rej_res,
                            "state": room.to_dict()
                        })

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
                    "result": res,
                    "state": room.to_dict()
                })

            elif action == "PAY_BAIL":
                res = room.pay_bail(player_id)
                await broadcast_room(room_id, {
                    "type": "BAIL_PAID",
                    "result": res,
                    "state": room.to_dict()
                })

            elif action == "USE_JAIL_CARD":
                res = room.use_jail_card(player_id)
                await broadcast_room(room_id, {
                    "type": "JAIL_CARD_USED",
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
                await handle_bot_turn_if_needed(room_id)

            elif action == "BANKRUPTCY":
                res = room.declare_bankruptcy(player_id)
                await broadcast_room(room_id, {
                    "type": "BANKRUPTCY",
                    "result": res,
                    "state": room.to_dict()
                })
                await handle_bot_turn_if_needed(room_id)

            elif action == "RESET_LOBBY":
                cancel_auction_flow(room_id)
                room.reset_to_lobby()
                await broadcast_room(room_id, {
                    "type": "LOBBY_RESET",
                    "state": room.to_dict()
                })

            elif action == "CHAT":
                msg = data.get("message", "").strip()
                if msg:
                    p = next((pl for pl in room.players if pl.id == player_id), None)
                    p_name = p.name if p else "Gast"
                    room.log(f"💬 {p_name}: {msg}")
                    await broadcast_room(room_id, {
                        "type": "CHAT",
                        "sender": p_name,
                        "message": msg,
                        "state": room.to_dict()
                    })

    except WebSocketDisconnect:
        if room_id in connections:
            connections[room_id].pop(player_id, None)
            await broadcast_room(room_id, {
                "type": "PLAYER_DISCONNECTED",
                "player_id": player_id,
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
                room = rooms.get(room_id)
                if not room or room.status != "PLAYING" or not room.auction_state:
                    return
                if room.auction_state.get("bid_seq", 1) != current_seq:
                    continue

                prev_active_len = len(room.auction_state["active_bidders"])
                bot_res = room.step_bot_auction_bid()
                if bot_res:
                    await broadcast_room(room_id, {
                        "type": "AUCTION_UPDATED",
                        "result": bot_res,
                        "state": room.to_dict()
                    })
                    continue
                elif len(room.auction_state["active_bidders"]) != prev_active_len:
                    if not room.auction_state["high_bidder_id"] and len(room.auction_state["active_bidders"]) == 0:
                        fin_res = room.finalize_auction_timeout()
                        await broadcast_room(room_id, {
                            "type": "AUCTION_UPDATED",
                            "result": fin_res,
                            "state": room.to_dict()
                        })
                        await finish_bot_turn_after_auction_if_needed(room_id)
                        return
                    else:
                        await broadcast_room(room_id, {
                            "type": "STATE_UPDATE",
                            "state": room.to_dict()
                        })

            remaining = max(0.1, 5.0 - elapsed)
            await asyncio.sleep(remaining)

            room = rooms.get(room_id)
            if not room or room.status != "PLAYING" or not room.auction_state:
                return
            if room.auction_state.get("bid_seq", 1) != current_seq:
                continue

            fin_res = room.finalize_auction_timeout()
            await broadcast_room(room_id, {
                "type": "AUCTION_UPDATED",
                "result": fin_res,
                "state": room.to_dict()
            })
            await finish_bot_turn_after_auction_if_needed(room_id)
            return
    except asyncio.CancelledError:
        return


async def finish_bot_turn_after_auction_if_needed(room_id: str):
    room = rooms.get(room_id)
    if not room or room.status != "PLAYING" or room.auction_state:
        return
    curr = room.current_player()
    if curr and curr.is_bot and not curr.is_bankrupt:
        await asyncio.sleep(0.8)
        if curr.money < 0:
            room.auto_resolve_bot_debt(curr)
        if curr.money < 0:
            bank_res = room.declare_bankruptcy(curr.id)
            await broadcast_room(room_id, {
                "type": "BANKRUPTCY",
                "result": bank_res,
                "state": room.to_dict()
            })
        elif room.rolled:
            end_res = room.end_turn(curr.id)
            await broadcast_room(room_id, {
                "type": "TURN_ENDED",
                "result": end_res,
                "state": room.to_dict()
            })
        await handle_bot_turn_if_needed(room_id)


async def handle_bot_turn_if_needed(room_id: str):
    room = rooms.get(room_id)
    if not room or room.status != "PLAYING" or room.auction_state:
        return

    curr = room.current_player()
    if curr and curr.is_bot and not curr.is_bankrupt:
        await asyncio.sleep(1.2)
        # Bot jail handling before rolling
        if curr.in_jail and not room.rolled:
            if curr.jail_cards > 0:
                room.use_jail_card(curr.id)
                await broadcast_room(room_id, {
                    "type": "JAIL_CARD_USED",
                    "state": room.to_dict()
                })
                await asyncio.sleep(0.6)
            elif curr.money >= 250:
                room.pay_bail(curr.id)
                await broadcast_room(room_id, {
                    "type": "BAIL_PAID",
                    "state": room.to_dict()
                })
                await asyncio.sleep(0.6)

        # Bot rolls
        roll_res = room.roll_dice()
        await broadcast_room(room_id, {
            "type": "DICE_ROLLED",
            "result": roll_res,
            "state": room.to_dict()
        })
        await asyncio.sleep(2.4)

        while room.pending_action and room.pending_action.get("type") == "CARD_DRAWN":
            await asyncio.sleep(3.2)
            card_res = room.confirm_card(curr.id)
            await broadcast_room(room_id, {
                "type": "CARD_APPLIED",
                "result": card_res,
                "state": room.to_dict()
            })
            await asyncio.sleep(2.2 if card_res.get("moved") else 1.2)

        # Bot decision on pending action
        if room.pending_action and room.pending_action.get("type") == "BUY_OR_AUCTION":
            sq = room.pending_action["square"]
            price = sq["price"]
            if curr.money >= price + 120:
                room.buy_property(curr.id, sq["index"])
                await broadcast_room(room_id, {
                    "type": "PROPERTY_BOUGHT",
                    "state": room.to_dict()
                })
                await asyncio.sleep(1.0)
            else:
                # Start auction according to Parker rules!
                auc_res = room.start_auction(curr.id, sq["index"])
                await broadcast_room(room_id, {
                    "type": "AUCTION_UPDATED",
                    "result": auc_res,
                    "state": room.to_dict()
                })
                if room.auction_state:
                    schedule_auction_flow(room_id)
                    return

        # Bot debt resolution or bankruptcy
        if curr.money < 0:
            room.auto_resolve_bot_debt(curr)
        if curr.money < 0:
            bank_res = room.declare_bankruptcy(curr.id)
            await broadcast_room(room_id, {
                "type": "BANKRUPTCY",
                "result": bank_res,
                "state": room.to_dict()
            })
            await handle_bot_turn_if_needed(room_id)
            return

        # Bot ends turn (or rolls again immediately if room.rolled was reset due to Pasch)
        if room.rolled:
            end_res = room.end_turn(curr.id)
            await broadcast_room(room_id, {
                "type": "TURN_ENDED",
                "result": end_res,
                "state": room.to_dict()
            })
        await handle_bot_turn_if_needed(room_id)

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
