"""Räume, Sitzplätze und Mitglieder am Spieltisch – spielneutral.

Protokoll (Server → Client):
  SNAPSHOT {seq, you, state}        voller Zustand (beim Verbinden; Client ersetzt seinen Stand)
  EVENT    {seq, event: {type, …}}  Änderung; seq zählt lückenlos hoch, Lücke → Client fordert SNAPSHOT
  PRESENCE {from, p}                Zeiger/„hält etwas“ eines anderen Mitglieds (ungeprüft, nicht gespeichert)
  ERROR    {code, message}          nur an den Absender
"""
import random
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

    layout: {"fields": {id: {x, z, kind, color?}}, "pieces": {id: {kind, seat, field}},
             "dice": {"count": 1, "sides": 6}}
      - Felder sind Ablageplätze mit Tisch-Koordinaten (Mitte = 0,0; Platz 0 sitzt bei +z).
      - Figuren gehören einem Sitzplatz (`seat`) und stehen anfangs auf `field`.
    """

    def __init__(self, game_id: str, title: str, seat_colors: List[str], min_players: int = 2,
                 layout: Optional[dict] = None, rules=None):
        self.id = game_id
        self.title = title
        self.seat_colors = list(seat_colors)   # Länge = Anzahl Sitzplätze
        self.min_players = min_players
        self.layout = layout or {"fields": {}, "pieces": {}}
        self.rules = rules                     # tabletop_server.rules.Rules oder None (freier Tisch)

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
        self.game_def = game
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
        self.last_roll: Optional[dict] = None
        self._rng = random.SystemRandom()       # Würfel: nicht vorhersagbar
        # Spielablauf (nur mit Regeln): lobby → playing → finished
        self.status = "lobby"
        self.game: Optional[dict] = None        # Spielstand der Regeln (wer dran ist, Würfe übrig, …)
        self.game_settings: dict = {}

    @property
    def rules(self):
        return self.game_def.rules

    def member_at(self, seat) -> Optional["Member"]:
        return next((m for m in self.members.values() if m.seat == seat), None)

    def _play_event(self) -> dict:
        return self.next_event({"type": "GAME_UPDATED", "status": self.status, "play": self.play_state()})

    def play_state(self) -> Optional[dict]:
        if not self.rules or self.game is None:
            return None
        return self.rules.public(self)

    # ---------- Zustand ----------
    def state(self) -> dict:
        return {
            "room": self.id,
            "game": {"id": self.game_def.id, "title": self.game_def.title, "seats": self.game_def.seats,
                     "seat_colors": self.game_def.seat_colors},
            "host_id": self.host_id,
            "members": [m.to_dict(self.game_def) for m in sorted(self.members.values(), key=lambda m: m.joined_at)],
            "layout": self.game_def.layout,
            "pieces": {pid: dict(p) for pid, p in self.pieces.items()},
            "last_roll": self.last_roll,
            "status": self.status if self.rules else None,
            "play": self.play_state(),
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
        return next((i for i in range(self.game_def.seats) if i not in taken), None)

    def join(self, member_id: str, name: str, wants_host: bool) -> List[dict]:
        """Beitreten bzw. zurückkehren. Gibt die zu sendenden Ereignisse zurück."""
        events = []
        m = self.members.get(member_id)
        if m is None:
            m = Member(member_id, clean_text(name, NAME_MAX, f"Gast {len(self.members) + 1}"))
            m.seat = self.free_seat() if self.status == "lobby" else None   # laufendes Spiel → zuschauen
            self.members[member_id] = m
            events.append(self.next_event({"type": "MEMBER_JOINED", "member": m.to_dict(self.game_def)}))
        else:
            changed = not m.connected
            m.connected, m.disconnected_at = True, None
            new_name = clean_text(name, NAME_MAX, m.name)
            if new_name != m.name:
                m.name, changed = new_name, True
            if changed:
                events.append(self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game_def)}))
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
        if m is None or not isinstance(seat, int) or not (0 <= seat < self.game_def.seats):
            return []
        if self.status != "lobby":
            return []                      # während des Spiels bleiben die Plätze, wie sie sind
        if any(o.seat == seat for o in self.members.values() if o.id != member_id):
            return []
        events = self.release_all(member_id)
        m.seat = seat
        return events + [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game_def)})]

    def stand_up(self, member_id: str) -> List[dict]:
        m = self.members.get(member_id)
        if m is None or m.seat is None or self.status != "lobby":
            return []
        events = self.release_all(member_id)
        m.seat = None
        return events + [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game_def)})]

    def disconnected(self, member_id: str) -> List[dict]:
        m = self.members.get(member_id)
        if m is None or not m.connected:
            return []
        m.connected, m.disconnected_at = False, time.time()
        return self.release_all(member_id) + [self.next_event({"type": "MEMBER_UPDATED", "member": m.to_dict(self.game_def)})]

    # ---------- Würfel ----------
    ROLL_LOCK_SEC = 1.5       # solange rollen die Würfel noch – kein zweiter Wurf

    def roll(self, member_id: str, power=None, now: Optional[float] = None, auto: bool = False) -> List[dict]:
        """Würfeln. Ergebnis bestimmt nur der Server; `throw` beschreibt den Wurf für die Animation
        (alle Clients simulieren mit denselben Startwerten). Ohne Regeln (M3): jeder, der sitzt."""
        now = time.time() if now is None else now
        m = self.members.get(member_id)
        spec = self.game_def.layout.get("dice") or {}
        if not m or (not m.connected and not auto) or m.seat is None or not spec:
            return []
        if self.last_roll and now - self.last_roll["at"] < self.ROLL_LOCK_SEC:
            return []
        if self.rules and self.status == "finished":
            return []
        if self.rules and self.status == "playing" and not self.rules.can_roll(self, m.seat):
            return []
        try:
            power = min(1.0, max(0.0, float(power)))
        except (TypeError, ValueError):
            power = 0.6
        if power != power:      # NaN
            power = 0.6
        sides, count = int(spec.get("sides", 6)), int(spec.get("count", 1))
        values = [self._rng.randint(1, sides) for _ in range(count)]
        throw = {"power": round(power, 3), "seed": self._rng.getrandbits(31), "seat": m.seat}
        self.last_roll = {"by": member_id, "values": values, "throw": throw, "at": now}
        events = [self.next_event({"type": "DICE_ROLLED", "by": member_id, "values": values, "throw": throw})]
        if self.rules and self.status == "playing":
            events += [self.next_event(e) for e in self.rules.on_roll(self, m.seat, values)]
            events.append(self._play_event())
        return events

    # ---------- Spielablauf (mit Regeln) ----------
    def add_bot(self, member_id: str, seat) -> List[dict]:
        """Host setzt einen Computer auf einen freien Platz (nur in der Lobby)."""
        if member_id != self.host_id or self.status != "lobby" or not isinstance(seat, int):
            return []
        if not (0 <= seat < self.game_def.seats) or self.member_at(seat):
            return []
        n = sum(1 for m in self.members.values() if m.is_bot) + 1
        bot = Member(f"bot_{seat}", f"Computer {n}")
        bot.is_bot, bot.seat = True, seat
        self.members[bot.id] = bot
        return [self.next_event({"type": "MEMBER_JOINED", "member": bot.to_dict(self.game_def)})]

    def remove_bot(self, member_id: str, seat) -> List[dict]:
        if member_id != self.host_id or self.status != "lobby":
            return []
        bot = self.member_at(seat)
        if not bot or not bot.is_bot:
            return []
        del self.members[bot.id]
        return [self.next_event({"type": "MEMBER_LEFT", "id": bot.id})]

    def start(self, member_id: str) -> List[dict]:
        if not self.rules or member_id != self.host_id or self.status != "lobby":
            return []
        players = [m for m in self.members.values() if m.seat is not None]
        if len(players) < max(self.rules.min_players, self.game_def.min_players):
            return []
        events = self.release_all_everyone()
        self.status = "playing"
        events += [self.next_event(e) for e in self.rules.setup(self)]
        self.last_roll = None
        return events + [self._play_event()]

    def new_round(self, member_id: str) -> List[dict]:
        """Zurück in die Lobby (Host), Figuren gehen beim nächsten Start ins Häuschen."""
        if not self.rules or member_id != self.host_id or self.status == "lobby":
            return []
        self.status = "lobby"
        self.game = None
        return [self._play_event()]

    def release_all_everyone(self) -> List[dict]:
        return [e for mid in list(self.members) for e in self.release_all(mid)]

    def bot_move(self, seat: int) -> List[dict]:
        """Computer (oder Vertretung eines Abwesenden) zieht."""
        if not self.rules or self.status != "playing":
            return []
        choice = self.rules.bot_move(self, seat)
        if not choice:
            return []
        evs = self.rules.move(self, seat, choice["piece"], choice["to"])
        if evs is None:
            return []
        mid = self.member_at(seat).id if self.member_at(seat) else "rules"
        out = []
        for e in evs:
            e.setdefault("by", mid)
            out.append(self.next_event(e))
        return out + [self._play_event()]

    # ---------- Figuren (M2: ohne Spielregeln) ----------
    def _may_touch(self, member_id: str, piece_id: str) -> bool:
        """Nur wer sitzt, nur Figuren des eigenen Platzes – mit Regeln zusätzlich nur im eigenen Zug."""
        m = self.members.get(member_id)
        spec = self.game_def.layout.get("pieces", {}).get(piece_id)
        if not (m and m.connected and m.seat is not None and spec and spec.get("seat") == m.seat):
            return False
        if self.rules:
            g = self.game or {}
            return self.status == "playing" and g.get("turn") == m.seat and g.get("phase") == "move"
        return True

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
        if self.rules:
            m = self.members.get(member_id)
            evs = self.rules.move(self, m.seat, piece_id, field_id) if isinstance(field_id, str) else None
            if evs is None:
                return self.release(member_id, piece_id)
            self.pieces[piece_id]["held_by"] = None
            out = []
            for e in evs:
                e.setdefault("by", member_id)
                out.append(self.next_event(e))
            return out + [self._play_event()]
        fields = self.game_def.layout.get("fields", {})
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
