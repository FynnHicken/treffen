"""Vierschach für den Spieltisch: Kreuzbrett 14×14 (ohne die 3×3-Ecken), vier Heere, reihum im Uhrzeigersinn.

Plätze: 0 Rot (vorn), 1 Blau (links), 2 Gelb (hinten), 3 Grün (rechts). Spielart (Hausregel `mode`):
- „Zwei gegen zwei“ (Standard, die alte Form des Vierschachs): Partner sitzen sich gegenüber (Rot+Gelb gegen
  Blau+Grün), schlagen sich nicht gegenseitig. Wird einer matt gesetzt, verliert sein Team.
- „Jeder gegen jeden“: Wer matt oder patt ist, scheidet aus, seine Figuren verlassen das Brett. Der Letzte gewinnt.

Regeln wie Schach mit diesen Vereinfachungen (alles am Tisch, ohne Rückfragen):
- Bauern ziehen in ihre Blickrichtung (Doppelschritt vom Start), schlagen schräg nach vorn und werden auf der
  8. Reihe von ihrer Seite aus (der Mitte des Bretts) automatisch zur Dame. Kein en passant.
- Rochade: König zwei Felder Richtung eines unbewegten Turms, der Turm springt über.
- Könige werden nie geschlagen; wer im Schach steht, muss es auflösen. Am Zug ohne erlaubten Zug: matt (im Schach) bzw. patt.
- Geschlagene Figuren legt der Schlagende in seine Ecke rechts vorn und bekommt Punkte (Bauer 1, Springer/Läufer 3,
  Turm 5, Dame 9, umgewandelte Dame 1). 50 Runden ohne Schlagen oder Bauernzug → Ende, mehr Punkte gewinnen.
"""
import random
from typing import Dict, List, Optional, Tuple

from layout import V_COLORS, V_FORWARD, V_NAMES, V_TRAY, VALUE, v_name, v_valid, v_xy
from tabletop_server.rules import GameRules
from rules import show

KNIGHT = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
KING = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
DIAG = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
ORTHO = [(1, 0), (-1, 0), (0, 1), (0, -1)]
QUIET_ROUNDS = 50
MAX_PLIES = 1200
REASONS = {"checkmate": "Schachmatt", "last": "als Letzter übrig", "points": "Punkte nach 50 ruhigen Runden",
           "stalemate": "niemand kann mehr ziehen", "limit": "Zuglimit – Punkte entscheiden"}

Sq = Tuple[int, int]
Piece = Tuple[str, int, str]          # (Figuren-ID, Platz, Art)


def _pawn_start(seat: int, x: int, y: int) -> bool:
    return (y == 1, x == 1, y == 12, x == 12)[seat]


def _promo_line(seat: int, x: int, y: int) -> bool:
    return (y == 7, x == 7, y == 6, x == 6)[seat]


