"""Brett-Layouts „Mensch ärgere dich nicht“ für 4, 6 und 8 Spieler: Felder + Figuren in Tisch-Koordinaten.

Ein Brett mit N Armen entsteht aus einer Formel (N = 4 ergibt genau das klassische Kreuz, ein Test prüft das):
  - Jeder Platz k hat einen Arm, der zu ihm zeigt (Platz 0 unten, +z; im Uhrzeigersinn weiter wie die Sitzplätze).
  - Laufbahn: je Arm 10 Felder – 5 auf der einen Seite nach innen (das erste ist das Startfeld „A“), 4 auf der
    Seite des nächsten Arms nach außen und 1 an dessen Spitze. Zusammen 10·N Felder (t0 … t(10N−1)).
  - Ziel: 4 Felder auf der Mittellinie des eigenen Arms (g-<farbe>-0 außen … 3 innen), Einfahrt von der Armspitze.
  - Häuschen: 4 Felder („B“) zwischen dem eigenen und dem nächsten Arm, neben dem Startfeld.
Rechnen in Feld-Einheiten (Abstand zweier Felder = 1), am Ende mal SPACING der Variante.

Das 4er-Brett ist eckig wie das Original, 6er und 8er sind rund (passen so zwischen die Plätze am Tisch).
"""
import math

ALL_COLORS = ["yellow", "green", "red", "black", "blue", "orange", "purple", "white"]
# Lackfarben der Figuren/Felder (kräftig, aber nicht grell – wie lackiertes Holz)
PALETTE = {"yellow": "#f2c12e", "green": "#2f9e57", "red": "#d63a2f", "black": "#2b2f36",
           "blue": "#2f6fd0", "orange": "#ec7a1c", "purple": "#8a4fc4", "white": "#efe9dc"}
COLOR_NAMES = {"yellow": "Gelb", "green": "Grün", "red": "Rot", "black": "Schwarz",
               "blue": "Blau", "orange": "Orange", "purple": "Lila", "white": "Weiß"}
BOARD_RADIUS = 5.35          # runde Bretter: Radius in Tisch-Einheiten (lässt Platz für Würfel und Platzsets)


def colors_for(n: int) -> list:
    """Farben im Uhrzeigersinn = Zugreihenfolge. 6er: Gelb Grün Rot Schwarz Blau Orange; 8er: + Lila Weiß."""
    return ALL_COLORS[:n]


# Häuschen des Originals (Raster 11×11, Zeile/Spalte) in Arm-Koordinaten (entlang, quer) – je Farbe in der
# Reihenfolge h-<farbe>-0…3 wie im früheren Layout, damit gespeicherte Partien gleich bleiben
CLASSIC_HOME = {
    0: [(5, 5), (4, 5), (5, 4), (4, 4)],
    1: [(5, 4), (5, 5), (4, 4), (4, 5)],
    2: [(4, 4), (5, 4), (4, 5), (5, 5)],
    3: [(4, 5), (4, 4), (5, 5), (5, 4)],
}


def _geometry(n: int) -> dict:
    """Feldpositionen in Feld-Einheiten (x, z) für N Arme, Platz 0 bei +z."""
    alpha = 2 * math.pi / n
    a0 = 1 / math.tan(alpha / 2)          # Abstand der inneren Ecke von der Mitte (entlang des Arms); 4er: 1
    # Erster Schritt weg von der inneren Ecke: bei spitzen Ecken (8er) etwas länger, sonst berühren sich die Felder
    t1 = max(1.0, 1 / (2 * math.sin(alpha / 2)))

    def u(k):                              # Richtung von der Mitte zu Platz k
        a = k * alpha
        return (-math.sin(a), math.cos(a))

    def w(k):                              # quer zum Arm k, Richtung nächster Arm
        a = k * alpha
        return (-math.cos(a), -math.sin(a))

    def pt(k, along, lateral):
        (ux, uz), (wx, wz) = u(k % n), w(k % n)
        return (ux * along + wx * lateral, uz * along + wz * lateral)

    track = []
    for k in range(n):
        steps = (t1 + 3, t1 + 2, t1 + 1, t1)
        track += [pt(k, a0 + d, 1) for d in steps] + [pt(k, a0, 1)]   # Seite nach innen, beginnt mit dem Startfeld
        track += [pt(k + 1, a0 + d, -1) for d in reversed(steps)]     # Seite des nächsten Arms nach außen
        track.append(pt(k + 1, a0 + t1 + 3, 0))                        # Spitze des nächsten Arms
    goals = {k: [pt(k, a0 + t1 + 3 - d, 0) for d in (1, 2, 3, 4)] for k in range(n)}

    homes = {}
    for k in range(n):
        if n == 4:
            # wie das Original: 2×2-Block in der Ecke, an den Armen ausgerichtet (Reihenfolge wie im 11×11-Raster)
            homes[k] = [pt(k, along, lat) for along, lat in CLASSIC_HOME[k]]
            continue
        # zwischen den Armen auf der Winkelhalbierenden, zur Mitte ausgerichtet; so nah wie möglich, ohne Gedränge
        b = k * alpha + alpha / 2
        bx, bz = -math.sin(b), math.cos(b)
        px, pz = -bz, bx
        others = track + [p for g in goals.values() for p in g]
        r = 3.0
        while True:
            block = [(bx * (r + dr) + px * dp, bz * (r + dr) + pz * dp) for dr in (0.5, -0.5) for dp in (-0.5, 0.5)]
            if all(math.dist(p, q) >= 1.12 for p in block for q in others):
                break
            r += 0.05
        homes[k] = block
    return {"track": track, "goals": goals, "homes": homes}


def build_layout(n: int = 4) -> dict:
    colors = colors_for(n)
    geo = _geometry(n)
    if n == 4:
        spacing, shape = 0.8, "square"
        size = 11 * spacing + 0.9
    else:
        extent = max(math.hypot(x, z) for x, z in geo["track"] + [p for h in geo["homes"].values() for p in h])
        spacing = round(BOARD_RADIUS / (extent + 0.75), 4)
        shape, size = "round", 2 * BOARD_RADIUS

    def tab(p):
        return round(p[0] * spacing, 4), round(p[1] * spacing, 4)

    fields, pieces = {}, {}
    for i, p in enumerate(geo["track"]):
        x, z = tab(p)
        start = i % 10 == 0
        f = {"x": x, "z": z, "kind": "start" if start else "track", "index": i}
        if start:
            f["color"] = colors[i // 10]
        fields[f"t{i}"] = f
    for k, color in enumerate(colors):
        for j, p in enumerate(geo["goals"][k]):
            x, z = tab(p)
            fields[f"g-{color}-{j}"] = {"x": x, "z": z, "kind": "goal", "color": color, "index": j}
        for j, p in enumerate(geo["homes"][k]):
            x, z = tab(p)
            fields[f"h-{color}-{j}"] = {"x": x, "z": z, "kind": "home", "color": color, "index": j}
    for seat, color in enumerate(colors):
        for j in range(4):
            pieces[f"p-{color}-{j}"] = {"kind": "pawn", "seat": seat, "color": color, "field": f"h-{color}-{j}"}
    return {"board": {"kind": "mensch", "size": round(size, 4), "spacing": spacing, "shape": shape, "arms": n},
            "palette": {c: PALETTE[c] for c in colors}, "fields": fields, "pieces": pieces,
            "dice": {"count": 1, "sides": 6}}


LAYOUTS = {n: build_layout(n) for n in (4, 6, 8)}
LAYOUT = LAYOUTS[4]
COLORS = colors_for(4)               # klassisches Brett (ältere Aufrufer)
SPACING = 0.8
