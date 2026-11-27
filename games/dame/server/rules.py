"""Dame (deutsche Regeln) auf dem Treffen-Spieltisch – Regel-API 2.

- 8×8, gespielt auf den dunklen Feldern; Weiß (Platz 0, vorn) beginnt.
- Steine ziehen ein Feld schräg vorwärts und schlagen vorwärts durch Überspringen.
- Schlagzwang (Hausregel, Standard an): Wer schlagen kann, muss schlagen; Mehrfachsprünge in einem Zug.
- Erreicht ein Stein die letzte Reihe, wird er zur Dame (Doppelstein) – sie zieht und schlägt beliebig weit schräg.
- Verloren hat, wer nicht mehr ziehen kann (keine Steine oder alle blockiert). 40 Damenzüge ohne Schlagen = Remis.

Am Tisch: Stein greifen und aufs Ziel setzen (bei Mehrfachsprung aufs Endfeld) – der Tisch hüpft Feld für Feld,
geschlagene Steine wandern in die Ablage des Schlagenden. Statuszeile, Markierung und Siegerehrung zeigt die Engine.
"""
import random
from typing import Dict, List, Optional, Tuple

from tabletop_server.rules import GameRules

DIRS = [(1, 1), (-1, 1), (1, -1), (-1, -1)]
FORWARD = {0: 1, 1: -1}              # Weiß zieht Richtung Reihe 8, Schwarz Richtung Reihe 1
DRAW_AFTER = 40


