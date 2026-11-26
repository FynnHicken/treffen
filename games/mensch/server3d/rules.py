"""Regeln „Mensch ärgere dich nicht“ für den Spieltisch (portiert aus ../server/game_state.py).

Arbeitet direkt auf den Feld-IDs des Layouts: Laufbahn t0…t39, Häuschen h-<farbe>-0…3, Ziel g-<farbe>-0…3.
Platz = Farbe: 0 Gelb (Start t0), 1 Grün (t10), 2 Rot (t20), 3 Schwarz (t30).

Regeln (wie im Prototyp, Hausregel `clear_start` an):
- Wer keine Figur auf der Laufbahn hat, darf bis zu 3× würfeln, um eine 6 zu bekommen.
- 6: Figur aus dem Häuschen aufs Startfeld (nicht auf eigene Figur), danach nochmal würfeln.
- Eigene Figuren kann man nicht schlagen; fremde auf dem Zielfeld werden geschlagen (zurück ins Häuschen).
- Ins Ziel genau ziehen, im Ziel nichts überspringen.
- Startfeld räumen: Solange Figuren im Häuschen sind, muss eine eigene Figur auf dem Startfeld zuerst weg.
- Wer alle 4 im Ziel hat, ist fertig; das Spiel endet, wenn nur noch einer übrig ist.
"""
from typing import Dict, List, Optional

from layout import COLORS, START_INDEX
from tabletop_server.rules import Rules

TRACK_LEN = 40


def seat_color(seat: int) -> str:
    return COLORS[seat]


