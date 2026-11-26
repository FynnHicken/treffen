"""Brett-Layout „Mensch ärgere dich nicht“ für den Spieltisch: Felder + Figuren in Tisch-Koordinaten.

Raster wie im 2D-Prototyp (../server/game_state.py): 11×11, (Zeile, Spalte), Zeile 0 oben.
Das Raster wird so gedreht, dass Gelbs Startfeld vor Platz 0 (+z, „unten“) liegt; Grün links (Platz 1),
Rot oben (Platz 2), Schwarz rechts (Platz 3) – Zugreihenfolge = Sitzreihenfolge im Uhrzeigersinn.
"""
COLORS = ["yellow", "green", "red", "black"]           # Index = Sitzplatz
# Lackfarben der Figuren/Felder (kräftig, aber nicht grell – wie lackiertes Holz)
PALETTE = {"yellow": "#f2c12e", "green": "#2f9e57", "red": "#d63a2f", "black": "#2b2f36"}
SPACING = 0.8                                           # Abstand zweier Felder in Tisch-Einheiten

# 40 Laufbahnfelder im Uhrzeigersinn, Feld 0 = Gelbs Start „A“
TRACK = [
    (4, 0), (4, 1), (4, 2), (4, 3), (4, 4), (3, 4), (2, 4), (1, 4), (0, 4), (0, 5),
    (0, 6), (1, 6), (2, 6), (3, 6), (4, 6), (4, 7), (4, 8), (4, 9), (4, 10), (5, 10),
    (6, 10), (6, 9), (6, 8), (6, 7), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6), (10, 5),
    (10, 4), (9, 4), (8, 4), (7, 4), (6, 4), (6, 3), (6, 2), (6, 1), (6, 0), (5, 0),
]
START_INDEX = {"yellow": 0, "green": 10, "red": 20, "black": 30}
GOAL = {
    "yellow": [(5, 1), (5, 2), (5, 3), (5, 4)],
    "green": [(1, 5), (2, 5), (3, 5), (4, 5)],
    "red": [(5, 9), (5, 8), (5, 7), (5, 6)],
    "black": [(9, 5), (8, 5), (7, 5), (6, 5)],
}
HOME = {   # Häuschen (B-Felder) in den Ecken
    "yellow": [(0, 0), (0, 1), (1, 0), (1, 1)],
    "green": [(0, 9), (0, 10), (1, 9), (1, 10)],
    "red": [(9, 9), (9, 10), (10, 9), (10, 10)],
    "black": [(9, 0), (9, 1), (10, 0), (10, 1)],
}


def to_table(row: int, col: int) -> tuple:
    """Raster → Tisch: Bild-x = Spalte, Bild-y = Zeile (beide um die Mitte); Drehung links → unten."""
    x_img, y_img = col - 5, row - 5
    return round(y_img * SPACING, 4), round(-x_img * SPACING, 4)


def build_layout() -> dict:
    fields, pieces = {}, {}
    start_of = {i: c for c, i in START_INDEX.items()}
    for i, (r, c) in enumerate(TRACK):
        x, z = to_table(r, c)
        f = {"x": x, "z": z, "kind": "start" if i in start_of else "track", "index": i}
        if i in start_of:
            f["color"] = start_of[i]
        fields[f"t{i}"] = f
    for color in COLORS:
        for k, (r, c) in enumerate(GOAL[color]):
            x, z = to_table(r, c)
            fields[f"g-{color}-{k}"] = {"x": x, "z": z, "kind": "goal", "color": color, "index": k}
        for k, (r, c) in enumerate(HOME[color]):
            x, z = to_table(r, c)
            fields[f"h-{color}-{k}"] = {"x": x, "z": z, "kind": "home", "color": color, "index": k}
    for seat, color in enumerate(COLORS):
        for k in range(4):
            pieces[f"p-{color}-{k}"] = {"kind": "pawn", "seat": seat, "color": color, "field": f"h-{color}-{k}"}
    return {"board": {"kind": "mensch", "size": 11 * SPACING + 0.9, "spacing": SPACING},
            "palette": PALETTE, "fields": fields, "pieces": pieces, "dice": {"count": 1, "sides": 6}}


LAYOUT = build_layout()
