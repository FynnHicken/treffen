"""Mau-Mau: Spielmatte in der Mitte (Stapel + Ablage), je Platz eine Hand – alles aus Engine-Bausteinen."""
from tabletop_server.boards import layout, seat_point
from tabletop_server.cards import card_pieces, french_deck, zone

CARDS = french_deck(32)
PALETTE = {"felt": "#2f5d46"}
SEAT_COLORS_ALL = ["#e0b440", "#3c9660", "#c0453a", "#3a68b5", "#9b59b6", "#e67e22"]
HAND_DIST = 4.55


def build_layout(seats: int) -> dict:
    fields = {"deck": zone(-0.55, 0, "stack", up=False), "pile": zone(0.55, 0, "stack", up=True)}
    for s in range(seats):
        x, z = seat_point(s, seats, HAND_DIST)
        fields[f"hand-{s}"] = zone(x, z, "hand", owner=s, angle=s * 360 / seats)
    out = layout(fields, card_pieces(len(CARDS), "deck"), spacing=0.9, shape="round", size=3.4,
                 wood="#2f5d46", kind="felt", surface="felt")
    out["cards"] = CARDS
    out["card_back"] = {"color": "#7a1f2b", "pattern": "#e8c77a"}
    return out


LAYOUTS = {n: build_layout(n) for n in (4, 6)}