class VierRules(GameRules):
    api_version = 2
    min_players = 4
    shared_view = True
    conformance_max_steps = MAX_PLIES + 50
    settings_schema = {
        "mode": {"default": "team", "label": "Spielart", "choices": ["team", "ffa"],
                 "labels": {"team": "Zwei gegen zwei (Partner gegenüber)", "ffa": "Jeder gegen jeden"},
                 "hint": "Zwei gegen zwei: Wer matt ist, verliert mit dem Partner. Jeder gegen jeden: Wer matt ist, "
                         "scheidet aus, der Letzte gewinnt."},
    }

    # ---------- Stellung ----------
    def _kind(self, room, pid: str) -> str:
        return room.pieces[pid].get("kind") or room.layout["pieces"][pid]["kind"]

    def board(self, room) -> Dict[Sq, Piece]:
        out = {}
        for pid, p in room.pieces.items():
            f = p["field"]
            if not f.startswith("x-"):
                out[v_xy(f)] = (pid, room.layout["pieces"][pid]["seat"], self._kind(room, pid))
        return out

    @staticmethod
    def enemies(g: dict, seat: int) -> List[int]:
        alive = g["alive"]
        if g["mode"] == "team":
            return [s for s in alive if s % 2 != seat % 2]
        return [s for s in alive if s != seat]

    @staticmethod
    def attacked(board: Dict[Sq, Piece], sq: Sq, by: List[int]) -> bool:
        if not by:
            return False
        x0, y0 = sq
        for t in by:
            fx, fy = V_FORWARD[t]
            px, py = fy, fx
            for s in (1, -1):
                p = board.get((x0 - fx + s * px, y0 - fy + s * py))
                if p and p[1] == t and p[2] == "pawn":
                    return True
        for dx, dy in KNIGHT:
            p = board.get((x0 + dx, y0 + dy))
            if p and p[2] == "knight" and p[1] in by:
                return True
        for dx, dy in KING:
            p = board.get((x0 + dx, y0 + dy))
            if p and p[2] == "king" and p[1] in by:
                return True
        for dirs, kinds in ((DIAG, ("bishop", "queen")), (ORTHO, ("rook", "queen"))):
            for dx, dy in dirs:
                x, y = x0 + dx, y0 + dy
                while v_valid(x, y):
                    p = board.get((x, y))
                    if p:
                        if p[2] in kinds and p[1] in by:
                            return True
                        break
                    x += dx
                    y += dy
        return False

    @staticmethod
    def king_sq(board: Dict[Sq, Piece], seat: int) -> Optional[Sq]:
        return next((sq for sq, p in board.items() if p[1] == seat and p[2] == "king"), None)

    def pseudo(self, g: dict, board: Dict[Sq, Piece], seat: int) -> List[tuple]:
        """Züge (von, nach, Zusatz): Zusatz None, "promo" oder ("castle", Turm von, Turm nach)."""
        out = []
        friends = {seat} | ({(seat + 2) % 4} if g["mode"] == "team" else set())

        def target(sq):            # None = leer, True = schlagbar, False = gesperrt
            p = board.get(sq)
            if p is None:
                return None
            return p[1] not in friends and p[2] != "king"
        moved = set(g.get("moved", []))
        for (x, y), (pid, s, kind) in board.items():
            if s != seat:
                continue
            if kind == "pawn":
                fx, fy = V_FORWARD[seat]
                px, py = fy, fx
                one = (x + fx, y + fy)
                if v_valid(*one) and board.get(one) is None:
                    out.append(((x, y), one, "promo" if _promo_line(seat, *one) else None))
                    two = (x + 2 * fx, y + 2 * fy)
                    if _pawn_start(seat, x, y) and v_valid(*two) and board.get(two) is None:
                        out.append(((x, y), two, None))
                for sgn in (1, -1):
                    c = (x + fx + sgn * px, y + fy + sgn * py)
                    if v_valid(*c) and target(c) is True:
                        out.append(((x, y), c, "promo" if _promo_line(seat, *c) else None))
            elif kind in ("knight", "king"):
                for dx, dy in (KNIGHT if kind == "knight" else KING):
                    t = (x + dx, y + dy)
                    if v_valid(*t) and target(t) is not False:
                        out.append(((x, y), t, None))
                if kind == "king" and pid not in moved:
                    out += self._castles(g, board, seat, (x, y), moved)
            else:
                dirs = DIAG if kind == "bishop" else ORTHO if kind == "rook" else DIAG + ORTHO
                for dx, dy in dirs:
                    t = (x + dx, y + dy)
                    while v_valid(*t):
                        r = target(t)
                        if r is not False:
                            out.append(((x, y), t, None))
                        if r is not None:
                            break
                        t = (t[0] + dx, t[1] + dy)
        return out

    def _castles(self, g, board, seat, k: Sq, moved) -> List[tuple]:
        by = self.enemies(g, seat)
        if self.attacked(board, k, by):
            return []
        fx, fy = V_FORWARD[seat]
        out = []
        for dx, dy in ((fy, -fx), (-fy, fx)):            # rechts und links aus Sicht des Spielers
            x, y, d = k[0] + dx, k[1] + dy, 1
            while v_valid(x, y) and board.get((x, y)) is None:
                x, y, d = x + dx, y + dy, d + 1
            p = board.get((x, y))
            if not p or p[1] != seat or p[2] != "rook" or p[0] in moved or d < 3:
                continue
            step1, step2 = (k[0] + dx, k[1] + dy), (k[0] + 2 * dx, k[1] + 2 * dy)
            if self.attacked(board, step1, by) or self.attacked(board, step2, by):
                continue
            out.append((k, step2, ("castle", (x, y), step1)))
        return out

    @staticmethod
    def _after(board: Dict[Sq, Piece], mv: tuple) -> Dict[Sq, Piece]:
        frm, to, extra = mv
        nb = dict(board)
        pid, s, kind = nb.pop(frm)
        nb[to] = (pid, s, "queen" if extra == "promo" else kind)
        if isinstance(extra, tuple):
            rook = nb.pop(extra[1])
            nb[extra[2]] = rook
        return nb

    def legal(self, g: dict, board: Dict[Sq, Piece], seat: int) -> List[tuple]:
        by = self.enemies(g, seat)
        out = []
        for mv in self.pseudo(g, board, seat):
            nb = self._after(board, mv)
            k = self.king_sq(nb, seat)
            if k is None or not self.attacked(nb, k, by):
                out.append(mv)
        return out

    # ---------- Ablauf ----------
    def setup(self, room) -> List[dict]:
        events = []
        for pid, spec in room.layout["pieces"].items():
            cur = room.pieces[pid]
            if cur.get("kind"):
                events.append({"type": "PIECE_CHANGED", "piece": pid, "kind": spec["kind"], "by": "rules"})
            if cur["field"] != spec["field"]:
                events.append({"type": "PIECE_MOVED", "piece": pid, "from": cur["field"], "to": spec["field"],
                               "by": "rules", "path": [spec["field"]], "reason": "reset"})
            room.pieces[pid] = {"field": spec["field"], "held_by": None}
        mode = room.settings().get("mode", "team")
        room.game = {"seats": [0, 1, 2, 3], "turn": 0, "phase": "move", "mode": "ffa" if mode == "ffa" else "team",
                     "alive": [0, 1, 2, 3], "out": [], "points": [0, 0, 0, 0], "quiet": 0, "plies": 0, "moved": [],
                     "checks": [], "last": None, "result": None, "finished": [], "settings": room.settings(),
                     "names": [V_NAMES[c] for c in V_COLORS]}
        return events

    def actions(self, room, seat: int) -> List[dict]:
        g = room.game or {}
        if g.get("phase") != "move" or g.get("turn") != seat:
            return []
        board = self.board(room)
        return [{"type": "move", "piece": board[frm][0], "to": v_name(*to)} for frm, to, _ in self.legal(g, board, seat)]

    def apply(self, room, seat: int, action: dict) -> Optional[List[dict]]:
        g = room.game or {}
        if action.get("type") != "move" or g.get("phase") != "move" or g.get("turn") != seat:
            return None
        piece, to = action.get("piece"), action.get("to")
        if not isinstance(piece, str) or not isinstance(to, str) or piece not in room.pieces:
            return None
        board = self.board(room)
        frm_field = room.pieces[piece]["field"]
        if frm_field.startswith("x-") or to not in room.layout["fields"] or to.startswith("x-"):
            return None
        frm, dst = v_xy(frm_field), v_xy(to)
        mv = next((m for m in self.legal(g, board, seat) if m[0] == frm and m[1] == dst), None)
        if mv is None:
            return None
        events: List[dict] = [{"type": "PIECE_MOVED", "piece": piece, "from": frm_field, "to": to, "path": [to]}]
        victim = board.get(dst)
        if victim:
            vpid, vseat, vkind = victim
            promoted = bool(room.pieces[vpid].get("kind"))
            g["points"][seat] += 1 if promoted else VALUE[vkind]
            slot = self._tray_slot(room, seat)
            room.pieces[vpid] = {**room.pieces[vpid], "field": slot, "held_by": None}
            events.append({"type": "PIECE_MOVED", "piece": vpid, "from": to, "to": slot, "by": "rules",
                           "path": [slot], "reason": "captured"})
            events[0]["capture"] = vpid
        room.pieces[piece] = {**room.pieces[piece], "field": to, "held_by": None}
        if isinstance(mv[2], tuple):
            rook = board[mv[2][1]][0]
            rto = v_name(*mv[2][2])
            events.append({"type": "PIECE_MOVED", "piece": rook, "from": v_name(*mv[2][1]), "to": rto, "path": [rto],
                           "reason": "castle"})
            room.pieces[rook] = {**room.pieces[rook], "field": rto, "held_by": None}
            g["moved"].append(rook)
        if mv[2] == "promo":
            room.pieces[piece]["kind"] = "queen"
            events.append({"type": "PIECE_CHANGED", "piece": piece, "kind": "queen", "reason": "promotion"})
        if piece not in g["moved"]:
            g["moved"].append(piece)
        pawn_move = board[frm][2] == "pawn"
        g["quiet"] = 0 if (victim or pawn_move) else g["quiet"] + 1
        g["plies"] += 1
        g["last"] = {"from": frm_field, "to": to}
        events += self._advance(room, seat)
        return events

    def _tray_slot(self, room, seat: int) -> str:
        taken = {p["field"] for p in room.pieces.values()}
        for corner in [seat] + [c for c in range(4) if c != seat]:
            for i in range(V_TRAY * V_TRAY):
                f = f"x-{corner}-{i}"
                if f not in taken:
                    return f
        raise ValueError("Ablagen voll")

    def _advance(self, room, seat: int) -> List[dict]:
        """Nächster Spieler im Uhrzeigersinn; matt/patt auswerten, ggf. ausscheiden oder Ende."""
        g = room.game
        events: List[dict] = []
        skipped = 0
        cur = seat
        while True:
            alive = g["alive"]
            if g["quiet"] >= QUIET_ROUNDS * len(alive) or g["plies"] >= MAX_PLIES:
                self._finish(room, "points" if g["plies"] < MAX_PLIES else "limit", self._leaders(g))
                return events
            nxt = next(s for s in [(cur + k) % 4 for k in range(1, 5)] if s in alive)
            board = self.board(room)
            if self.legal(g, board, nxt):
                g["turn"] = nxt
                break
            k = self.king_sq(board, nxt)
            mated = k is not None and self.attacked(board, k, self.enemies(g, nxt))
            if g["mode"] == "team":
                if mated:
                    self._finish(room, "checkmate", [s for s in g["seats"] if s % 2 != nxt % 2])
                    return events
                skipped += 1                       # patt: setzt aus
                cur = nxt
                if skipped >= len(alive):
                    self._finish(room, "stalemate", [])
                    return events
                continue
            # Jeder gegen jeden: matt oder patt → scheidet aus, Figuren verlassen das Brett
            g["alive"] = [s for s in alive if s != nxt]
            g["out"].append(nxt)
            for pid, p in list(room.pieces.items()):
                if room.layout["pieces"][pid]["seat"] == nxt and not p["field"].startswith("x-"):
                    slot = self._tray_slot(room, nxt)
                    events.append({"type": "PIECE_MOVED", "piece": pid, "from": p["field"], "to": slot, "by": "rules",
                                   "path": [slot], "reason": "eliminated"})
                    room.pieces[pid] = {**p, "field": slot, "held_by": None}
            if len(g["alive"]) == 1:
                self._finish(room, "last", list(g["alive"]))
                return events
            cur = nxt
        self._checks(room)
        return events

    def _leaders(self, g: dict) -> List[int]:
        pts = g["points"]
        if g["mode"] == "team":
            a, b = pts[0] + pts[2], pts[1] + pts[3]
            return [] if a == b else ([0, 2] if a > b else [1, 3])
        alive = g["alive"]
        best = max(pts[s] for s in alive)
        top = [s for s in alive if pts[s] == best]
        return top if len(top) == 1 else []

    def _finish(self, room, reason: str, winners: List[int]) -> None:
        g = room.game
        g["phase"] = "over"
        g["turn"] = None
        g["checks"] = []
        g["result"] = {"winners": winners, "reason": reason, "text": REASONS[reason]}
        rest = sorted((s for s in g["seats"] if s not in winners and s not in g["out"]), key=lambda s: -g["points"][s])
        g["finished"] = winners + rest + list(reversed(g["out"]))
        room.status = "finished"

    def _checks(self, room) -> None:
        g = room.game
        board = self.board(room)
        out = []
        for s in g["alive"]:
            k = self.king_sq(board, s)
            if k and self.attacked(board, k, self.enemies(g, s)):
                out.append(v_name(*k))
        g["checks"] = out

    # ---------- Ansicht ----------
    def view(self, room, seat) -> dict:
        g = {k: v for k, v in (room.game or {}).items() if k != "moved"}
        if g.get("phase") == "move" and g.get("turn") is not None:
            g["moves"] = [{"piece": a["piece"], "to": a["to"]} for a in self.actions(room, g["turn"])]
        checks = list(g.get("checks") or []) if g.get("phase") == "move" else []
        board = self.board(room) if checks else {}
        in_check = [s for s in range(4) if (k := self.king_sq(board, s)) is not None and v_name(*k) in checks]
        if isinstance(g.get("points"), list):
            g["scores"] = list(g["points"])
        return show(g, [g.get("last")], checks, in_check)

    # ---------- Computer ----------
    def bot_action(self, room, seat: int) -> Optional[dict]:
        g = room.game or {}
        if g.get("phase") != "move" or g.get("turn") != seat:
            return None
        board = self.board(room)
        moves = self.legal(g, board, seat)
        if not moves:
            return None
        by = self.enemies(g, seat)
        rng = random.Random()

        def score(mv) -> float:
            frm, to, extra = mv
            mover = board[frm]
            victim = board.get(to)
            s = rng.random() * 0.6
            if victim:
                s += VALUE[victim[2]] * 1.1
            if extra == "promo":
                s += 8
            nb = self._after(board, mv)
            if self.attacked(nb, to, by):
                s -= VALUE[nb[to][2]] * 0.9
            elif self.attacked(board, frm, by) and mover[2] != "pawn":
                s += VALUE[mover[2]] * 0.5               # bedrohte Figur in Sicherheit bringen
            for e in by:
                k = self.king_sq(nb, e)
                if k and self.attacked(nb, k, [seat]):
                    s += 0.4                             # Schach geben
            if mover[2] == "pawn":
                s += 0.15
            if isinstance(extra, tuple):
                s += 0.5
            return s
        frm, to, _ = max(moves, key=score)
        return {"type": "move", "piece": board[frm][0], "to": v_name(*to)}

