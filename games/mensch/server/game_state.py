import os
import json
import random
import time
from typing import Dict, List, Optional, Any

# 4 Colors in standard turn order: Yellow -> Green -> Red -> Black
COLORS = ["yellow", "green", "red", "black"]

COLOR_META = {
    "yellow": {
        "name": "Gelb",
        "hex": "#f1c40f",
        "start_pos": 0,       # Track index for Start "A"
        "target_entry": 39,   # Last common track index before entering goal
        "home_x": [82, 166, 82, 166],
        "home_y": [82, 82, 166, 166]
    },
    "green": {
        "name": "Grün",
        "hex": "#27ae60",
        "start_pos": 10,
        "target_entry": 9,
        "home_x": [858, 942, 858, 942],
        "home_y": [82, 82, 166, 166]
    },
    "red": {
        "name": "Rot",
        "hex": "#e74c3c",
        "start_pos": 20,
        "target_entry": 19,
        "home_x": [858, 942, 858, 942],
        "home_y": [858, 858, 942, 942]
    },
    "black": {
        "name": "Schwarz",
        "hex": "#2c3e50",
        "start_pos": 30,
        "target_entry": 29,
        "home_x": [82, 166, 82, 166],
        "home_y": [858, 858, 942, 942]
    }
}

# 40 common board squares (0 to 39) clockwise starting at Yellow A (row 4, col 0)
# (row, col) in 11x11 grid (0..10)
GRID_TRACK_COORDS = [
    # 0..4: Yellow arm to top arm
    (4, 0), (4, 1), (4, 2), (4, 3), (4, 4),
    # 5..9: Up left side of top arm
    (3, 4), (2, 4), (1, 4), (0, 4), (0, 5),
    # 10..14: Green start (0, 6) down right side of top arm
    (0, 6), (1, 6), (2, 6), (3, 6), (4, 6),
    # 15..19: Right arm top side
    (4, 7), (4, 8), (4, 9), (4, 10), (5, 10),
    # 20..24: Red start (6, 10) left along bottom of right arm
    (6, 10), (6, 9), (6, 8), (6, 7), (6, 6),
    # 25..29: Down right side of bottom arm
    (7, 6), (8, 6), (9, 6), (10, 6), (10, 5),
    # 30..34: Black start (10, 4) up left side of bottom arm
    (10, 4), (9, 4), (8, 4), (7, 4), (6, 4),
    # 35..39: Left arm bottom side
    (6, 3), (6, 2), (6, 1), (6, 0), (5, 0)
]

# 4 goal houses for each color: a, b, c, d
# Yellow: row 5, col 1..4
# Green: col 5, row 1..4
# Red: row 5, col 9..6 (decreasing col)
# Black: col 5, row 9..6 (decreasing row)
GRID_GOAL_COORDS = {
    "yellow": [(5, 1), (5, 2), (5, 3), (5, 4)],
    "green":  [(1, 5), (2, 5), (3, 5), (4, 5)],
    "red":    [(5, 9), (5, 8), (5, 7), (5, 6)],
    "black":  [(9, 5), (8, 5), (7, 5), (6, 5)]
}

# Precompute pixel positions (x, y) on 1024x1024 board
def _grid_to_pixel(r: int, c: int) -> dict:
    x = 84 * c + 92
    y = 84 * r + 92
    return {"x": x, "y": y}

TRACK_PIXELS = [_grid_to_pixel(r, c) for (r, c) in GRID_TRACK_COORDS]
GOAL_PIXELS = {
    color: [_grid_to_pixel(r, c) for (r, c) in coords]
    for color, coords in GRID_GOAL_COORDS.items()
}

class Piece:
    def __init__(self, color: str, piece_id: int):
        self.color = color
        self.piece_id = piece_id  # 0..3
        self.state = "BASE"       # "BASE", "TRACK", "GOAL"
        self.track_pos = -1       # 0..39 if "TRACK"
        self.goal_pos = -1        # 0..3 if "GOAL" (a=0, b=1, c=2, d=3)
        self.steps_taken = 0      # Total steps taken on the track (0..39)

    def to_dict(self):
        return {
            "color": self.color,
            "piece_id": self.piece_id,
            "state": self.state,
            "track_pos": self.track_pos,
            "goal_pos": self.goal_pos,
            "steps_taken": self.steps_taken
        }

