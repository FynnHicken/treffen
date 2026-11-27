"""Brett-Layouts Schach für den Spieltisch: klassisch, Teamschach, Tandem (zwei Bretter), Vierschach (Kreuzbrett).

Tisch-Koordinaten: Mitte = 0,0; Platz 0 sitzt bei +z („unten“). Jede Figur bringt mit, wohin sie schaut
(`facing` in Grad wie die Plätze: 0 = zu +z, 180 = zu −z) und auf welcher Seite ihres Heers sie anfangs steht
(`inward` −1/+1, dreht Springerköpfe leicht zur Mitte). So zeichnet der Client jedes Brett mit denselben Figuren.

Klassisch (Platz 0 = Weiß vorn, Platz 1 = Schwarz gegenüber). Aus Sicht von Weiß ist +x rechts, die a-Linie liegt
links (−x), Reihe 1 vorn (+z). Geschlagene Figuren legt jeder rechts neben das Brett, wie am echten Tisch:
  Weiß (vorn) schlägt → Ablage rechts von Weiß  (+x), Felder x-b-0…15 (schwarze Figuren)
  Schwarz schlägt     → Ablage rechts von Schwarz (−x), Felder x-w-0…15 (weiße Figuren)
"""
from chess import FILES

COLORS = ["white", "black"]                      # Index = Sitzplatz (klassisch)
PALETTE = {"white": "#eadcbc", "black": "#2a1f1a"}  # Ahorn hell / Nussbaum dunkel gebeizt
SEAT_COLORS = ["#f3ead6", "#3b2f2a"]
SPACING = 0.92                                   # Kantenlänge eines Feldes
FRAME = 0.55                                     # Holzrahmen um die 8×8 Felder
BOARD_SIZE = 8 * SPACING + 2 * FRAME

BACK_RANK = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"]
SHORT = {"rook": "R", "knight": "N", "bishop": "B", "queen": "Q", "king": "K", "pawn": "P"}
VALUE = {"pawn": 1, "knight": 3, "bishop": 3, "rook": 5, "queen": 9, "king": 0}   # Punkte (Vierschach, Bots)


def square_xz(name: str) -> tuple:
    f, r = FILES.index(name[0]), int(name[1]) - 1
    return round((f - 3.5) * SPACING, 4), round((3.5 - r) * SPACING, 4)


def tray_xz(color: str, i: int) -> tuple:
    """Ablage: zwei Spalten à 8 neben dem Brett, gefüllt vom Schlagenden aus gesehen von vorn nach hinten."""
    col, row = divmod(i, 8)
    x = BOARD_SIZE / 2 + 0.55 + col * 0.72
    z = 3.5 * 0.8 - row * 0.8                    # beginnt vorn beim Schlagenden
    if color == "white":                         # weiße Figuren schlägt Schwarz (sitzt bei −z, rechts = −x)
        return round(-x, 4), round(-z, 4)
    return round(x, 4), round(z, 4)


def build_layout(seat_of=None) -> dict:
    """Klassisches Brett. seat_of: Farbe → Platz, dem die Figuren anfangs gehören (Teamschach: Schwarz = Platz 2)."""
    seat_of = seat_of or {"white": 0, "black": 1}
    fields, pieces = {}, {}
    for r in range(8):
        for f in range(8):
            name = f"{FILES[f]}{r + 1}"
            x, z = square_xz(name)
            fields[name] = {"x": x, "z": z, "kind": "square", "color": "dark" if (f + r) % 2 == 0 else "light"}
    for color in COLORS:
        for i in range(16):
            x, z = tray_xz(color, i)
            fields[f"x-{color[0]}-{i}"] = {"x": x, "z": z, "kind": "tray", "color": color, "index": i}
    for color in COLORS:
        c = color[0]
        back, pawns = ("1", "2") if color == "white" else ("8", "7")
        facing = 180 if color == "white" else 0
        for f, kind in enumerate(BACK_RANK):
            # Figuren-IDs nach Startfeld: w-R-a1 … (bleiben gleich, auch wenn der Bauer zur Dame wird)
            pid = f"{c}-{SHORT[kind]}-{FILES[f]}{back}"
            pieces[pid] = {"kind": kind, "seat": seat_of[color], "color": color, "field": f"{FILES[f]}{back}",
                           "facing": facing, "inward": _inward(f, color == "white")}
        for f in range(8):
            pid = f"{c}-P-{FILES[f]}{pawns}"
            pieces[pid] = {"kind": "pawn", "seat": seat_of[color], "color": color, "field": f"{FILES[f]}{pawns}",
                           "facing": facing, "inward": _inward(f, color == "white")}
    return {"board": {"kind": "chess", "cells": "square", "size": BOARD_SIZE, "spacing": SPACING, "frame": FRAME},
            "palette": PALETTE, "fields": fields, "pieces": pieces}


