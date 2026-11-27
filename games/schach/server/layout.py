"""Brett-Layout Schach für den Spieltisch: 64 Felder, 32 Figuren, Ablagen für geschlagene Figuren.

Platz 0 = Weiß sitzt bei +z („unten“), Platz 1 = Schwarz gegenüber. Aus Sicht von Weiß ist +x rechts,
also liegt die a-Linie links (−x) und Reihe 1 vorn (+z).

Geschlagene Figuren legt jeder rechts neben das Brett, wie am echten Tisch:
  Weiß (vorne) schlägt → Ablage rechts von Weiß  (+x), Felder x-b-0…15 (schwarze Figuren)
  Schwarz schlägt     → Ablage rechts von Schwarz (−x), Felder x-w-0…15 (weiße Figuren)
"""
from chess import FILES

COLORS = ["white", "black"]                      # Index = Sitzplatz
PALETTE = {"white": "#eadcbc", "black": "#2a1f1a"}  # Ahorn hell / Nussbaum dunkel gebeizt
SEAT_COLORS = ["#f3ead6", "#3b2f2a"]
SPACING = 0.92                                   # Kantenlänge eines Feldes
FRAME = 0.55                                     # Holzrahmen um die 8×8 Felder
BOARD_SIZE = 8 * SPACING + 2 * FRAME

BACK_RANK = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"]
SHORT = {"rook": "R", "knight": "N", "bishop": "B", "queen": "Q", "king": "K", "pawn": "P"}


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


def build_layout() -> dict:
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
    for seat, color in enumerate(COLORS):
        c = color[0]
        back, pawns = ("1", "2") if color == "white" else ("8", "7")
        for f, kind in enumerate(BACK_RANK):
            # Figuren-IDs nach Startfeld: w-R-a1 … (bleiben gleich, auch wenn der Bauer zur Dame wird)
            pid = f"{c}-{SHORT[kind]}-{FILES[f]}{back}"
            pieces[pid] = {"kind": kind, "seat": seat, "color": color, "field": f"{FILES[f]}{back}"}
        for f in range(8):
            pid = f"{c}-P-{FILES[f]}{pawns}"
            pieces[pid] = {"kind": "pawn", "seat": seat, "color": color, "field": f"{FILES[f]}{pawns}"}
    return {"board": {"kind": "chess", "size": BOARD_SIZE, "spacing": SPACING, "frame": FRAME},
            "palette": PALETTE, "fields": fields, "pieces": pieces}


LAYOUT = build_layout()
