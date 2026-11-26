"""Räume, Sitzplätze und Mitglieder am Spieltisch – spielneutral.

Protokoll (Server → Client):
  SNAPSHOT {seq, you, state}        voller Zustand (beim Verbinden; Client ersetzt seinen Stand)
  EVENT    {seq, event: {type, …}}  Änderung; seq zählt lückenlos hoch, Lücke → Client fordert SNAPSHOT
  PRESENCE {from, p}                Zeiger/„hält etwas“ eines anderen Mitglieds (ungeprüft, nicht gespeichert)
  ERROR    {code, message}          nur an den Absender
"""
import re
import time
from typing import Dict, List, Optional

NAME_MAX = 24
_UNSAFE = re.compile(r"[<>\"'`&\x00-\x1f]")


def clean_text(value, max_len: int, fallback: str = "") -> str:
    if not isinstance(value, str):
        return fallback
    cleaned = _UNSAFE.sub("", value).strip()[:max_len]
    return cleaned or fallback


class GameDef:
    """Was der Tisch über ein Spiel wissen muss (Regeln kommen in M4 dazu)."""

    def __init__(self, game_id: str, title: str, seat_colors: List[str], min_players: int = 2):
        self.id = game_id
        self.title = title
        self.seat_colors = list(seat_colors)   # Länge = Anzahl Sitzplätze
        self.min_players = min_players

    @property
    def seats(self) -> int:
        return len(self.seat_colors)


class Member:
    def __init__(self, member_id: str, name: str):
        self.id = member_id
        self.name = name
        self.seat: Optional[int] = None        # None = Zuschauer
        self.connected = True
        self.is_bot = False
        self.joined_at = time.time()
        self.disconnected_at: Optional[float] = None

    def to_dict(self, game: GameDef) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "seat": self.seat,
            "color": game.seat_colors[self.seat] if self.seat is not None else "#9ca3af",
            "connected": self.connected,
            "is_bot": self.is_bot,
        }


class Room:
    def __init__(self, room_id: str, game: GameDef):
        self.id = room_id
        self.game = game
        self.seq = 0
        self.members: Dict[str, Member] = {}
        self.host_id: Optional[str] = None
        self.host_claimed = False          # Host per Hub-Ticket bestätigt → nicht mehr überschreibbar
        self.secrets: Dict[str, str] = {}  # member_id -> sha256(Client-Secret)
        self.created_at = time.time()
        self.empty_since: Optional[float] = time.time()

    # ---------- Zustand ----------
    def state(self) -> dict:
        return {
            "room": self.id,
            "game": {"id": self.game.id, "title": self.game.title, "seats": self.game.seats,
                     "seat_colors": self.game.seat_colors},
            "host_id": self.host_id,
            "members": [m.to_dict(self.game) for m in sorted(self.members.values(), key=lambda m: m.joined_at)],
        }

    def next_event(self, event: dict) -> dict:
        self.seq += 1
        return {"type": "EVENT", "seq": self.seq, "event": event}

    def snapshot_for(self, member_id: str) -> dict:
        # Ab M4: geheime Infos pro Mitglied filtern (Rules.view_for)
        return {"type": "SNAPSHOT", "seq": self.seq, "you": member_id, "state": self.state()}

    # ---------- Mitglieder ----------
    def free_seat(self) -> Optional[int]:
        taken = {m.seat for m in self.members.values() if m.seat is not None}
        return next((i for i in range(self.game.seats) if i not in taken), None)

    def join(self, member_id: str, name: str, wants_host: bool) -> List[dict]:
        """Beitreten bzw. zurückkehren. Gibt die zu sendenden Ereignisse zurück."""
        events = []
        m = self.members.get(member_id)
        if m is None:
            m = Member(member_id, clean_text(name, NAME_MAX, f"Gast {len(self.members) + 1}"))
            m.seat = self.free_seat()
            self.members[member_id] = m
            events.append(self.next_event({"type": "MEMBER_JOINED", "member": m.to_dict(self.game)}))
        else:
            changed = not m.connected
            m.connected, m.disconnected_at = True, None
            new_name = clean_text(name, NAME_MAX, m.name)
            if new_name != m.name:
                m.name, changed = new_name, True
            if changed:
                events.append(self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game)}))
        if wants_host and not self.host_claimed:
            self.host_claimed = True
            if self.host_id != member_id:
                self.host_id = member_id
                events.append(self.next_event({"type": "HOST_CHANGED", "host_id": member_id}))
        elif self.host_id is None or self.host_id not in self.members:
            self.host_id = member_id
            events.append(self.next_event({"type": "HOST_CHANGED", "host_id": member_id}))
        return events

    def sit(self, member_id: str, seat) -> List[dict]:
        m = self.members.get(member_id)
        if m is None or not isinstance(seat, int) or not (0 <= seat < self.game.seats):
            return []
        if any(o.seat == seat for o in self.members.values() if o.id != member_id):
            return []
        m.seat = seat
        return [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game)})]

    def stand_up(self, member_id: str) -> List[dict]:
        m = self.members.get(member_id)
        if m is None or m.seat is None:
            return []
        m.seat = None
        return [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game)})]

    def disconnected(self, member_id: str) -> List[dict]:
        m = self.members.get(member_id)
        if m is None or not m.connected:
            return []
        m.connected, m.disconnected_at = False, time.time()
        return [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game)})]

    def remove_stale(self, older_than_sec: float) -> List[dict]:
        """Lange getrennte Mitglieder entfernen (Platz wird frei), Host ggf. weitergeben."""
        now, events = time.time(), []
        for m in list(self.members.values()):
            if not m.connected and m.disconnected_at and now - m.disconnected_at >= older_than_sec:
                del self.members[m.id]
                events.append(self.next_event({"type": "MEMBER_LEFT", "id": m.id}))
        if self.host_id not in self.members:
            successor = next((m for m in sorted(self.members.values(), key=lambda m: m.joined_at)
                              if m.connected and not m.is_bot), None)
            new_host = successor.id if successor else None
            if new_host != self.host_id:
                self.host_id = new_host
                events.append(self.next_event({"type": "HOST_CHANGED", "host_id": new_host}))
        return events
