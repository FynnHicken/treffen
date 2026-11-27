"""Dame-Brett aus den Brett-Hilfen der Engine (tabletop_server.boards) – kein eigener Client-Code nötig."""
from tabletop_server.boards import grid, layout, tray

SPACING = 0.82
PALETTE = {"light": "#ead2a6", "dark": "#6b4226", "white": "#f1ebdf", "black": "#2a2420"}
SEAT_COLORS = [PALETTE["white"], PALETTE["black"]]


def build_layout() -> dict:
    fields = grid(8, 8, spacing=SPACING, colors=("light", "dark"))
    # Ablagen rechts neben dem Brett aus Sicht des Schlagenden (Weiß vorn rechts, Schwarz hinten links)
    fields.update(tray("tray-0", 12, x=4.35, z=1.6, cols=2, spacing=0.5))
    fields.update(tray("tray-1", 12, x=-4.35, z=-1.6, cols=2, spacing=0.5))
    pieces = {}
    for seat, rows, color in ((0, range(0, 3), "white"), (1, range(5, 8), "black")):
        n = 0
        for r in rows:
            for c in range(8):
                if (c + r) % 2 == 0:                     # dunkle Felder (a1 ist dunkel)
                    pieces[f"{color[0]}{n}"] = {"kind": "disc", "seat": seat, "color": color, "field": f"{'abcdefgh'[c]}{r + 1}"}
                    n += 1
    return layout(fields, pieces, palette=PALETTE, spacing=SPACING, cells="square", margin=0.35)


LAYOUT = build_layout()
