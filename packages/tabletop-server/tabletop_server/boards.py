"""Bretter aus wenigen Zeilen (Engine 2.3) – passend zum Standard-Brett des Clients (packages/tabletop/src/boards/generic.ts).

    from tabletop_server.boards import grid, layout, tray
    fields = grid(8, 8, spacing=0.8, colors=("light", "dark"))         # Schach-/Damebrett, Felder "a1" … "h8"
    fields.update(tray("cap-0", 16, x=-4.2, z=0, cols=2))               # Ablage für geschlagene Steine
    LAYOUT = layout(fields, pieces, palette={"light": "#e9d6b0", "dark": "#7a4f2c", "white": "#f4efe6"},
                    cells="square")

Koordinaten: Tisch-Mitte = (0, 0), Platz 0 sitzt bei +z („unten“). Einheit ≈ 1 Feld beim Standard-Abstand 0,8.
Ein Spiel ohne eigenen Brett-Code bekommt damit automatisch ein Holzbrett mit gemalten Feldern, Linien und Ablagen.
"""
import math
import string
from typing import Callable, Dict, Iterable, List, Optional, Tuple

Field = Dict[str, object]


def square_name(col: int, row: int) -> str:
    """a1-Schreibweise (Spalte a…, Reihe 1… von Platz 0 aus gesehen)."""
    return f"{string.ascii_lowercase[col]}{row + 1}" if col < 26 else f"c{col}r{row}"


def grid(cols: int, rows: int, spacing: float = 0.8, colors: Optional[Tuple[str, str]] = None,
         name: Callable[[int, int], str] = square_name, kind: str = "square", cx: float = 0.0, cz: float = 0.0,
         skip: Optional[Callable[[int, int], bool]] = None) -> Dict[str, Field]:
    """Rechteckiges Raster. Reihe 0 liegt bei Platz 0 (vorn). colors=(hell, dunkel) → Schachbrett-Muster
    (a1 dunkel wie beim Schach). skip(col, row) → Feld weglassen (Kreuzbretter, Löcher)."""
    out: Dict[str, Field] = {}
    for r in range(rows):
        for c in range(cols):
            if skip and skip(c, r):
                continue
            f: Field = {"x": round(cx + (c - (cols - 1) / 2) * spacing, 4),
                        "z": round(cz + ((rows - 1) / 2 - r) * spacing, 4), "kind": kind, "col": c, "row": r}
            if colors:
                f["color"] = colors[1] if (c + r) % 2 == 0 else colors[0]
            out[name(c, r)] = f
    return out


def hexgrid(radius: int, spacing: float = 0.8, kind: str = "hex", pointy: bool = True) -> Dict[str, Field]:
    """Sechseck aus Sechseck-Feldern (axiale Koordinaten q, r; Name "q,r"); radius 2 → 19 Felder (wie Siedler-Inseln)."""
    out: Dict[str, Field] = {}
    for q in range(-radius, radius + 1):
        for r in range(max(-radius, -q - radius), min(radius, -q + radius) + 1):
            if pointy:
                x, z = spacing * (q + r / 2), spacing * r * math.sqrt(3) / 2
            else:
                x, z = spacing * q * math.sqrt(3) / 2, spacing * (r + q / 2)
            out[f"{q},{r}"] = {"x": round(x, 4), "z": round(z, 4), "kind": kind, "q": q, "r": r}
    return out


def ring_track(n: int, radius: float, prefix: str = "t", start_angle: float = 0.0, kind: str = "track",
               colors: Optional[Dict[int, str]] = None) -> Dict[str, Field]:
    """n Felder im Kreis (Laufspiele). Feld 0 liegt bei start_angle (0 = vor Platz 0), dann im Uhrzeigersinn."""
    out: Dict[str, Field] = {}
    for i in range(n):
        a = math.radians(start_angle) + 2 * math.pi * i / n
        f: Field = {"x": round(-math.sin(a) * radius, 4), "z": round(math.cos(a) * radius, 4), "kind": kind, "index": i}
        if colors and i in colors:
            f["color"] = colors[i]
        out[f"{prefix}{i}"] = f
    return out


def tray(prefix: str, count: int, x: float, z: float, cols: int = 2, spacing: float = 0.5,
         kind: str = "tray", visible: bool = False) -> Dict[str, Field]:
    """Ablage neben dem Brett (geschlagene Steine, Vorrat): count Plätze in einem kleinen Raster um (x, z).
    Unsichtbar gemalt (hidden), Figuren rasten trotzdem ein."""
    out: Dict[str, Field] = {}
    rows = math.ceil(count / cols)
    for i in range(count):
        c, r = i % cols, i // cols
        f: Field = {"x": round(x + (c - (cols - 1) / 2) * spacing, 4), "z": round(z + (r - (rows - 1) / 2) * spacing, 4),
                    "kind": kind}
        if not visible:
            f["hidden"] = True
        out[f"{prefix}-{i}"] = f
    return out


def seat_point(seat: int, seats: int, dist: float, angles: Optional[List[float]] = None) -> Tuple[float, float]:
    """Punkt vor einem Platz (für Ablagen „beim Spieler“). Gleiche Winkel wie am Tisch (Variant.seat_angles)."""
    a = math.radians(angles[seat] if angles else seat * 360 / seats)
    return round(-math.sin(a) * dist, 4), round(math.cos(a) * dist, 4)


def lines_between(fields: Dict[str, Field], pairs: Iterable[Tuple[str, str]]) -> List[List[str]]:
    """Linien für das Standard-Brett (Mühle, Laufspiele): nur Paare, deren Felder es gibt."""
    return [[a, b] for a, b in pairs if a in fields and b in fields]


def layout(fields: Dict[str, Field], pieces: Dict[str, dict], palette: Optional[Dict[str, str]] = None,
           spacing: float = 0.8, cells: str = "round", shape: str = "square", margin: float = 0.6,
           dice: Optional[dict] = None, lines: Optional[List[List[str]]] = None, wood: Optional[str] = None,
           size: Optional[float] = None, **board) -> dict:
    """Layout fürs Standard-Brett: Größe aus den sichtbaren Feldern + Rand. Weitere board-Angaben per **board."""
    shown = [f for f in fields.values() if not f.get("hidden")] or list(fields.values())
    if shown and size is None:
        if shape == "round":
            size = 2 * max(math.hypot(f["x"], f["z"]) for f in shown) + spacing + 2 * margin
        else:
            w = max(abs(f["x"]) for f in shown) * 2 + spacing + 2 * margin
            d = max(abs(f["z"]) for f in shown) * 2 + spacing + 2 * margin
            board.setdefault("w", round(w, 3))
            board.setdefault("d", round(d, 3))
            size = max(w, d)
    b = {"kind": board.pop("kind", "generic"), "size": round(size or 9.0, 3), "spacing": spacing, "cells": cells,
         "shape": shape, **board}
    if lines:
        b["lines"] = lines
    if wood:
        b["wood"] = wood
    out = {"board": b, "fields": fields, "pieces": pieces}
    if palette:
        out["palette"] = palette
    if dice:
        out["dice"] = dice
    return out
