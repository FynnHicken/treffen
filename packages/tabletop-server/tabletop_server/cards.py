"""Karten, Stapel und Hände (Engine 2.4) – Bausteine für Kartenspiele am Spieltisch.

Zonen sind Felder mit `zone` (mehrere Gegenstände auf einem Feld, geordnet):
    "stack"  Stapel (Nachziehstapel verdeckt, Ablage offen) – liegen übereinander, oben = höchste `order`
    "hand"   Hand eines Platzes (`owner`) – aufgefächert am Platz, nur der Besitzer sieht die Vorderseiten
    "row"    Auslage in einer Reihe (offen) – z. B. Karten in der Tischmitte
Felder: {"x", "z", "kind", "zone", "owner"?, "up"? (Karten liegen hier offen), "angle"? (Hand: Blickrichtung in Grad)}

Eine Karte ist eine Figur mit `kind: "card"`. **Was** auf ihr steht (`face`), kennt nur der Server; Spieler erfahren
es nur, wenn sie es sehen dürfen (offen liegend, oder in der eigenen Hand). Deshalb steht `face` nie im Layout.
Beim Mischen tauscht der Server die Vorderseiten zwischen den Karten des Stapels – wer sich eine Karten-ID gemerkt
hat, weiß danach nichts mehr.

    from tabletop_server.cards import french_deck, card_pieces, deal_new, top, pieces_on
    CARDS = french_deck(32)                                # {"♥7": {"rank": "7", "suit": "♥", "color": "#c62828"}, …}
    layout = boards.layout(fields, card_pieces(len(CARDS), "deck"), cards=CARDS)
    # in setup():  events = deal_new(room, "deck", list(CARDS))      # alle Karten gemischt verdeckt auf den Stapel
    #              events += room.move_piece(top(room, "deck"), "hand-0")

Katalog `layout["cards"]`: face → {rank, suit, color, title?, text?, icon?, bg?} – zeichnet die Engine als Kartenbild.
Rückseite: `layout["card_back"] = {"color": "#1f4e79", "pattern": "#d9c48a"}` (optional).
"""
import random
from typing import Dict, List, Optional

SUITS = {"♣": ("Kreuz", "#1b1b1b"), "♠": ("Pik", "#1b1b1b"), "♥": ("Herz", "#c62828"), "♦": ("Karo", "#c62828")}
RANKS_32 = ["7", "8", "9", "10", "B", "D", "K", "A"]
RANKS_52 = ["2", "3", "4", "5", "6"] + RANKS_32
RANK_NAMES = {"B": "Bube", "D": "Dame", "K": "König", "A": "Ass"}


def french_deck(size: int = 32) -> Dict[str, dict]:
    """Französisches Blatt (32 = Skat/Mau-Mau, 52 = Rommé/Poker). Reihenfolge: Farbe, dann Wert."""
    ranks = RANKS_32 if size == 32 else RANKS_52
    return {f"{s}{r}": {"rank": r, "suit": s, "color": c} for s, (_, c) in SUITS.items() for r in ranks}


def card_name(face: str, catalog: Optional[Dict[str, dict]] = None) -> str:
    """„Herz Dame“ – für Hinweise."""
    c = (catalog or {}).get(face) or {}
    if "title" in c:
        return c["title"]
    suit, rank = c.get("suit", face[:1]), c.get("rank", face[1:])
    return f"{SUITS.get(suit, (suit,))[0]} {RANK_NAMES.get(rank, rank)}"


def card_pieces(count: int, field: str, prefix: str = "k") -> Dict[str, dict]:
    """`count` Karten (ohne Vorderseite) auf einem Startfeld – Vorderseiten verteilt deal_new zur Laufzeit."""
    return {f"{prefix}{i}": {"kind": "card", "seat": None, "field": field, "order": i} for i in range(count)}


def zone(x: float, z: float, kind: str, owner: Optional[int] = None, up: bool = False,
         angle: Optional[float] = None, **extra) -> dict:
    """Feld einer Zone: zone("stack"|"hand"|"row")."""
    f = {"x": round(x, 4), "z": round(z, 4), "kind": kind, "zone": kind, "up": up, **extra}
    if owner is not None:
        f["owner"] = owner
    if angle is not None:
        f["angle"] = angle
    return f


def pieces_on(room, field: str) -> List[str]:
    """Gegenstände auf einem Feld, unten → oben."""
    return sorted((pid for pid, p in room.pieces.items() if p["field"] == field),
                  key=lambda pid: (room.pieces[pid].get("order", 0), pid))


def top(room, field: str) -> Optional[str]:
    ps = pieces_on(room, field)
    return ps[-1] if ps else None


def faces_on(room, field: str) -> List[str]:
    return [room.pieces[pid].get("face") for pid in pieces_on(room, field)]


def face(room, pid: str) -> Optional[str]:
    return room.pieces[pid].get("face")


def deal_new(room, field: str, faces: List[str], rng: Optional[random.Random] = None) -> List[dict]:
    """Neue Runde: alle Karten-Figuren bekommen (gemischt) Vorderseiten und liegen verdeckt auf `field`."""
    rng = rng or random.SystemRandom()
    cards = [pid for pid, spec in room.layout["pieces"].items() if spec.get("kind") == "card"]
    faces = list(faces)
    rng.shuffle(faces)
    events = []
    for i, pid in enumerate(cards):
        events += room.move_piece(pid, field, up=False, reason="reset", by="rules")
        room.pieces[pid]["face"] = faces[i] if i < len(faces) else None
        room.pieces[pid]["order"] = i
    events.append({"type": "STACK_SHUFFLED", "field": field,
                   "order": {pid: room.pieces[pid]["order"] for pid in cards}})
    return events


def shuffle(room, field: str, rng: Optional[random.Random] = None) -> List[dict]:
    """Stapel mischen: neue Reihenfolge und – wichtig – Vorderseiten zwischen den Karten tauschen."""
    rng = rng or random.SystemRandom()
    ids = pieces_on(room, field)
    faces = [room.pieces[p].get("face") for p in ids]
    rng.shuffle(faces)
    for pid, f in zip(ids, faces):
        room.pieces[pid]["face"] = f
    rng.shuffle(ids)
    for i, pid in enumerate(ids):
        room.pieces[pid]["order"] = i
    return [{"type": "STACK_SHUFFLED", "field": field, "order": {pid: room.pieces[pid]["order"] for pid in ids}}]
