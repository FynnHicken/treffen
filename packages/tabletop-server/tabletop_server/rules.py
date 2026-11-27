"""Schnittstelle zwischen Spieltisch und den Regeln eines Spiels.

Der Raum (rooms.py) kümmert sich um alles Spielneutrale: Lobby, Start, Sitzplätze, Bots, Würfel-Zufall,
Sperren, Ereignisnummern, Speichern. Ein Spiel liefert nur seine Regeln. Es gibt zwei Fassungen:

API 2 – `GameRules` (für neue Spiele, ab Engine 2.0)
-----------------------------------------------------
Alles, was ein Spieler tun kann, ist eine **Aktion** (ein Dict mit `type`). Der Tisch kennt diese Typen:

    {"type": "roll"}                                   Würfeln (Ergebnis bestimmt der Raum, kommt als "values")
    {"type": "move", "piece": id, "to": feld, ...}     Figur auf ein Feld ziehen (greifen + absetzen am Tisch)

Weitere Felder an einer Aktion (z. B. "path", "capture") reicht der Tisch durch. Neue Typen (Karten …)
kommen in späteren MINOR-Versionen dazu; bestehende Spiele merken davon nichts.

    class MeineRegeln(GameRules):
        def setup(self, room) -> list: ...                  # Anfangsaufstellung, room.game füllen
        def actions(self, room, seat) -> list: ...          # was dieser Platz gerade tun darf
        def apply(self, room, seat, action) -> list|None:   # Aktion ausführen; None = nicht erlaubt
        def view(self, room, seat) -> dict: ...             # was dieser Platz sieht (seat None = Zuschauer)

Optional: `to_move` (wer gerade handeln darf), `bot_action` (Wahl des Computers), `can_touch`.

Ereignisse, die Regeln zurückgeben, sind Dicts wie {"type": "PIECE_MOVED", ...}; der Raum nummeriert sie.
Figurenpositionen stehen in room.pieces[id]["field"]; Regeln ändern sie dort und melden PIECE_MOVED.
Wechselt eine Figur ihre Art (z. B. Bauer → Dame): room.pieces[id]["kind"] setzen und PIECE_CHANGED melden.

Damit der Tisch Zug und Ende anzeigen kann, gehören in den Spielstand (`view`):
  "turn": Platz am Zug (oder None), "phase": "over" am Ende, "result": {"winners": [Plätze], "reason": "..."}.

API 1 – `Rules` (Mensch ärgere dich nicht, Engine 1.x)
-------------------------------------------------------
    setup, can_roll, on_roll, moves, move, bot_move, public, wants_roll

Bleibt unterstützt: `LegacyRules` übersetzt sie in API 2. Ein Spiel muss beim Engine-Update nichts ändern.
"""
from typing import List, Optional


class GameRules:
    """Regeln nach API 2 (Aktionen). Basisklasse für neue Spiele."""

    #: Welche Fassung der Schnittstelle dieses Spiel spricht
    api_version: int = 2
    #: Raum-Einstellungen (Hausregeln) – {key: {"default": ..., "label": ..., "hint"?, "min"?, "max"?, "choices"?}}
    settings_schema: dict = {}
    #: Mindestzahl Spieler (Menschen + Computer) zum Starten
    min_players: int = 2
    #: True: alle sehen denselben Spielstand (view wird nur einmal berechnet, kein Geheimwissen)
    shared_view: bool = False

    def setup(self, room) -> List[dict]:
        raise NotImplementedError

    def actions(self, room, seat: int) -> List[dict]:
        raise NotImplementedError

    def apply(self, room, seat: int, action: dict) -> Optional[List[dict]]:
        raise NotImplementedError

    def view(self, room, seat: Optional[int]) -> dict:
        """Spielstand für einen Platz (None = Zuschauer). Standard: alles + die eigenen Züge."""
        g = dict(room.game or {})
        if seat is not None:
            g["moves"] = [{"piece": a["piece"], "to": a["to"]} for a in self.actions(room, seat) if a.get("type") == "move"]
        return g

    def to_move(self, room) -> List[int]:
        """Plätze, die gerade handeln dürfen (Standard: der Platz in game["turn"])."""
        t = (room.game or {}).get("turn")
        return [t] if t is not None else []

    def bot_action(self, room, seat: int) -> Optional[dict]:
        """Wahl des Computers. Standard: würfeln, wenn möglich, sonst die erste erlaubte Aktion."""
        acts = self.actions(room, seat)
        return next((a for a in acts if a.get("type") == "roll"), acts[0] if acts else None)

    def can_touch(self, room, seat: int, piece: str) -> bool:
        """Darf dieser Platz die Figur gerade greifen? Standard: wenn es einen Zug mit ihr gibt."""
        return any(a.get("type") == "move" and a.get("piece") == piece for a in self.actions(room, seat))