def _inward(file_idx: int, white: bool) -> int:
    """+1, wenn die Figur aus Sicht ihres Spielers rechts steht (Weiß: e–h, Schwarz: a–d), sonst −1."""
    return 1 if (file_idx >= 4) == white else -1


LAYOUT = build_layout()
TEAM_LAYOUT = build_layout({"white": 0, "black": 2})

# ---------------------------------------------------------------- Tandem (zwei Bretter nebeneinander)
# Brett A links (Weiß vorn), Brett B rechts (Weiß hinten). Partner sitzen nebeneinander und spielen verschiedene
# Farben: vorn A-Weiß + B-Schwarz, hinten A-Schwarz + B-Weiß. Geschlagene Figuren wandern zum Partner – in dessen
# Vorrat (Felder vor ihm), von dort darf er sie auf ein freies Feld seines Bretts einsetzen.
T_SPACING = 0.62
T_FRAME = 0.3
T_SIZE = 8 * T_SPACING + 2 * T_FRAME
T_CX = {"A": -(T_SIZE / 2 + 0.17), "B": T_SIZE / 2 + 0.17}
# Platz je (Brett, Farbe): 0 A-Weiß (vorn links), 1 B-Schwarz (vorn rechts), 2 A-Schwarz (hinten links), 3 B-Weiß
TANDEM_SEATS = {("A", "w"): 0, ("B", "b"): 1, ("A", "b"): 2, ("B", "w"): 3}
TANDEM_TEAMS = [[0, 1], [2, 3]]
TANDEM_SEAT_COLORS = ["#f3ead6", "#3b2f2a", "#3b2f2a", "#f3ead6"]
RESERVE_SLOTS = 30           # so viele Figuren einer Farbe kann ein Vorrat höchstens bekommen (3 Reihen à 10)


def tandem_white_front(board: str) -> bool:
    return board == "A"


def tandem_square_xz(board: str, sq: str) -> tuple:
    f, r = FILES.index(sq[0]), int(sq[1]) - 1
    x, z = (f - 3.5) * T_SPACING, (3.5 - r) * T_SPACING
    if not tandem_white_front(board):          # Brett B um 180° gedreht: Weiß sitzt hinten
        x, z = -x, -z
    return round(T_CX[board] + x, 4), round(z, 4)


def reserve_xz(board: str, color: str, i: int) -> tuple:
    """Vorrat vor dem Spieler (Brett, Farbe): Reihen à 10 zwischen Brett und Tischkante, vorderste zuerst."""
    row, col = divmod(i, 10)
    x = (col - 4.5) * 0.5
    z = T_SIZE / 2 + 0.45 + row * 0.5
    front = (color == "w") == tandem_white_front(board)      # sitzt der Besitzer vorn (+z)?
    if not front:
        x, z = -x, -z
    return round(T_CX[board] + x, 4), round(z, 4)


def build_tandem_layout() -> dict:
    fields, pieces = {}, {}
    for b in "AB":
        for r in range(8):
            for f in range(8):
                sq = f"{FILES[f]}{r + 1}"
                x, z = tandem_square_xz(b, sq)
                fields[f"{b}-{sq}"] = {"x": x, "z": z, "kind": "square", "board": b,
                                       "color": "dark" if (f + r) % 2 == 0 else "light"}
        for c in "wb":
            for i in range(RESERVE_SLOTS):
                x, z = reserve_xz(b, c, i)
                fields[f"r-{b}-{c}-{i}"] = {"x": x, "z": z, "kind": "reserve", "board": b,
                                            "color": "white" if c == "w" else "black", "index": i,
                                            "seat": TANDEM_SEATS[(b, c)]}
        for c in "wb":
            white = c == "w"
            back, pawns = ("1", "2") if white else ("8", "7")
            front = white == tandem_white_front(b)
            facing = 180 if front else 0
            for f, kind in enumerate(BACK_RANK + ["pawn"] * 8):
                sq = f"{FILES[f % 8]}{back if f < 8 else pawns}"
                pid = f"{b}-{c}-{SHORT[kind]}-{sq}"
                pieces[pid] = {"kind": kind, "seat": TANDEM_SEATS[(b, c)], "color": "white" if white else "black",
                               "field": f"{b}-{sq}", "facing": facing, "inward": _inward(f % 8, white)}
    return {"board": {"kind": "tandem", "cells": "square", "size": 2 * T_SIZE + 0.34, "spacing": T_SPACING, "frame": T_FRAME,
                      "boards": {b: {"cx": T_CX[b], "cz": 0, "size": T_SIZE, "white_front": tandem_white_front(b)}
                                 for b in "AB"}},
            "palette": PALETTE, "fields": fields, "pieces": pieces}


TANDEM_LAYOUT = build_tandem_layout()

