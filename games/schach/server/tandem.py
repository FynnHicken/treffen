"""Tandemschach (Bughouse) für den Spieltisch: zwei Bretter, zwei Teams à zwei, beide Bretter laufen gleichzeitig.

Plätze (layout.TANDEM_SEATS): vorn sitzen 0 = Brett A Weiß und 1 = Brett B Schwarz (Team 1), hinten 2 = A Schwarz und
3 = B Weiß (Team 2). Partner spielen verschiedene Farben.

Alles am Tisch, ohne Rückfragen:
- Wer schlägt, schickt die geschlagene Figur zum Partner – sie landet in dessen Vorrat (Felder vor ihm).
- Einsetzen: eine Figur aus dem eigenen Vorrat greifen und auf ein freies Feld des eigenen Bretts setzen. Das ist
  ein Zug. Bauern nicht auf die erste oder letzte Reihe. Einsetzen darf Schach geben (auch matt).
- Eine umgewandelte Dame, die geschlagen wird, wird wieder zum Bauern.
- Beide Bretter laufen unabhängig: Auf jedem Brett ist abwechselnd Weiß und Schwarz dran, gleichzeitig mit dem
  anderen Brett. Ohne Uhr – wer auf eine Figur wartet, darf warten.
- Ende: Matt auf einem Brett → das Team des Mattgesetzten verliert. Kann auf keinem Brett jemand ziehen (beide warten
  ohne Zug) oder sind 600 Züge gespielt → Remis.

Schachlogik der einzelnen Bretter: chess.py (Perft-geprüft); Einsetzen wird hier ergänzt.
"""
import random
from typing import Dict, List, Optional, Tuple

from chess import VALUE as CP, Move, Position, sq_index, sq_name
from layout import RESERVE_SLOTS, SHORT, TANDEM_SEATS, TANDEM_TEAMS
from tabletop_server.rules import GameRules
from rules import show

KIND_OF = {v: k for k, v in SHORT.items()}
SEAT_SIDE = {seat: side for side, seat in TANDEM_SEATS.items()}       # Platz → (Brett, "w"/"b")
OTHER = {"A": "B", "B": "A"}
DROP_ORDER = ["queen", "rook", "bishop", "knight", "pawn"]
MAX_PLIES = 600

REASONS = {"checkmate": "Schachmatt", "stuck": "niemand kann ziehen", "limit": "600 Züge gespielt"}

Option = Tuple[dict, Optional[Move], Optional[Tuple[int, str]]]          # (Aktion, Brettzug, (Feld, Buchstabe) beim Einsetzen)


