"""Schach-Regeln für den Spieltisch (Regel-API 2, siehe packages/tabletop-server/tabletop_server/rules.py).

Alles läuft über das Anfassen der Figuren – keine Rückfragen:
- Ziehen: Figur greifen und auf ein erlaubtes Feld setzen (oder antippen, dann Zielfeld antippen).
- Schlagen: auf das Feld der fremden Figur setzen – sie wandert rechts neben das Brett des Schlagenden.
- Rochade: den König zwei Felder Richtung Turm setzen, der Turm springt von selbst über.
- En passant: Bauer schräg hinter den gegnerischen Bauern setzen.
- Umwandlung: Bauer auf die letzte Reihe setzen → wird zur Dame (häufigste Wahl, ohne Nachfrage).
- Ende: Schachmatt, Patt, dreifache Wiederholung, 50-Züge-Regel, zu wenig Material.

Teamschach (SchachRules(team=True), 4 Plätze): Weiß = Plätze 0 und 1 (sitzen nebeneinander vorn), Schwarz = 2 und 3.
Gezogen wird reihum Weiß 1 → Schwarz 1 → Weiß 2 → Schwarz 2 …; jeder bewegt die Figuren seiner Farbe. Wer matt setzt,
gewinnt mit seinem Partner.

Die eigentliche Schachlogik steht in chess.py (geprüft mit Perft-Zahlen); hier wird sie auf Figuren-IDs und
Felder des Tisches abgebildet.
"""
import os
import random
from typing import Dict, List, Optional

from chess import Move, Position, best_move, sq_index, sq_name
from layout import COLORS, SHORT
from tabletop_server.rules import GameRules
from stockfish_uci import engine

KIND_OF = {v: k for k, v in SHORT.items()}      # "Q" → "queen"
# Stärke des Computers (Hausregel bot_level). Stockfish: Bedenkzeit (ms), Elo-Grenze bzw. „Skill Level“.
STOCKFISH_LEVELS = {
    1: {"movetime_ms": 80, "skill": 0},          # Anfänger: macht echte Fehler
    2: {"movetime_ms": 300, "elo": 1500},        # Gelegenheitsspieler
    3: {"movetime_ms": 400, "elo": 1900},        # Vereinsspieler
    4: {"movetime_ms": 600, "elo": 2400},        # Meister
    5: {"movetime_ms": 1000},                    # volle Stärke
}
# Ersatz ohne Stockfish (eingebauter Python-Computer): Suchtiefe, Zeit (s), Spielraum in Hundertstel-Bauern
LEVELS = {
    1: (1, 0.5, 140),
    2: (2, 1.0, 25),
    3: (4, 2.5, 6),
}
LEVELS[4] = LEVELS[5] = LEVELS[3]

REASONS = {
    "checkmate": "Schachmatt",
    "stalemate": "Patt",
    "repetition": "dreifache Wiederholung",
    "fifty": "50-Züge-Regel",
    "material": "zu wenig Material",
}