class Player:
    def __init__(self, player_id: str, name: str, color: str, is_bot: bool = False):
        self.id = player_id
        self.name = name
        self.color = color
        self.is_bot = is_bot
        self.pieces = [Piece(color, i) for i in range(4)]
        self.won = False
        self.rank = 0

    def has_won(self) -> bool:
        return all(p.state == "GOAL" for p in self.pieces)

    def pieces_in_base(self) -> List[Piece]:
        return [p for p in self.pieces if p.state == "BASE"]

    def pieces_on_track(self) -> List[Piece]:
        return [p for p in self.pieces if p.state == "TRACK"]

    def pieces_in_goal(self) -> List[Piece]:
        return [p for p in self.pieces if p.state == "GOAL"]

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "is_bot": self.is_bot,
            "won": self.won,
            "rank": self.rank,
            "pieces": [p.to_dict() for p in self.pieces]
        }

class GameRoom:
    def __init__(self, room_id: str, host_id: str):
        self.room_id = room_id
        self.host_id = host_id
        self.status = "LOBBY"  # "LOBBY", "PLAYING", "GAME_OVER"
        self.players: List[Player] = []
        self.current_player_idx = 0
        self.dice = 0
        self.has_rolled = False
        self.rolls_left = 3     # If all pieces in base (or only pieces in base/goal), gets 3 rolls to roll a 6
        self.valid_moves: List[dict] = []
        self.logs: List[str] = []
        self.winner: Optional[dict] = None
        self.finishers: List[str] = []
        self.created_at = time.time()
        self.log(f"Raum {room_id} erstellt.")

    def log(self, message: str):
        self.logs.append(message)
        if len(self.logs) > 60:
            self.logs.pop(0)

    def get_player(self, player_id: str) -> Optional[Player]:
        for p in self.players:
            if p.id == player_id:
                return p
        return None

    def current_player(self) -> Optional[Player]:
        if not self.players:
            return None
        return self.players[self.current_player_idx]

    def add_player(self, player_id: str, name: str, is_bot: bool = False, color: Optional[str] = None) -> Optional[Player]:
        for p in self.players:
            if p.id == player_id:
                p.name = name
                if color and color in COLORS and not any(other.color == color for other in self.players if other.id != player_id):
                    p.color = color
                    for idx, piece in enumerate(p.pieces):
                        piece.color = color
                return p

        if len(self.players) >= 4:
            return None

        # Pick first available color
        used_colors = {p.color for p in self.players}
        if color and color in COLORS and color not in used_colors:
            chosen_color = color
        else:
            chosen_color = next((c for c in COLORS if c not in used_colors), None)

        if not chosen_color:
            return None

        player = Player(player_id, name, chosen_color, is_bot)
        self.players.append(player)
        self.log(f"{name} ist beigetreten ({COLOR_META[chosen_color]['name']}).")
        return player

    def remove_player(self, player_id: str):
        self.players = [p for p in self.players if p.id != player_id]
        if self.players and self.host_id == player_id:
            self.host_id = self.players[0].id
        if self.current_player_idx >= len(self.players) and self.players:
            self.current_player_idx = 0

    def start_game(self):
        if len(self.players) < 2:
            raise ValueError("Mindestens 2 Spieler erforderlich!")
        self.status = "PLAYING"
        self.current_player_idx = 0
        self.dice = 0
        self.has_rolled = False
        self.finishers = []
        self._init_turn()
        self.log(f"Spiel gestartet! {self.current_player().name} beginnt.")

    def _init_turn(self):
        curr = self.current_player()
        if not curr:
            return
        self.dice = 0
        self.has_rolled = False
        self.valid_moves = []
        # Standard rule: If player has NO pieces on track (all in base or goal), they get 3 rolls to try for a 6!
        if len(curr.pieces_on_track()) == 0:
            self.rolls_left = 3
        else:
            self.rolls_left = 1

    def roll_dice(self, player_id: str) -> dict:
        curr = self.current_player()
        if not curr or curr.id != player_id or self.status != "PLAYING":
            return {"error": "Nicht dein Zug!"}
        if self.has_rolled and len(self.valid_moves) > 0:
            return {"error": "Bewege zuerst eine Spielfigur!"}
        if self.rolls_left <= 0:
            return {"error": "Keine Würfelwürfe übrig!"}

        val = random.randint(1, 6)
        self.dice = val
        self.has_rolled = True
        self.rolls_left -= 1

        self.log(f"🎲 {curr.name} würfelt eine {val}!")
        self.valid_moves = self._calculate_moves(curr, val)

        # Check if roll allows next roll or auto-skip
        can_roll_again = False
        if val == 6 and not curr.won:
            # Rolling a 6 always grants another roll after moving!
            can_roll_again = True
        elif len(self.valid_moves) == 0 and self.rolls_left > 0:
            # Missed a 6 when allowed 3 rolls
            can_roll_again = True
            self.has_rolled = False  # Reset rolled state to allow clicking roll again
            self.log(f"Noch {self.rolls_left}x Versuche übrig, um eine 6 zu würfeln.")

        auto_end = False
        if len(self.valid_moves) == 0 and self.rolls_left <= 0:
            auto_end = True

        return {
            "dice": val,
            "rolls_left": self.rolls_left,
            "valid_moves": self.valid_moves,
            "can_roll_again": can_roll_again,
            "auto_end": auto_end
        }

    def _calculate_moves(self, player: Player, roll: int) -> List[dict]:
        moves = []
        start_idx = COLOR_META[player.color]["start_pos"]

        # 1. Spawning from Base when rolling a 6
        if roll == 6 and len(player.pieces_in_base()) > 0:
            # Check if start square is blocked by own piece
            piece_on_start = self._piece_at_track_pos(start_idx)
            if not (piece_on_start and piece_on_start.color == player.color):
                # We can move one piece from base onto the start field
                first_base_piece = player.pieces_in_base()[0]
                moves.append({
                    "piece_id": first_base_piece.piece_id,
                    "type": "SPAWN",
                    "from_state": "BASE",
                    "from_pos": -1,
                    "to_state": "TRACK",
                    "to_pos": start_idx,
                    "beats_piece": piece_on_start.to_dict() if piece_on_start else None,
                    "description": f"Figur aus dem Haus auf Startfeld setzen"
                })

        # 2. Moving pieces currently on the track
        for p in player.pieces_on_track():
            new_steps = p.steps_taken + roll
            if new_steps < 40:
                # Still on the common track
                new_track_pos = (p.track_pos + roll) % 40
                dest_piece = self._piece_at_track_pos(new_track_pos)
                if dest_piece and dest_piece.color == player.color:
                    continue  # Cannot land on own piece
                moves.append({
                    "piece_id": p.piece_id,
                    "type": "MOVE_TRACK",
                    "from_state": "TRACK",
                    "from_pos": p.track_pos,
                    "to_state": "TRACK",
                    "to_pos": new_track_pos,
                    "beats_piece": dest_piece.to_dict() if dest_piece else None,
                    "description": f"Figur um {roll} Felder vorrücken" + (f" (schlägt {dest_piece.color}!)" if dest_piece else "")
                })
            elif new_steps <= 43:
                # Entering or advancing into the home goal (a=0, b=1, c=2, d=3)
                goal_target = new_steps - 40
                # Check if target goal house is free
                existing_in_goal = any(x.state == "GOAL" and x.goal_pos == goal_target for x in player.pieces)
                if not existing_in_goal:
                    moves.append({
                        "piece_id": p.piece_id,
                        "type": "ENTER_GOAL",
                        "from_state": "TRACK",
                        "from_pos": p.track_pos,
                        "to_state": "GOAL",
                        "to_pos": goal_target,
                        "beats_piece": None,
                        "description": f"Figur ins Zielfeld {chr(ord('a') + goal_target).upper()} ziehen"
                    })

        # 3. Advancing pieces already in the goal
        for p in player.pieces_in_goal():
            new_goal_pos = p.goal_pos + roll
            if new_goal_pos <= 3:
                existing_in_goal = any(x.state == "GOAL" and x.goal_pos == new_goal_pos for x in player.pieces)
                if not existing_in_goal:
                    moves.append({
                        "piece_id": p.piece_id,
                        "type": "ADVANCE_GOAL",
                        "from_state": "GOAL",
                        "from_pos": p.goal_pos,
                        "to_state": "GOAL",
                        "to_pos": new_goal_pos,
                        "beats_piece": None,
                        "description": f"Figur im Ziel nach Feld {chr(ord('a') + new_goal_pos).upper()} vorziehen"
                    })

        # "Schlagzwang" / Priority: In traditional rules, if a piece can spawn or strike, it is prioritized
        # But we offer all valid legal moves to the player, highlighting beat moves!
        return moves

    def _piece_at_track_pos(self, pos: int) -> Optional[Piece]:
        for pl in self.players:
            for p in pl.pieces:
                if p.state == "TRACK" and p.track_pos == pos:
                    return p
        return None

    def execute_move(self, player_id: str, piece_id: int) -> dict:
        curr = self.current_player()
        if not curr or curr.id != player_id:
            return {"error": "Nicht dein Zug!"}

        move = next((m for m in self.valid_moves if m["piece_id"] == piece_id), None)
        if not move:
            return {"error": "Ungültiger Zug für diese Figur!"}

        piece = next(p for p in curr.pieces if p.piece_id == piece_id)
        beaten_info = None

        if move["type"] == "SPAWN":
            piece.state = "TRACK"
            piece.track_pos = move["to_pos"]
            piece.steps_taken = 0
            if move["beats_piece"]:
                beaten_info = self._send_to_base(move["beats_piece"])

        elif move["type"] == "MOVE_TRACK":
            piece.state = "TRACK"
            piece.track_pos = move["to_pos"]
            piece.steps_taken += self.dice
            if move["beats_piece"]:
                beaten_info = self._send_to_base(move["beats_piece"])

        elif move["type"] == "ENTER_GOAL":
            piece.state = "GOAL"
            piece.goal_pos = move["to_pos"]
            piece.track_pos = -1
            piece.steps_taken += self.dice

        elif move["type"] == "ADVANCE_GOAL":
            piece.state = "GOAL"
            piece.goal_pos = move["to_pos"]

        self.valid_moves = []

        if beaten_info:
            self.log(f"💥 {curr.name} wirft eine Figur von {beaten_info['player_name']}!")
        else:
            self.log(f"{curr.name}: {move['description']}.")

        # Check win condition
        if curr.has_won() and not curr.won:
            curr.won = True
            curr.rank = len(self.finishers) + 1
            self.finishers.append(curr.id)
            self.log(f"🏆 {curr.name} hat alle 4 Figuren im Ziel und belegt Platz {curr.rank}!")
            if not self.winner:
                self.winner = curr.to_dict()

        # Did we roll a 6?
        roll_again = (self.dice == 6 and not curr.won)
        if roll_again:
            self.log(f"🎲 {curr.name} hat eine 6 gewürfelt und darf noch einmal!")
            self.has_rolled = False
            self.dice = 0
            self.rolls_left = 1
        else:
            self.end_turn()

        return {
            "move": move,
            "beaten": beaten_info,
            "roll_again": roll_again,
            "game_over": self.status == "GAME_OVER"
        }

    def _send_to_base(self, beaten_dict: dict) -> dict:
        color = beaten_dict["color"]
        piece_id = beaten_dict["piece_id"]
        owner = next(pl for pl in self.players if pl.color == color)
        p = next(x for x in owner.pieces if x.piece_id == piece_id)
        p.state = "BASE"
        p.track_pos = -1
        p.goal_pos = -1
        p.steps_taken = 0
        return {"player_name": owner.name, "color": color, "piece_id": piece_id}

    def end_turn(self):
        # Check if only 1 active player remains
        active_players = [p for p in self.players if not p.won]
        if len(active_players) <= 1:
            self.status = "GAME_OVER"
            self.log("🏁 Das Spiel ist beendet!")
            return

        # Advance to next non-finished player
        for _ in range(len(self.players)):
            self.current_player_idx = (self.current_player_idx + 1) % len(self.players)
            next_p = self.players[self.current_player_idx]
            if not next_p.won:
                break

        self._init_turn()
        self.log(f"{self.current_player().name} ist am Zug.")

    def auto_bot_turn(self) -> Optional[dict]:
        curr = self.current_player()
        if not curr or not curr.is_bot or self.status != "PLAYING":
            return None

        # Roll if not rolled
        if not self.has_rolled or (len(self.valid_moves) == 0 and self.rolls_left > 0):
            res = self.roll_dice(curr.id)
            if res.get("auto_end"):
                self.end_turn()
                return {"type": "BOT_TURN_ENDED", "dice": self.dice}
            if not self.valid_moves and self.rolls_left > 0:
                # Will roll again
                return {"type": "BOT_ROLLED_AGAIN", "dice": self.dice}

        if self.valid_moves:
            # Pick best move:
            # Priority: 1) Beats an opponent piece, 2) Enters goal, 3) Spawns from base, 4) Move track
            beat_moves = [m for m in self.valid_moves if m.get("beats_piece")]
            spawn_moves = [m for m in self.valid_moves if m["type"] == "SPAWN"]
            goal_moves = [m for m in self.valid_moves if m["type"] in ("ENTER_GOAL", "ADVANCE_GOAL")]

            if beat_moves:
                chosen = beat_moves[0]
            elif spawn_moves:
                chosen = spawn_moves[0]
            elif goal_moves:
                chosen = goal_moves[0]
            else:
                chosen = random.choice(self.valid_moves)

            exec_res = self.execute_move(curr.id, chosen["piece_id"])
            return {"type": "BOT_MOVED", "move": chosen, "result": exec_res}
        else:
            self.end_turn()
            return {"type": "BOT_PASSED", "dice": self.dice}

    def to_dict(self) -> dict:
        return {
            "room_id": self.room_id,
            "host_id": self.host_id,
            "status": self.status,
            "players": [p.to_dict() for p in self.players],
            "current_player_idx": self.current_player_idx,
            "current_player": self.current_player().to_dict() if self.players else None,
            "dice": self.dice,
            "has_rolled": self.has_rolled,
            "rolls_left": self.rolls_left,
            "valid_moves": self.valid_moves,
            "logs": self.logs[-20:],
            "winner": self.winner,
            "finishers": self.finishers,
            "color_meta": COLOR_META,
            "track_pixels": TRACK_PIXELS,
            "goal_pixels": GOAL_PIXELS
        }