class TandemRules(GameRules):
    api_version = 2
    min_players = 4
    shared_view = False             # jeder sieht seine eigenen Züge (zwei Plätze gleichzeitig am Zug)
    conformance_max_steps = MAX_PLIES + 50
    settings_schema = {}

    # ---------- Stellung ↔ Tisch ----------
    @staticmethod
    def _color(pid: str) -> str:
        return pid.split("-")[1]                                           # "A-w-N-g1" → "w"

    def _kind(self, room, pid: str) -> str:
        return room.pieces[pid].get("kind") or room.layout["pieces"][pid]["kind"]

    def _letter(self, room, pid: str) -> str:
        letter = SHORT[self._kind(room, pid)]
        return letter if self._color(pid) == "w" else letter.lower()

    @staticmethod
    def _sq(field: str) -> int:
        return sq_index(field[2:])

    def board_map(self, room, b: str) -> Dict[int, str]:
        prefix = f"{b}-"
        return {self._sq(p["field"]): pid for pid, p in room.pieces.items() if p["field"].startswith(prefix)}

    def position(self, room, b: str) -> Position:
        st = room.game["boards"][b]
        board: List[Optional[str]] = [None] * 64
        for sq, pid in self.board_map(room, b).items():
            board[sq] = self._letter(room, pid)
        ep = sq_index(st["ep"]) if st.get("ep") else None
        return Position(board, st["white"], st["castling"], ep, st["halfmove"], st["fullmove"])

    def reserve(self, room, b: str, c: str) -> List[str]:
        """Figuren im Vorrat (Brett, Farbe), nach Platz im Vorrat sortiert."""
        prefix = f"r-{b}-{c}-"
        found = [(int(p["field"].rsplit("-", 1)[1]), pid) for pid, p in room.pieces.items() if p["field"].startswith(prefix)]
        return [pid for _, pid in sorted(found)]

    def mover(self, room, b: str) -> int:
        return TANDEM_SEATS[(b, "w" if room.game["boards"][b]["white"] else "b")]

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
        room.game = {
            "seats": [0, 1, 2, 3], "teams": TANDEM_TEAMS, "phase": "move", "plies": 0, "result": None, "finished": [],
            "boards": {b: {"white": True, "castling": "KQkq", "ep": None, "halfmove": 0, "fullmove": 1,
                           "check": False, "king": None, "last": None, "stuck": False} for b in "AB"},
            "settings": room.settings(),
        }
        self._refresh(room)
        return events

    def to_move(self, room) -> List[int]:
        g = room.game or {}
        if g.get("phase") != "move":
            return []
        return [self.mover(room, b) for b in "AB" if not g["boards"][b]["stuck"]]

    def options(self, room, b: str) -> List[Option]:
        """Alle erlaubten Aktionen auf Brett b für die Seite am Zug: Züge (Umwandlung zur Dame) und Einsetzen."""
        pos = self.position(room, b)
        bmap = self.board_map(room, b)
        out: List[Option] = []
        for m in pos.legal_moves():
            if m.promo in (None, "Q"):
                out.append(({"type": "move", "piece": bmap[m.frm], "to": f"{b}-{sq_name(m.to)}"}, m, None))
        c = "w" if pos.white else "b"
        seen = set()
        in_check = pos.in_check()
        for pid in self.reserve(room, b, c):
            kind = self._kind(room, pid)
            if kind in seen:
                continue                                   # je Art die vorderste Figur im Vorrat
            seen.add(kind)
            letter = SHORT[kind] if pos.white else SHORT[kind].lower()
            for sq in range(64):
                if pos.board[sq] is not None or (kind == "pawn" and sq // 8 in (0, 7)):
                    continue
                if in_check:
                    nb = pos.board[:]
                    nb[sq] = letter
                    if Position(nb, pos.white, pos.castling, None, pos.halfmove, pos.fullmove).in_check(pos.white):
                        continue
                out.append(({"type": "move", "piece": pid, "to": f"{b}-{sq_name(sq)}", "drop": True}, None, (sq, letter)))
        return out

    def actions(self, room, seat: int) -> List[dict]:
        g = room.game or {}
        if g.get("phase") != "move" or seat not in SEAT_SIDE:
            return []
        b, _ = SEAT_SIDE[seat]
        if self.mover(room, b) != seat:
            return []
        return [a for a, _, _ in self.options(room, b)]

    def apply(self, room, seat: int, action: dict) -> Optional[List[dict]]:
        g = room.game or {}
        if action.get("type") != "move" or g.get("phase") != "move" or seat not in SEAT_SIDE:
            return None
        b, _ = SEAT_SIDE[seat]
        if self.mover(room, b) != seat:
            return None
        piece, to = action.get("piece"), action.get("to")
        opt = next((o for o in self.options(room, b) if o[0]["piece"] == piece and o[0]["to"] == to), None)
        if opt is None:
            return None
        _, move, drop = opt
        st = g["boards"][b]
        pos = self.position(room, b)
        frm_field = room.pieces[piece]["field"]
        events: List[dict] = [{"type": "PIECE_MOVED", "piece": piece, "from": frm_field, "to": to, "path": [to]}]
        if drop:
            events[0]["reason"] = "drop"
            room.pieces[piece] = {**room.pieces[piece], "field": to, "held_by": None}
            board = pos.board[:]
            board[drop[0]] = drop[1]
            nxt = Position(board, not pos.white, pos.castling, None, pos.halfmove + 1,
                           pos.fullmove + (0 if pos.white else 1))
        else:
            bmap = self.board_map(room, b)
            nxt = pos.play(move)
            dst = move.to
            victim_sq = (dst - 8 if pos.white else dst + 8) if move.flag == "ep" else dst
            victim = bmap.get(victim_sq)
            if victim:
                events += self._to_partner(room, b, victim, f"{b}-{sq_name(victim_sq)}")
                events[0]["capture"] = victim
            room.pieces[piece] = {**room.pieces[piece], "field": to, "held_by": None}
            if move.flag in ("K", "Q"):
                frm = move.frm
                rook_from, rook_to = (frm + 3, frm + 1) if move.flag == "K" else (frm - 4, frm - 1)
                rook = bmap[rook_from]
                room.pieces[rook] = {**room.pieces[rook], "field": f"{b}-{sq_name(rook_to)}", "held_by": None}
                events.append({"type": "PIECE_MOVED", "piece": rook, "from": f"{b}-{sq_name(rook_from)}",
                               "to": f"{b}-{sq_name(rook_to)}", "path": [f"{b}-{sq_name(rook_to)}"], "reason": "castle"})
            if move.promo:
                room.pieces[piece]["kind"] = KIND_OF[move.promo]
                events.append({"type": "PIECE_CHANGED", "piece": piece, "kind": KIND_OF[move.promo], "reason": "promotion"})
        st.update(white=nxt.white, castling=nxt.castling, ep=sq_name(nxt.ep) if nxt.ep is not None else None,
                  halfmove=nxt.halfmove, fullmove=nxt.fullmove, last={"from": frm_field, "to": to})
        g["plies"] += 1
        self._refresh(room)
        return events

    def _to_partner(self, room, b: str, victim: str, frm: str) -> List[dict]:
        """Geschlagene Figur in den Vorrat des Partners (anderes Brett, Farbe der Figur). Umgewandelte → Bauer."""
        c = self._color(victim)
        ob = OTHER[b]
        taken = {p["field"] for p in room.pieces.values()}
        slot = next((f"r-{ob}-{c}-{i}" for i in range(RESERVE_SLOTS) if f"r-{ob}-{c}-{i}" not in taken), None)
        events = []
        if room.pieces[victim].get("kind"):
            events.append({"type": "PIECE_CHANGED", "piece": victim, "kind": room.layout["pieces"][victim]["kind"],
                           "by": "rules", "reason": "unpromote"})
        room.pieces[victim] = {"field": slot, "held_by": None}
        events.insert(0, {"type": "PIECE_MOVED", "piece": victim, "from": frm, "to": slot, "by": "rules",
                          "path": [slot], "reason": "captured"})
        return events

    def _refresh(self, room) -> None:
        g = room.game
        loser = None
        for b in "AB":
            st = g["boards"][b]
            pos = self.position(room, b)
            st["check"] = pos.in_check()
            k = pos.king_sq(pos.white)
            st["king"] = f"{b}-{sq_name(k)}" if k is not None else None
            st["stuck"] = not self.options(room, b)
            if st["stuck"] and st["check"] and loser is None:
                loser = self.mover(room, b)
        reason, winners = None, []
        if loser is not None:
            reason = "checkmate"
            winners = next(t for t in TANDEM_TEAMS if loser not in t)
        elif all(g["boards"][b]["stuck"] for b in "AB"):
            reason = "stuck"
        elif g["plies"] >= MAX_PLIES:
            reason = "limit"
        movers = self.to_move(room)
        g["to_move"] = movers
        g["turn"] = movers[0] if movers else None
        if reason:
            g["phase"] = "over"
            g["result"] = {"winners": list(winners), "reason": reason, "text": REASONS[reason]}
            g["finished"] = list(winners) + [s for s in range(4) if s not in winners]
            g["turn"], g["to_move"] = None, []
            room.status = "finished"

    # ---------- Ansicht ----------
    def view(self, room, seat) -> dict:
        g = {k: v for k, v in (room.game or {}).items()}
        if seat is not None and g.get("phase") == "move":
            g["moves"] = [{"piece": a["piece"], "to": a["to"]} for a in self.actions(room, seat)]
        boards = g.get("boards") or {}
        playing = g.get("phase") == "move"
        checked = [b for b in "AB" if playing and boards.get(b, {}).get("check")]
        return show(g, [boards[b].get("last") for b in "AB" if b in boards], [boards[b].get("king") for b in checked],
                    [self.mover(room, b) for b in checked])

    # ---------- Computer ----------
    def bot_action(self, room, seat: int) -> Optional[dict]:
        g = room.game or {}
        if g.get("phase") != "move" or seat not in SEAT_SIDE:
            return None
        b, _ = SEAT_SIDE[seat]
        if self.mover(room, b) != seat:
            return None
        opts = self.options(room, b)
        if not opts:
            return None
        pos = self.position(room, b)
        rng = random.Random()
        # Was der Gegner auf diesem Brett einsetzen könnte (für „ist das matt?“)
        opp = "b" if pos.white else "w"
        opp_kinds = {self._kind(room, pid) for pid in self.reserve(room, b, opp)}
        ek = pos.king_sq(not pos.white)                         # gegnerischer König (Einsetzen in seiner Nähe)

        def score(o: Option) -> float:
            action, move, drop = o
            if drop:
                board = pos.board[:]
                board[drop[0]] = drop[1]
                nxt = Position(board, not pos.white, pos.castling, None, 0, pos.fullmove)
                dst, mover_val, gain = drop[0], CP[drop[1].upper()], 0
            else:
                nxt = pos.play(move)
                dst = move.to
                mover_val = CP[pos.board[move.frm].upper()]
                victim = pos.board[dst]
                gain = CP[victim.upper()] if victim else (100 if move.flag == "ep" else 0)
                if move.promo:
                    gain += 800
            s = gain * 1.1 + rng.random() * 12
            if nxt.attacked(dst, nxt.white):                    # Figur steht danach angegriffen
                s -= mover_val * 0.9
            if nxt.in_check():
                s += 35
                if not self._has_reply(nxt, opp_kinds):
                    s += 100000                                  # matt
            if drop and ek is not None:
                # Einsetzen nah am gegnerischen König greift an, weit weg verschenkt es den Vorrat
                near = max(abs(dst % 8 - ek % 8), abs(dst // 8 - ek // 8))
                s += 18 if near <= 2 else -6
            return s
        return max(opts, key=score)[0]

    @staticmethod
    def _has_reply(pos: Position, kinds) -> bool:
        if pos.legal_moves():
            return True
        for kind in kinds:
            letter = SHORT[kind] if pos.white else SHORT[kind].lower()
            for sq in range(64):
                if pos.board[sq] is None and not (kind == "pawn" and sq // 8 in (0, 7)):
                    nb = pos.board[:]
                    nb[sq] = letter
                    if not Position(nb, pos.white, pos.castling, None, 0, 1).in_check(pos.white):
                        return True
        return False