class MenschRules(Rules):
    settings_schema = {
        "clear_start": {"default": True, "label": "Startfeld muss geräumt werden"},
    }
    min_players = 2

    # ---------- Hilfen ----------
    @staticmethod
    def _kind(field: str) -> str:
        return {"t": "track", "h": "home", "g": "goal"}[field[0]]

    @staticmethod
    def _track_idx(field: str) -> int:
        return int(field[1:])

    @staticmethod
    def _goal_idx(field: str) -> int:
        return int(field.rsplit("-", 1)[1])

    def _pieces_of(self, room, seat: int) -> Dict[str, str]:
        color = seat_color(seat)
        return {pid: p["field"] for pid, p in room.pieces.items() if pid.startswith(f"p-{color}-")}

    def _at(self, room, field: str) -> Optional[str]:
        return next((pid for pid, p in room.pieces.items() if p["field"] == field), None)

    def _steps(self, seat: int, field: str) -> int:
        """Zurückgelegte Felder auf der Laufbahn (0 = Startfeld)."""
        return (self._track_idx(field) - START_INDEX[seat_color(seat)]) % TRACK_LEN

    def _owner_seat(self, pid: str) -> int:
        return COLORS.index(pid.split("-")[1])

    # ---------- Ablauf ----------
    def setup(self, room) -> List[dict]:
        seats = sorted(m.seat for m in room.members.values() if m.seat is not None)
        events = []
        # Alle Figuren ins Häuschen (neue Runde)
        for pid, spec in room.game_def.layout["pieces"].items():
            if room.pieces[pid]["field"] != spec["field"]:
                frm = room.pieces[pid]["field"]
                room.pieces[pid] = {"field": spec["field"], "held_by": None}
                events.append({"type": "PIECE_MOVED", "piece": pid, "from": frm, "to": spec["field"],
                               "by": "rules", "path": [spec["field"]], "reason": "reset"})
        room.game = {"seats": seats, "turn": seats[0], "phase": "roll", "rolls_left": 0, "dice": None,
                     "finished": [], "settings": {k: v["default"] for k, v in self.settings_schema.items()}}
        room.game.update(self._settings_from(room))
        self._init_turn(room)
        return events

    def _settings_from(self, room) -> dict:
        s = {k: v["default"] for k, v in self.settings_schema.items()}
        for k, v in (room.game_settings or {}).items():
            if k in s and isinstance(v, type(s[k])):
                s[k] = v
        return {"settings": s}

    def _init_turn(self, room) -> None:
        g = room.game
        seat = g["turn"]
        on_track = any(self._kind(f) == "track" for f in self._pieces_of(room, seat).values())
        g.update(phase="roll", dice=None, rolls_left=1 if on_track else 3)

    def _end_turn(self, room) -> None:
        g = room.game
        active = [s for s in g["seats"] if s not in g["finished"]]
        if len(active) <= 1:
            g["phase"] = "over"
            g["turn"] = None
            if active:
                g["finished"].append(active[0])   # Letzter Platz
            room.status = "finished"
            return
        i = g["seats"].index(g["turn"])
        for k in range(1, len(g["seats"]) + 1):
            nxt = g["seats"][(i + k) % len(g["seats"])]
            if nxt not in g["finished"]:
                g["turn"] = nxt
                break
        self._init_turn(room)

    def can_roll(self, room, seat: int) -> bool:
        g = room.game or {}
        return g.get("phase") == "roll" and g.get("turn") == seat and g.get("rolls_left", 0) > 0

    def on_roll(self, room, seat: int, values: List[int]) -> List[dict]:
        g = room.game
        r = values[0]
        g["dice"] = r
        g["rolls_left"] -= 1
        if self.moves(room, seat):
            g["phase"] = "move"
        elif r == 6:
            g["rolls_left"] = max(1, g["rolls_left"])     # 6 ohne möglichen Zug: nochmal würfeln
        elif g["rolls_left"] <= 0:
            self._end_turn(room)
        return []

    def moves(self, room, seat: int) -> List[dict]:
        g = room.game or {}
        r = g.get("dice")
        if g.get("turn") != seat or not r:
            return []
        color = seat_color(seat)
        mine = self._pieces_of(room, seat)
        start = f"t{START_INDEX[color]}"
        moves: List[dict] = []
        in_home = [pid for pid, f in mine.items() if self._kind(f) == "home"]
        goal_taken = {self._goal_idx(f) for f in mine.values() if self._kind(f) == "goal"}

        if r == 6 and in_home:
            occupant = self._at(room, start)
            if not (occupant and occupant in mine):
                for pid in in_home:
                    moves.append({"piece": pid, "to": start, "path": [start], "capture": occupant, "type": "spawn"})

        for pid, f in mine.items():
            kind = self._kind(f)
            if kind == "track":
                steps = self._steps(seat, f) + r
                idx = self._track_idx(f)
                if steps < TRACK_LEN:
                    to = f"t{(idx + r) % TRACK_LEN}"
                    occupant = self._at(room, to)
                    if occupant and occupant in mine:
                        continue
                    path = [f"t{(idx + s) % TRACK_LEN}" for s in range(1, r + 1)]
                    moves.append({"piece": pid, "to": to, "path": path, "capture": occupant, "type": "track"})
                elif steps <= TRACK_LEN + 3:
                    goal = steps - TRACK_LEN
                    if any(k in goal_taken for k in range(0, goal + 1)):
                        continue
                    track_left = TRACK_LEN - 1 - self._steps(seat, f)
                    path = [f"t{(idx + s) % TRACK_LEN}" for s in range(1, track_left + 1)]
                    path += [f"g-{color}-{k}" for k in range(0, goal + 1)]
                    moves.append({"piece": pid, "to": f"g-{color}-{goal}", "path": path, "capture": None, "type": "enter_goal"})
            elif kind == "goal":
                k0 = self._goal_idx(f)
                k1 = k0 + r
                if k1 <= 3 and not any(k in goal_taken for k in range(k0 + 1, k1 + 1)):
                    moves.append({"piece": pid, "to": f"g-{color}-{k1}",
                                  "path": [f"g-{color}-{k}" for k in range(k0 + 1, k1 + 1)], "capture": None, "type": "goal"})

        if g.get("settings", {}).get("clear_start", True) and in_home:
            on_start = self._at(room, start)
            if on_start and on_start in mine:
                forced = [m for m in moves if m["piece"] == on_start]
                if forced:
                    return forced
        return moves

    def move(self, room, seat: int, piece: str, to: str) -> Optional[List[dict]]:
        g = room.game or {}
        if g.get("phase") != "move" or g.get("turn") != seat:
            return None
        m = next((x for x in self.moves(room, seat) if x["piece"] == piece and x["to"] == to), None)
        if m is None:
            return None
        events = []
        if m["capture"]:
            victim = m["capture"]
            vcolor = victim.split("-")[1]
            home = next(f"h-{vcolor}-{k}" for k in range(4) if self._at(room, f"h-{vcolor}-{k}") is None)
            frm = room.pieces[victim]["field"]
            room.pieces[victim] = {"field": home, "held_by": None}
            events.append({"type": "PIECE_MOVED", "piece": victim, "from": frm, "to": home, "by": "rules",
                           "path": [home], "reason": "captured"})
        frm = room.pieces[piece]["field"]
        room.pieces[piece] = {"field": to, "held_by": None}
        # Der Zug selbst zuerst (Animation), danach die geschlagene Figur
        events.insert(0, {"type": "PIECE_MOVED", "piece": piece, "from": frm, "to": to, "path": m["path"],
                          "capture": m["capture"]})

        mine = self._pieces_of(room, seat)
        if all(self._kind(f) == "goal" for f in mine.values()) and seat not in g["finished"]:
            g["finished"].append(seat)
        if g["dice"] == 6 and seat not in g["finished"]:
            g.update(phase="roll", dice=None, rolls_left=1)
        else:
            self._end_turn(room)
        return events

    def wants_roll(self, room, seat: int) -> bool:
        return self.can_roll(room, seat)

    # ---------- Computer ----------
    def _threatened(self, room, field: str, seat: int) -> bool:
        idx = self._track_idx(field)
        for d in range(1, 7):
            pid = self._at(room, f"t{(idx - d) % TRACK_LEN}")
            if pid and self._owner_seat(pid) != seat:
                return True
        return False

    def bot_move(self, room, seat: int) -> Optional[dict]:
        ms = self.moves(room, seat)
        if not ms:
            return None
        color = seat_color(seat)
        start = f"t{START_INDEX[color]}"
        in_home = any(self._kind(f) == "home" for f in self._pieces_of(room, seat).values())

        def score(m: dict) -> float:
            s = 0.0
            frm = room.pieces[m["piece"]]["field"]
            if m["capture"]:
                vf = room.pieces[m["capture"]]["field"]
                s += 120 + self._steps(self._owner_seat(m["capture"]), vf) * 1.2
            if m["type"] == "enter_goal":
                s += 95 + self._goal_idx(m["to"]) * 10
            elif m["type"] == "goal":
                s += 60 + self._goal_idx(m["to"]) * 8
            elif m["type"] == "spawn":
                s += 90
            elif m["type"] == "track":
                if frm == start and in_home:
                    s += 70
                if self._threatened(room, frm, seat):
                    s += 42
                if self._threatened(room, m["to"], seat):
                    s -= 28
                s += self._steps(seat, frm) * 0.6
            return s
        return max(ms, key=score)

    def public(self, room) -> dict:
        g = dict(room.game or {})
        if g.get("phase") == "move" and g.get("turn") is not None:
            g["moves"] = [{"piece": m["piece"], "to": m["to"]} for m in self.moves(room, g["turn"])]
        return g