# ---------------------------------------------------------------- Vierschach (Kreuzbrett 14×14, vier Heere)
# Felder a1…n14 (Linien a–n von links nach rechts aus Sicht von Platz 0, Reihen 1–14 von vorn nach hinten); die vier
# Ecken (3×3) fehlen. Platz 0 Rot vorn, 1 Blau links, 2 Gelb hinten, 3 Grün rechts. Partner sitzen sich gegenüber.
V_FILES = "abcdefghijklmn"
V_SPACING = 0.66
V_FRAME = 0.32
V_N = 14
V_COLORS = ["red", "blue", "yellow", "green"]
V_PALETTE = {"red": "#b0352c", "blue": "#2f5ea8", "yellow": "#d8a82c", "green": "#2f8550"}
V_SEAT_COLORS = ["#c0453a", "#3a68b5", "#e0b440", "#3c9660"]
V_NAMES = {"red": "Rot", "blue": "Blau", "yellow": "Gelb", "green": "Grün"}
# Vorwärts-Richtung je Platz im Brett-Raster (x = Linie, y = Reihe)
V_FORWARD = [(0, 1), (1, 0), (0, -1), (-1, 0)]
V_TRAY = 5                                       # Ablagen in den vier Tischecken: 5×5 Plätze


def v_valid(x: int, y: int) -> bool:
    return 0 <= x < V_N and 0 <= y < V_N and not ((x < 3 or x > 10) and (y < 3 or y > 10))


def v_name(x: int, y: int) -> str:
    return f"{V_FILES[x]}{y + 1}"


def v_xy(name: str) -> tuple:
    return V_FILES.index(name[0]), int(name[1:]) - 1


def v_xz(x: float, y: float) -> tuple:
    return round((x - 6.5) * V_SPACING, 4), round((6.5 - y) * V_SPACING, 4)


def v_start(seat: int) -> dict:
    """Startaufstellung eines Heers: Feldname → Art. Dame links vom König aus Sicht des Spielers (wie bei Weiß)."""
    out = {}
    back = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"]
    for i, kind in enumerate(back):
        # i = 0 … 7 von links nach rechts aus Sicht des Spielers
        if seat == 0:
            bx, by, px, py = 3 + i, 0, 3 + i, 1
        elif seat == 2:
            bx, by, px, py = 10 - i, 13, 10 - i, 12
        elif seat == 1:
            bx, by, px, py = 0, 10 - i, 1, 10 - i
        else:
            bx, by, px, py = 13, 3 + i, 12, 3 + i
        out[v_name(bx, by)] = kind
        out[v_name(px, py)] = "pawn"
    return out


def v_tray_xz(corner: int, i: int) -> tuple:
    """Ablage rechts vorn von Platz `corner` (in der Tischecke außerhalb des Kreuzes)."""
    row, col = divmod(i, V_TRAY)
    a, b = 3.45 + col * 0.6, 3.45 + row * 0.6       # Abstand von der Mitte nach rechts / nach vorn
    # Platz 0 (vorn): rechts = +x, vorn = +z; für die anderen Plätze um 90° weiterdrehen (Uhrzeigersinn von oben)
    x, z = a, b
    for _ in range(corner):
        x, z = -z, x
    return round(x, 4), round(z, 4)


def build_vier_layout() -> dict:
    fields, pieces = {}, {}
    for y in range(V_N):
        for x in range(V_N):
            if v_valid(x, y):
                tx, tz = v_xz(x, y)
                fields[v_name(x, y)] = {"x": tx, "z": tz, "kind": "square", "color": "dark" if (x + y) % 2 == 0 else "light"}
    for corner in range(4):
        for i in range(V_TRAY * V_TRAY):
            tx, tz = v_tray_xz(corner, i)
            fields[f"x-{corner}-{i}"] = {"x": tx, "z": tz, "kind": "tray", "index": i, "seat": corner}
    for seat, color in enumerate(V_COLORS):
        facing = (seat * 90 + 180) % 360
        for sq, kind in v_start(seat).items():
            x, y = v_xy(sq)
            lateral = (x - 6.5, y - 6.5)
            # rechts aus Sicht des Spielers: Platz 0 → +x, 1 → +y … (Vorwärts um 90° im Uhrzeigersinn gedreht)
            fx, fy = V_FORWARD[seat]
            rx, ry = fy, -fx
            inward = 1 if lateral[0] * rx + lateral[1] * ry > 0 else -1
            pid = f"{color[0]}-{SHORT[kind]}-{sq}"
            pieces[pid] = {"kind": kind, "seat": seat, "color": color, "field": sq, "facing": facing, "inward": inward}
    return {"board": {"kind": "vierer", "cells": "square", "size": V_N * V_SPACING + 2 * V_FRAME, "spacing": V_SPACING, "frame": V_FRAME,
                      "cut": 3},
            "palette": V_PALETTE, "fields": fields, "pieces": pieces}


VIER_LAYOUT = build_vier_layout()