class Rules:
    """Regeln nach API 1 (würfeln/ziehen, ein Platz am Zug). Für bestehende Spiele – neue Spiele: GameRules."""
    api_version: int = 1
    settings_schema: dict = {}
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


class LegacyRules(GameRules):
    """Übersetzt API-1-Regeln in API 2 – Verhalten (und Protokoll) genau wie in Engine 1.x."""
    shared_view = True

    def __init__(self, inner: Rules):
        self.inner = inner
        self.api_version = getattr(inner, "api_version", 1)
        self.settings_schema = getattr(inner, "settings_schema", {}) or {}
        self.min_players = getattr(inner, "min_players", 2)

    def __getattr__(self, name):
        # Alles andere (moves, on_roll, eigene Hilfen …) wie bisher an den Original-Regeln – Spiele und ihre
        # Tests, die room.rules direkt benutzen, laufen so unverändert weiter.
        if name == "inner":
            raise AttributeError(name)
        return getattr(self.inner, name)

    def setup(self, room):
        return self.inner.setup(room)

    def actions(self, room, seat):
        acts = [{"type": "roll"}] if self.inner.can_roll(room, seat) else []
        g = room.game or {}
        if g.get("phase") == "move" and g.get("turn") == seat:
            acts += [{"type": "move", **m} for m in self.inner.moves(room, seat)]
        return acts

    def apply(self, room, seat, action):
        t = action.get("type")
        if t == "roll":
            return self.inner.on_roll(room, seat, list(action.get("values") or []))
        if t == "move":
            return self.inner.move(room, seat, action.get("piece"), action.get("to"))
        return None

    def view(self, room, seat):
        return self.inner.public(room)

    def to_move(self, room):
        s = self.inner.current_seat(room)
        return [s] if s is not None else []

    def bot_action(self, room, seat):
        if self.inner.wants_roll(room, seat):
            return {"type": "roll"}
        m = self.inner.bot_move(room, seat)
        return {"type": "move", "piece": m["piece"], "to": m["to"]} if m else None

    def can_touch(self, room, seat, piece):
        g = room.game or {}
        return g.get("turn") == seat and g.get("phase") == "move"


def as_game_rules(rules) -> Optional[GameRules]:
    """Regeln eines Spiels in API 2 bringen (API 1 wird übersetzt). Unbekannte Fassung → Fehler beim Start."""
    from .version import SUPPORTED_RULES_APIS
    if rules is None or isinstance(rules, GameRules):
        api = getattr(rules, "api_version", 2) if rules is not None else None
        if api is not None and api not in SUPPORTED_RULES_APIS:
            raise ValueError(f"Regel-API {api} wird von dieser Engine nicht unterstützt ({SUPPORTED_RULES_APIS})")
        return rules
    if isinstance(rules, Rules) or getattr(rules, "api_version", 1) == 1:
        return LegacyRules(rules)
    raise ValueError("Unbekannte Regel-Klasse")
