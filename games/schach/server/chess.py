"""Schach-Kern ohne Spieltisch: Stellung, legale Züge, Zug ausführen, Remis-Erkennung, Computer-Suche.

Felder 0…63: Index = Reihe * 8 + Linie (a1 = 0, h1 = 7, a8 = 56). Figuren als Zeichen wie in FEN:
Großbuchstaben = Weiß (P N B R Q K), Kleinbuchstaben = Schwarz. Geprüft mit Perft-Zahlen (tests/test_chess.py).
"""
import random
import time
from typing import List, NamedTuple, Optional, Tuple

FILES = "abcdefgh"
START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

KNIGHT = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
KING = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
DIAG = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
ORTHO = [(1, 0), (-1, 0), (0, 1), (0, -1)]
_CASTLE_LOST = {4: "KQ", 60: "kq", 0: "Q", 7: "K", 56: "q", 63: "k"}


def sq_name(sq: int) -> str:
    return FILES[sq % 8] + str(sq // 8 + 1)


def sq_index(name: str) -> int:
    return (int(name[1]) - 1) * 8 + FILES.index(name[0])


def is_white(p: str) -> bool:
    return p.isupper()


class Move(NamedTuple):
    frm: int
    to: int
    promo: Optional[str] = None     # 'Q','R','B','N' (Farbe ergibt sich aus der Figur)
    flag: str = ""                  # "ep" en passant, "K"/"Q" Rochade kurz/lang, "2" Doppelschritt


class Position:
    __slots__ = ("board", "white", "castling", "ep", "halfmove", "fullmove")

    def __init__(self, board, white=True, castling="KQkq", ep=None, halfmove=0, fullmove=1):
        self.board: List[Optional[str]] = board
        self.white: bool = white            # Weiß am Zug
        self.castling: str = castling       # Teilmenge von "KQkq" ("" = keine)
        self.ep: Optional[int] = ep         # Feld hinter einem Doppelschritt
        self.halfmove: int = halfmove
        self.fullmove: int = fullmove

    # ---------- FEN ----------
    @classmethod
    def from_fen(cls, fen: str) -> "Position":
        parts = fen.split()
        board: List[Optional[str]] = [None] * 64
        for r, row in enumerate(parts[0].split("/")):
            f = 0
            for ch in row:
                if ch.isdigit():
                    f += int(ch)
                else:
                    board[(7 - r) * 8 + f] = ch
                    f += 1
        castling = "" if parts[2] == "-" else parts[2]
        ep = None if parts[3] == "-" else sq_index(parts[3])
        return cls(board, parts[1] == "w", castling, ep,
                   int(parts[4]) if len(parts) > 4 else 0, int(parts[5]) if len(parts) > 5 else 1)

    def fen(self) -> str:
        rows = []
        for r in range(7, -1, -1):
            row, empty = "", 0
            for f in range(8):
                p = self.board[r * 8 + f]
                if p is None:
                    empty += 1
                else:
                    row += (str(empty) if empty else "") + p
                    empty = 0
            rows.append(row + (str(empty) if empty else ""))
        return " ".join(["/".join(rows), "w" if self.white else "b", self.castling or "-",
                         sq_name(self.ep) if self.ep is not None else "-", str(self.halfmove), str(self.fullmove)])

    def key(self) -> str:
        """Für Stellungswiederholung: Brett, wer am Zug, Rochaderechte, en passant (ohne Zugzähler)."""
        return " ".join(self.fen().split()[:4])

    def copy(self) -> "Position":
        return Position(self.board[:], self.white, self.castling, self.ep, self.halfmove, self.fullmove)

    # ---------- Angriffe ----------
    def attacked(self, sq: int, by_white: bool) -> bool:
        b = self.board
        f0, r0 = sq % 8, sq // 8
        # Bauern
        pr = r0 - 1 if by_white else r0 + 1
        pawn = "P" if by_white else "p"
        if 0 <= pr < 8:
            for df in (-1, 1):
                f = f0 + df
                if 0 <= f < 8 and b[pr * 8 + f] == pawn:
                    return True
        knight, king = ("N", "K") if by_white else ("n", "k")
        for df, dr in KNIGHT:
            f, r = f0 + df, r0 + dr
            if 0 <= f < 8 and 0 <= r < 8 and b[r * 8 + f] == knight:
                return True
        for df, dr in KING:
            f, r = f0 + df, r0 + dr
            if 0 <= f < 8 and 0 <= r < 8 and b[r * 8 + f] == king:
                return True
        diag = ("B", "Q") if by_white else ("b", "q")
        ortho = ("R", "Q") if by_white else ("r", "q")
        for dirs, hit in ((DIAG, diag), (ORTHO, ortho)):
            for df, dr in dirs:
                f, r = f0 + df, r0 + dr
                while 0 <= f < 8 and 0 <= r < 8:
                    p = b[r * 8 + f]
                    if p is not None:
                        if p in hit:
                            return True
                        break
                    f += df
                    r += dr
        return False

    def king_sq(self, white: bool) -> Optional[int]:
        k = "K" if white else "k"
        try:
            return self.board.index(k)
        except ValueError:
            return None

    def in_check(self, white: Optional[bool] = None) -> bool:
        white = self.white if white is None else white
        k = self.king_sq(white)
        return k is not None and self.attacked(k, not white)

    # ---------- Züge ----------
    def pseudo_moves(self) -> List[Move]:
        b, white, out = self.board, self.white, []
        own = str.isupper if white else str.islower
        for sq, p in enumerate(b):
            if p is None or not own(p):
                continue
            f0, r0, kind = sq % 8, sq // 8, p.upper()
            if kind == "P":
                d, start, last = (1, 1, 7) if white else (-1, 6, 0)
                r1 = r0 + d
                if 0 <= r1 < 8 and b[r1 * 8 + f0] is None:
                    self._pawn_to(out, sq, r1 * 8 + f0, r1 == last)
                    if r0 == start and b[(r0 + 2 * d) * 8 + f0] is None:
                        out.append(Move(sq, (r0 + 2 * d) * 8 + f0, None, "2"))
                for df in (-1, 1):
                    f = f0 + df
                    if 0 <= f < 8 and 0 <= r1 < 8:
                        t = r1 * 8 + f
                        q = b[t]
                        if q is not None and not own(q):
                            self._pawn_to(out, sq, t, r1 == last)
                        elif t == self.ep:
                            out.append(Move(sq, t, None, "ep"))
            elif kind in "NK":
                for df, dr in (KNIGHT if kind == "N" else KING):
                    f, r = f0 + df, r0 + dr
                    if 0 <= f < 8 and 0 <= r < 8:
                        q = b[r * 8 + f]
                        if q is None or not own(q):
                            out.append(Move(sq, r * 8 + f))
                if kind == "K":
                    self._castles(out, sq)
            else:
                dirs = DIAG if kind == "B" else ORTHO if kind == "R" else DIAG + ORTHO
                for df, dr in dirs:
                    f, r = f0 + df, r0 + dr
                    while 0 <= f < 8 and 0 <= r < 8:
                        q = b[r * 8 + f]
                        if q is None:
                            out.append(Move(sq, r * 8 + f))
                        else:
                            if not own(q):
                                out.append(Move(sq, r * 8 + f))
                            break
                        f += df
                        r += dr
        return out

    @staticmethod
    def _pawn_to(out, frm, to, promote):
        if promote:
            out.extend(Move(frm, to, pr) for pr in "QRBN")
        else:
            out.append(Move(frm, to))

    def _castles(self, out, sq):
        b, white = self.board, self.white
        home = 4 if white else 60
        if sq != home or self.attacked(home, not white):
            return
        k, q = ("K", "Q") if white else ("k", "q")
        rook = "R" if white else "r"
        if k in self.castling and b[home + 1] is None and b[home + 2] is None and b[home + 3] == rook \
                and not self.attacked(home + 1, not white) and not self.attacked(home + 2, not white):
            out.append(Move(home, home + 2, None, "K"))
        if q in self.castling and b[home - 1] is None and b[home - 2] is None and b[home - 3] is None \
                and b[home - 4] == rook and not self.attacked(home - 1, not white) and not self.attacked(home - 2, not white):
            out.append(Move(home, home - 2, None, "Q"))

    def legal_moves(self) -> List[Move]:
        out = []
        for m in self.pseudo_moves():
            nxt = self.play(m)
            if not nxt.in_check(self.white):
                out.append(m)
        return out

    def play(self, m: Move) -> "Position":
        """Neue Stellung nach dem Zug (die alte bleibt unverändert)."""
        b = self.board[:]
        p = b[m.frm]
        captured = b[m.to]
        b[m.to], b[m.frm] = p, None
        if m.flag == "ep":
            b[m.to - 8 if self.white else m.to + 8] = None
            captured = "p"
        elif m.flag == "K":
            b[m.frm + 1], b[m.frm + 3] = b[m.frm + 3], None
        elif m.flag == "Q":
            b[m.frm - 1], b[m.frm - 4] = b[m.frm - 4], None
        if m.promo:
            b[m.to] = m.promo if self.white else m.promo.lower()
        castling = self.castling
        if castling:
            # Recht verfällt, wenn König oder Turm ziehen oder der Turm geschlagen wird
            for sq in (m.frm, m.to):
                lost = _CASTLE_LOST.get(sq)
                if lost:
                    castling = "".join(c for c in castling if c not in lost)
        ep = (m.frm + m.to) // 2 if m.flag == "2" else None
        half = 0 if (p.upper() == "P" or captured is not None) else self.halfmove + 1
        full = self.fullmove + (0 if self.white else 1)
        return Position(b, not self.white, castling, ep, half, full)

    def insufficient_material(self) -> bool:
        """Kein Matt mehr möglich: K–K, K+L–K, K+S–K, K+L–K+L (Läufer auf gleicher Farbe)."""
        rest = [(sq, p) for sq, p in enumerate(self.board) if p is not None and p.upper() != "K"]
        if not rest:
            return True
        if any(p.upper() in "PRQ" for _, p in rest):
            return False
        if len(rest) == 1:
            return True
        if all(p.upper() == "B" for _, p in rest):
            colors = {(sq % 8 + sq // 8) % 2 for sq, _ in rest}
            return len(colors) == 1
        return False


def perft(pos: Position, depth: int) -> int:
    if depth == 0:
        return 1
    moves = pos.legal_moves()
    if depth == 1:
        return len(moves)
    return sum(perft(pos.play(m), depth - 1) for m in moves)


# ---------- Computer ----------
VALUE = {"P": 100, "N": 320, "B": 330, "R": 500, "Q": 900, "K": 0}
# Figur-Feld-Tabellen (aus Sicht von Weiß, Reihe 8 oben), klassisch nach Tomasz Michniewski, gekürzt
PST = {
    "P": [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
          0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    "N": [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30,
          -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
          -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    "B": [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10,
          -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
          -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    "R": [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
          -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    "Q": [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
          -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10,
          -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    "K": [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
          -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
          20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
}


def evaluate(pos: Position) -> int:
    """Bewertung aus Sicht der Seite am Zug (positiv = gut für sie)."""
    score = 0
    for sq, p in enumerate(pos.board):
        if p is None:
            continue
        k = p.upper()
        if p.isupper():
            score += VALUE[k] + PST[k][(7 - sq // 8) * 8 + sq % 8]
        else:
            score -= VALUE[k] + PST[k][(sq // 8) * 8 + sq % 8]
    return score if pos.white else -score


MATE = 100000


class _Timeout(Exception):
    pass


def _order(pos: Position, moves: List[Move]) -> List[Move]:
    def key(m: Move):
        cap = pos.board[m.to]
        return -(VALUE[cap.upper()] * 10 - VALUE[pos.board[m.frm].upper()] // 10 if cap else 0) - (800 if m.promo == "Q" else 0)
    return sorted(moves, key=key)


def _search(pos: Position, depth: int, alpha: int, beta: int, deadline: float, ply: int) -> int:
    if time.monotonic() > deadline:
        raise _Timeout()
    if depth == 0:
        return evaluate(pos)
    moves = pos.legal_moves()
    if not moves:
        return -(MATE - ply) if pos.in_check() else 0
    for m in _order(pos, moves):
        score = -_search(pos.play(m), depth - 1, -beta, -alpha, deadline, ply + 1)
        if score >= beta:
            return beta
        if score > alpha:
            alpha = score
    return alpha


def best_move(pos: Position, max_depth: int = 2, time_budget: float = 1.5, rng: Optional[random.Random] = None,
              history: Tuple[str, ...] = (), tolerance: int = 8) -> Optional[Move]:
    """Iterative Vertiefung bis max_depth bzw. Zeit. Unter gleich guten Zügen wird zufällig gewählt
    (der Computer spielt nicht jede Partie gleich; `tolerance` in Hundertstel-Bauern – groß = schwächer). Züge, die eine Stellung zum 3. Mal herbeiführen, meidet er,
    solange er nicht schlechter steht."""
    rng = rng or random.Random()
    moves = pos.legal_moves()
    if not moves:
        return None
    deadline = time.monotonic() + time_budget
    best: List[Move] = list(moves)
    for depth in range(1, max_depth + 1):
        try:
            scored = []
            for m in _order(pos, moves):
                nxt = pos.play(m)
                s = -_search(nxt, depth - 1, -MATE - 1, MATE + 1, deadline, 1)
                if history.count(nxt.key()) >= 2 and s >= 0:
                    s -= 50
                scored.append((s, m))
        except _Timeout:
            break
        top = max(s for s, _ in scored)
        best = [m for s, m in scored if s >= top - tolerance]
        if top >= MATE - 10:
            break
    return rng.choice(best)