class DameRules(GameRules):
    shared_view = True
    min_players = 2
    settings_schema = {
        "forced": {"default": True, "label": "Schlagzwang", "hint": "Wer schlagen kann, muss schlagen"},
        "back": {"default": False, "label": "Steine schlagen auch rückwärts"},
    }
    conformance_max_steps = 600

    # ---------- Hilfen ----------
    @staticmethod
    def sq(c: int, r: int) -> str:
        return f"{'abcdefgh'[c]}{r + 1}"

    def cr(self, room, field: str) -> Tuple[int, int]:
        f = room.layout["fields"][field]
        return f["col"], f["row"]

    def board(self, room) -> Dict[Tuple[int, int], str]:
        out = {}
        for pid, p in room.pieces.items():
            f = room.layout["fields"].get(p["field"])
            if f and f.get("kind") == "square":
                out[(f["col"], f["row"])] = pid
        return out

    def seat_of(self, room, pid: str) -> int:
        return room.layout["pieces"][pid]["seat"]

    def is_king(self, room, pid: str) -> bool:
        return (room.pieces[pid].get("kind") or room.layout["pieces"][pid]["kind"]) == "king"

    # ---------- Züge ----------
    def _jumps(self, room, board, pid, c, r, seat, king, taken, path) -> List[Tuple[List[Tuple[int, int]], List[str]]]:
        """Alle Sprungfolgen ab (c, r). Ergebnis: [(Felder der Landungen, geschlagene Steine)]."""
        out = []
        back = room.settings().get("back")
        for dc, dr in DIRS:
            if not king and not back and dr != FORWARD[seat]:
                continue
            x, y = c + dc, r + dr
            if king:                                    # fliegende Dame: bis zum ersten Stein
                while 0 <= x < 8 and 0 <= y < 8 and (x, y) not in board:
                    x, y = x + dc, y + dr
            victim = board.get((x, y))
            if not victim or victim in taken or self.seat_of(room, victim) == seat:
                continue
            lx, ly = x + dc, y + dr
            while 0 <= lx < 8 and 0 <= ly < 8 and ((lx, ly) not in board or board[(lx, ly)] == pid):
                more = self._jumps(room, board, pid, lx, ly, seat, king, taken + [victim], path + [(lx, ly)])
                out += more or [(path + [(lx, ly)], taken + [victim])]
                if not king:
                    break
                lx, ly = lx + dc, ly + dr
        return out

    def _moves(self, room, seat: int) -> List[dict]:
        board = self.board(room)
        jumps, steps = [], []
        for (c, r), pid in board.items():
            if self.seat_of(room, pid) != seat:
                continue
            king = self.is_king(room, pid)
            for path, taken in self._jumps(room, board, pid, c, r, seat, king, [], []):
                jumps.append({"type": "move", "piece": pid, "to": self.sq(*path[-1]),
                              "path": [self.sq(*p) for p in path], "captures": taken})
            for dc, dr in DIRS:
                if not king and dr != FORWARD[seat]:
                    continue
                x, y = c + dc, r + dr
                while 0 <= x < 8 and 0 <= y < 8 and (x, y) not in board:
                    steps.append({"type": "move", "piece": pid, "to": self.sq(x, y), "path": [self.sq(x, y)], "captures": []})
                    if not king:
                        break
                    x, y = x + dc, y + dr
        if jumps and room.settings().get("forced", True):
            return jumps
        return jumps + steps

    # ---------- API 2 ----------
    def setup(self, room) -> List[dict]:
        events = []
        for pid, spec in room.layout["pieces"].items():
            p = room.pieces[pid]
            if p["field"] != spec["field"] or p.get("kind"):
                events.append({"type": "PIECE_MOVED", "piece": pid, "from": p["field"], "to": spec["field"],
                               "by": "rules", "path": [spec["field"]], "reason": "reset"})
                if p.get("kind"):
                    events.append({"type": "PIECE_CHANGED", "piece": pid, "kind": spec["kind"], "reason": "reset"})
            room.pieces[pid] = {"field": spec["field"], "held_by": None}
        room.game = {"turn": 0, "phase": "move", "quiet": 0, "last": None, "captured": [0, 0], "result": None,
                     "finished": []}
        return events

    def actions(self, room, seat: int) -> List[dict]:
        g = room.game or {}
        if g.get("phase") != "move" or g.get("turn") != seat:
            return []
        return self._moves(room, seat)

    def apply(self, room, seat: int, action: dict) -> Optional[List[dict]]:
        if action.get("type") != "move":
            return None
        m = next((a for a in self.actions(room, seat)
                  if a["piece"] == action.get("piece") and a["to"] == action.get("to")), None)
        if m is None:
            return None
        g = room.game
        pid = m["piece"]
        frm = room.pieces[pid]["field"]
        room.pieces[pid]["field"] = m["to"]
        events = [{"type": "PIECE_MOVED", "piece": pid, "from": frm, "to": m["to"], "path": m["path"]}]
        for victim in m["captures"]:
            slot = f"tray-{seat}-{g['captured'][seat]}"
            g["captured"][seat] += 1
            vf = room.pieces[victim]["field"]
            room.pieces[victim]["field"] = slot
            events.append({"type": "PIECE_MOVED", "piece": victim, "from": vf, "to": slot, "by": "rules",
                           "path": [slot], "reason": "captured"})
        _, row = self.cr(room, m["to"])
        if not self.is_king(room, pid) and row == (7 if seat == 0 else 0):
            room.pieces[pid]["kind"] = "king"
            events.append({"type": "PIECE_CHANGED", "piece": pid, "kind": "king", "reason": "promotion"})
            events.append({"type": "NOTE", "text": "👑 {p%d} hat eine Dame!" % seat, "you": {str(seat): "👑 Deine Dame!"}})
        quiet = not m["captures"] and self.is_king(room, pid)
        g["quiet"] = g["quiet"] + 1 if quiet else 0
        g["last"] = {"from": frm, "to": m["to"]}
        g["turn"] = 1 - seat
        if not self._moves(room, g["turn"]):
            self._finish(room, [seat], "Der Gegner kann nicht mehr ziehen")
        elif g["quiet"] >= DRAW_AFTER:
            self._finish(room, [], f"Remis – {DRAW_AFTER} Damenzüge ohne Schlagen")
        return events

    def _finish(self, room, winners: List[int], text: str) -> None:
        g = room.game
        g.update(phase="over", turn=None, result={"winners": winners, "reason": "end", "text": text},
                 finished=winners + [s for s in (0, 1) if s not in winners])
        room.status = "finished"

    def view(self, room, seat) -> dict:
        g = dict(room.game or {})
        if g.get("phase") == "move" and g.get("turn") is not None:
            acts = self.actions(room, g["turn"])
            g["moves"] = [{"piece": a["piece"], "to": a["to"]} for a in acts]
            if acts and acts[0]["captures"] and room.settings().get("forced", True):
                g["say"] = {"me": "Du musst schlagen!", "all": "{who} muss schlagen …"}
        last = g.get("last")
        g["marks"] = [{"field": f, "kind": "last"} for f in ((last["from"], last["to"]) if last else ())]
        g["scores"] = list(g.get("captured", [0, 0]))
        g["scores_label"] = "Geschlagen"
        return g

    # ---------- Computer ----------
    def bot_action(self, room, seat: int) -> Optional[dict]:
        acts = self.actions(room, seat)
        if not acts:
            return None
        rng = random.Random()

        def score(a):
            s = len(a["captures"]) * 10 + rng.random() * 2
            _, row = self.cr(room, a["to"])
            if not self.is_king(room, a["piece"]) and row == (7 if seat == 0 else 0):
                s += 6
            return s
        best = max(acts, key=score)
        return {"type": "move", "piece": best["piece"], "to": best["to"]}
