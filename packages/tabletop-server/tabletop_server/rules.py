"""Schnittstelle zwischen Spieltisch und den Regeln eines Spiels.

Der Raum (rooms.py) kümmert sich um alles Spielneutrale: Lobby, Start, Sitzplätze, Bots, wer am Zug ist,
Würfel-Zufall, Sperren, Ereignisnummern. Ein Spiel liefert nur das hier:

    class MyRules(Rules):
        def setup(self, room): ...                       # Anfangsaufstellung, room.game füllen
        def can_roll(self, room, seat) -> bool: ...
        def on_roll(self, room, seat, values) -> list: ...   # Folgen eines Wurfs (Ereignisse ohne seq)
        def moves(self, room, seat) -> list: ...         # erlaubte Züge [{piece, to, path, capture?}]
        def move(self, room, seat, piece, to) -> list|None: ...  # None = nicht erlaubt
        def bot_move(self, room, seat) -> dict|None: ... # Wahl des Computers aus moves()
        def public(self, room) -> dict: ...              # was alle sehen dürfen (Zug, Würfe übrig, Züge …)

Ereignisse, die Regeln zurückgeben, sind Dicts wie {"type": "PIECE_MOVED", ...}; der Raum nummeriert sie.
Figurenpositionen stehen in room.pieces[id]["field"]; Regeln ändern sie dort und melden PIECE_MOVED.
"""
from typing import List, Optional


class Rules:
    #: Raum-Einstellungen (Hausregeln) – {key: {"default": ..., "label": ...}}
    settings_schema: dict = {}
    #: Mindestzahl Spieler (Menschen + Computer) zum Starten
    min_players: int = 2

    def setup(self, room) -> List[dict]:
        raise NotImplementedError

    def can_roll(self, room, seat: int) -> bool:
        raise NotImplementedError

    def on_roll(self, room, seat: int, values: List[int]) -> List[dict]:
        raise NotImplementedError

    def moves(self, room, seat: int) -> List[dict]:
        raise NotImplementedError

    def move(self, room, seat: int, piece: str, to: str) -> Optional[List[dict]]:
        raise NotImplementedError

    def bot_move(self, room, seat: int) -> Optional[dict]:
        ms = self.moves(room, seat)
        return ms[0] if ms else None

    def public(self, room) -> dict:
        return dict(room.game or {})

    def current_seat(self, room) -> Optional[int]:
        return (room.game or {}).get("turn")

    def wants_roll(self, room, seat: int) -> bool:
        """Für den Bot-Treiber: Soll dieser Platz jetzt würfeln (sonst: ziehen)?"""
        return self.can_roll(room, seat)