class SchachRules(GameRules):
    api_version = 2
    min_players = 2
    shared_view = True          # kein Geheimwissen: alle sehen dasselbe (eine Berechnung für alle)

    def __init__(self, team: bool = False):
        self.team = team
        if team:
            self.min_players = 4
            self.order = [0, 2, 1, 3]                       # Weiß 1, Schwarz 1, Weiß 2, Schwarz 2
            self.color_of = {0: "w", 1: "w", 2: "b", 3: "b"}
        else:
            self.order = [0, 1]
            self.color_of = {0: "w", 1: "b"}

    def seats_of(self, color: str) -> List[int]:
        return [s for s in self.order if self.color_of[s] == color]
    conformance_settings = {"bot_level": 1}   # Pflicht-Prüfung: schneller Computer
    settings_schema = {
        "bot_level": {"default": 2, "label": "Stärke des Computers", "min": 1, "max": 5,
                      "hint": "1 Anfänger · 2 Gelegenheitsspieler · 3 Vereinsspieler · 4 Meister · 5 volle Stärke (Stockfish)"},
    }

    # ---------- Stellung ↔ Tisch ----------
    def _kind(self, room, pid: str) -> str:
        return room.pieces[pid].get("kind") or room.layout["pieces"][pid]["kind"]

    def _board_map(self, room) -> Dict[int, str]:
        """Feld-Index → Figuren-ID (nur Figuren auf dem Brett)."""
        out = {}
        for pid, p in room.pieces.items():
            f = p["field"]
            if len(f) == 2:
                out[sq_index(f)] = pid
        return out

    def position(self, room) -> Position:
        g = room.game
        board: List[Optional[str]] = [None] * 64
        for sq, pid in self._board_map(room).items():
            letter = SHORT[self._kind(room, pid)]
            board[sq] = letter if pid.startswith("w-") else letter.lower()
        ep = sq_index(g["ep"]) if g.get("ep") else None
        white = self.color_of.get(g["turn"], "w") == "w" if g.get("turn") is not None else g.get("white", True)
        return Position(board, white, g.get("castling", ""), ep, g.get("halfmove", 0), g.get("fullmove", 1))

    def _legal(self, room) -> List[Move]:
        """Erlaubte Züge am Tisch (Umwandlung nur zur Dame – ohne Rückfrage)."""
        return [m for m in self.position(room).legal_moves() if m.promo in (None, "Q")]

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
        room.game = {"seats": list(self.order), "turn": self.order[0], "white": True, "phase": "move",
                     "castling": "KQkq", "ep": None,
                     "halfmove": 0, "fullmove": 1, "check": False, "last": None, "result": None,
                     "finished": [], "settings": room.settings()}
        room.game["history"] = [self.position(room).key()]
        self._refresh(room)
        return events

    def actions(self, room, seat: int) -> List[dict]:
        g = room.game or {}
        if g.get("phase") != "move" or g.get("turn") != seat:
            return []
        bmap = self._board_map(room)
        return [{"type": "move", "piece": bmap[m.frm], "to": sq_name(m.to)} for m in self._legal(room)]

    def apply(self, room, seat: int, action: dict) -> Optional[List[dict]]:
        g = room.game or {}
        if action.get("type") != "move" or g.get("phase") != "move" or g.get("turn") != seat:
            return None
        piece, to = action.get("piece"), action.get("to")
        if not isinstance(piece, str) or not isinstance(to, str) or piece not in room.pieces:
            return None
        bmap = self._board_map(room)
        frm_field = room.pieces[piece]["field"]
        if len(frm_field) != 2 or len(to) != 2:
            return None
        frm, dst = sq_index(frm_field), sq_index(to)
        move = next((m for m in self._legal(room) if m.frm == frm and m.to == dst), None)
        if move is None:
            return None
        pos = self.position(room)
        nxt = pos.play(move)

        events: List[dict] = [{"type": "PIECE_MOVED", "piece": piece, "from": frm_field, "to": to, "path": [to]}]
        victim_sq = (dst - 8 if pos.white else dst + 8) if move.flag == "ep" else dst
        victim = bmap.get(victim_sq)
        if victim:
            vcolor = victim[0]
            taken = {p["field"] for p in room.pieces.values()}
            slot = next(f"x-{vcolor}-{i}" for i in range(16) if f"x-{vcolor}-{i}" not in taken)
            room.pieces[victim] = {**room.pieces[victim], "field": slot, "held_by": None}
            events.append({"type": "PIECE_MOVED", "piece": victim, "from": sq_name(victim_sq), "to": slot,
                           "by": "rules", "path": [slot], "reason": "captured"})
            events[0]["capture"] = victim
        room.pieces[piece] = {**room.pieces[piece], "field": to, "held_by": None}
        if move.flag in ("K", "Q"):
            rook_from, rook_to = (frm + 3, frm + 1) if move.flag == "K" else (frm - 4, frm - 1)
            rook = bmap[rook_from]
            room.pieces[rook] = {**room.pieces[rook], "field": sq_name(rook_to), "held_by": None}
            events.append({"type": "PIECE_MOVED", "piece": rook, "from": sq_name(rook_from), "to": sq_name(rook_to),
                           "path": [sq_name(rook_to)], "reason": "castle"})
        if move.promo:
            kind = KIND_OF[move.promo]
            room.pieces[piece]["kind"] = kind
            events.append({"type": "PIECE_CHANGED", "piece": piece, "kind": kind, "reason": "promotion"})

        nxt_seat = self.order[(self.order.index(seat) + 1) % len(self.order)]
        g.update(turn=nxt_seat, white=nxt.white, castling=nxt.castling, ep=sq_name(nxt.ep) if nxt.ep is not None else None,
                 halfmove=nxt.halfmove, fullmove=nxt.fullmove, last={"from": frm_field, "to": to})
        g["history"] = (g.get("history") or []) + [nxt.key()]
        self._refresh(room)
        return events

    def _refresh(self, room) -> None:
        """Schach/Ende aus der aktuellen Stellung bestimmen."""
        g = room.game
        pos = self.position(room)
        g["check"] = pos.in_check()
        k = pos.king_sq(pos.white)
        g["king"] = sq_name(k) if k is not None else None
        reason = None
        winners: List[int] = []
        if not pos.legal_moves():
            if g["check"]:
                reason, winners = "checkmate", self.seats_of("b" if pos.white else "w")
            else:
                reason = "stalemate"
        elif pos.insufficient_material():
            reason = "material"
        elif pos.halfmove >= 100:
            reason = "fifty"
        elif g["history"].count(pos.key()) >= 3:
            reason = "repetition"
        if reason:
            g["phase"] = "over"
            g["result"] = {"winners": winners, "reason": reason, "text": REASONS[reason]}
            g["finished"] = winners + [s for s in self.order if s not in winners]
            g["turn"] = None
            room.status = "finished"

    # ---------- Ansicht ----------
    def view(self, room, seat) -> dict:
        g = {k: v for k, v in (room.game or {}).items() if k != "history"}
        if g.get("phase") == "move" and g.get("turn") is not None:
            g["moves"] = [{"piece": a["piece"], "to": a["to"]} for a in self.actions(room, g["turn"])]
        return g

    # ---------- Computer ----------
    def bot_action(self, room, seat: int) -> Optional[dict]:
        g = room.game or {}
        if g.get("phase") != "move" or g.get("turn") != seat:
            return None
        level = int(g.get("settings", {}).get("bot_level", 2))
        pos = self.position(room)
        legal = self._legal(room)
        m = self._stockfish_move(pos, level, legal)
        if m is None:      # kein Stockfish (oder Fehler) → eingebauter Computer
            depth, budget, tolerance = LEVELS.get(level, LEVELS[2])
            m = best_move(pos, depth, budget, random.Random(), tuple(g.get("history") or ()), tolerance)
        if m is None:
            return None
        if m.promo and m.promo != "Q":
            m = Move(m.frm, m.to, "Q", m.flag)
        return {"type": "move", "piece": self._board_map(room)[m.frm], "to": sq_name(m.to)}

    @staticmethod
    def _stockfish_move(pos: Position, level: int, legal: List[Move]) -> Optional[Move]:
        """Zug von Stockfish, nur wenn er am Tisch erlaubt ist (Umwandlung wird zur Dame). Sonst None."""
        if os.environ.get("TABLETOP_CONFORMANCE") or os.environ.get("SCHACH_STOCKFISH") == "off":
            return None                     # Pflicht-Prüfung: schneller eingebauter Computer
        sf = engine()
        if not sf.available:
            return None
        cfg = STOCKFISH_LEVELS.get(level, STOCKFISH_LEVELS[2])
        uci = sf.best_move(pos.fen(), cfg["movetime_ms"], cfg.get("elo"), cfg.get("skill"))
        if not uci or len(uci) < 4:
            return None
        try:
            frm, to = sq_index(uci[:2]), sq_index(uci[2:4])
        except (ValueError, IndexError):
            return None
        return next((m for m in legal if m.frm == frm and m.to == to), None)
