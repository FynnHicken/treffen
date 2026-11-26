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
    """Was der Tisch über ein Spiel wissen muss (Regeln kommen in M4 dazu).

    layout: {"fields": {id: {x, z, kind, color?}}, "pieces": {id: {kind, seat, field}}}
      - Felder sind Ablageplätze mit Tisch-Koordinaten (Mitte = 0,0; Platz 0 sitzt bei +z).
      - Figuren gehören einem Sitzplatz (`seat`) und stehen anfangs auf `field`.
    """

    def __init__(self, game_id: str, title: str, seat_colors: List[str], min_players: int = 2,
                 layout: Optional[dict] = None):
        self.id = game_id
        self.title = title
        self.seat_colors = list(seat_colors)   # Länge = Anzahl Sitzplätze
        self.min_players = min_players
        self.layout = layout or {"fields": {}, "pieces": {}}

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
        # Gegenstände auf dem Tisch: Figur -> {field, held_by}
        self.pieces: Dict[str, dict] = {
            pid: {"field": p["field"], "held_by": None} for pid, p in game.layout.get("pieces", {}).items()
        }

    # ---------- Zustand ----------
    def state(self) -> dict:
        return {
            "room": self.id,
            "game": {"id": self.game.id, "title": self.game.title, "seats": self.game.seats,
                     "seat_colors": self.game.seat_colors},
            "host_id": self.host_id,
            "members": [m.to_dict(self.game) for m in sorted(self.members.values(), key=lambda m: m.joined_at)],
            "layout": self.game.layout,
            "pieces": {pid: dict(p) for pid, p in self.pieces.items()},
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
        events = self.release_all(member_id)
        m.seat = seat
        return events + [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game)})]

    def stand_up(self, member_id: str) -> List[dict]:
        m = self.members.get(member_id)
        if m is None or m.seat is None:
            return []
        events = self.release_all(member_id)
        m.seat = None
        return events + [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game)})]

    def disconnected(self, member_id: str) -> List[dict]:
        m = self.members.get(member_id)
        if m is None or not m.connected:
            return []
        m.connected, m.disconnected_at = False, time.time()
        return self.release_all(member_id) + [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game)})]

    # ---------- Figuren (M2: ohne Spielregeln) ----------
    def _may_touch(self, member_id: str, piece_id: str) -> bool:
        """Ohne Regeln gilt: Nur wer sitzt, und nur Figuren des eigenen Platzes."""
        m = self.members.get(member_id)
        spec = self.game.layout.get("pieces", {}).get(piece_id)
        return bool(m and m.connected and m.seat is not None and spec and spec.get("seat") == m.seat)

    def grab(self, member_id: str, piece_id) -> List[dict]:
        if not isinstance(piece_id, str) or piece_id not in self.pieces or not self._may_touch(member_id, piece_id):
            return []
        p = self.pieces[piece_id]
        if p["held_by"] not in (None, member_id):
            return []
        # Man hält höchstens eine Figur gleichzeitig
        events = [e for other in self.pieces if other != piece_id and self.pieces[other]["held_by"] == member_id
                  for e in self.release(member_id, other)]
        if p["held_by"] == member_id:
            return events
        p["held_by"] = member_id
        return events + [self.next_event({"type": "PIECE_GRABBED", "piece": piece_id, "by": member_id})]

    def release(self, member_id: str, piece_id) -> List[dict]:
        p = self.pieces.get(piece_id) if isinstance(piece_id, str) else None
        if not p or p["held_by"] != member_id:
            return []
        p["held_by"] = None
        return [self.next_event({"type": "PIECE_RELEASED", "piece": piece_id})]

    def release_all(self, member_id: str) -> List[dict]:
        return [e for pid in list(self.pieces) for e in self.release(member_id, pid)]

    def drop(self, member_id: str, piece_id, field_id) -> List[dict]:
        """Absetzen auf ein Feld. Ungültig → Figur wird nur losgelassen (gleitet beim Client zurück)."""
        p = self.pieces.get(piece_id) if isinstance(piece_id, str) else None
        if not p or p["held_by"] != member_id:
            return []
        fields = self.game.layout.get("fields", {})
        occupied = any(o["field"] == field_id for oid, o in self.pieces.items() if oid != piece_id)
        if not isinstance(field_id, str) or field_id not in fields or occupied or field_id == p["field"]:
            return self.release(member_id, piece_id)
        frm = p["field"]
        p["field"], p["held_by"] = field_id, None
        return [self.next_event({"type": "PIECE_MOVED", "piece": piece_id, "from": frm, "to": field_id, "by": member_id})]

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
