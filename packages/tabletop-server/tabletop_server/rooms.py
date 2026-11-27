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

from .rules import as_game_rules
from .version import ENGINE_VERSION

NAME_MAX = 24
_UNSAFE = re.compile(r"[<>\"'`&\x00-\x1f]")


def clean_text(value, max_len: int, fallback: str = "") -> str:
    if not isinstance(value, str):
        return fallback
    cleaned = _UNSAFE.sub("", value).strip()[:max_len]
    return cleaned or fallback


class GameDef:
    """Was der Tisch über ein Spiel wissen muss.

    layout: {"fields": {id: {x, z, kind, color?}}, "pieces": {id: {kind, seat, field}},
             "dice": {"count": 1, "sides": 6}}
      - Felder sind Ablageplätze mit Tisch-Koordinaten (Mitte = 0,0; Platz 0 sitzt bei +z).
      - Figuren gehören einem Sitzplatz (`seat`) und stehen anfangs auf `field`.
    rules: GameRules (API 2) oder Rules (API 1, wird übersetzt) oder None (freier Tisch).
    version: Version des Spiels selbst (SemVer) – steht mit der Engine-Version in /api/health und im Client.
    """

    def __init__(self, game_id: str, title: str, seat_colors: List[str], min_players: int = 2,
                 layout: Optional[dict] = None, rules=None, version: str = "1.0.0"):
        self.id = game_id
        self.title = title
        self.version = version
        self.seat_colors = list(seat_colors)   # Länge = Anzahl Sitzplätze
        self.min_players = min_players
        self.layout = layout or {"fields": {}, "pieces": {}}
        self.rules = as_game_rules(rules)      # immer API 2 (oder None)

    @property
    def rules_api(self) -> Optional[int]:
        return self.rules.api_version if self.rules else None

    def info(self) -> dict:
        """Versionen für Client, Hub und Fehlersuche."""
        return {"id": self.id, "title": self.title, "version": self.version,
                "engine": ENGINE_VERSION, "rules_api": self.rules_api}

    @property
    def seats(self) -> int:
        return len(self.seat_colors)


HUB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
HUB_AVATAR_RE = re.compile(r"^/party-ws/avatar/[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,64}\.svg$")


def hub_avatar_url(room_id: str, hub_pid) -> Optional[str]:
    """Avatar-Bild des Hubs (party-server rendert es aus Gesicht + Farbe); .json daneben für Canvas."""
    if not isinstance(hub_pid, str) or not HUB_ID_RE.match(hub_pid) or not HUB_ID_RE.match(room_id or ""):
        return None
    return f"/party-ws/avatar/{room_id}/{hub_pid}.svg"


def hub_avatar_url_checked(value) -> Optional[str]:
    return value if isinstance(value, str) and HUB_AVATAR_RE.match(value) else None


class Member:
    def __init__(self, member_id: str, name: str):
        self.id = member_id
        self.name = name
        self.seat: Optional[int] = None        # None = Zuschauer
        self.connected = True
        self.is_bot = False
        self.joined_at = time.time()
        self.disconnected_at: Optional[float] = None
        self.avatar: Optional[str] = None      # Bild-URL aus dem Hub (party-server), nur mit Ticket

    def to_dict(self, game: GameDef) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "seat": self.seat,
            "color": game.seat_colors[self.seat] if self.seat is not None else "#9ca3af",
            "connected": self.connected,
            "is_bot": self.is_bot,
            "avatar": self.avatar,
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
        """GAME_UPDATED – bei Spielen mit Geheimwissen mit einer Ansicht je Platz (`views`, nur für den Versand;
        app.py schickt jedem Mitglied nur seine eigene als `play`)."""
        ev = {"type": "GAME_UPDATED", "status": self.status, "play": self.play_state()}
        if self.rules and not self.rules.shared_view and self.game is not None:
            ev["views"] = {str(seat): self.play_state(seat) for seat in range(self.game_def.seats)}
        return self.next_event(ev)

    def play_state(self, seat: Optional[int] = None) -> Optional[dict]:
        """Spielstand aus Sicht eines Platzes (None = Zuschauer)."""
        if not self.rules or self.game is None:
            return None
        return self.rules.view(self, None if self.rules.shared_view else seat)

    def seat_of(self, member_id: str) -> Optional[int]:
        m = self.members.get(member_id)
        return m.seat if m else None

    def personalize(self, msg: dict, member_id: str) -> dict:
        """Nachricht für ein Mitglied: aus `views` die eigene Ansicht als `play` einsetzen."""
        ev = msg.get("event") if msg.get("type") == "EVENT" else None
        if not ev or "views" not in ev:
            return msg
        seat = self.seat_of(member_id)
        ev = {k: v for k, v in ev.items() if k != "views"}
        if seat is not None:
            ev["play"] = msg["event"]["views"].get(str(seat), ev.get("play"))
        return {**msg, "event": ev}

    # ---------- Zustand ----------
    def state(self, seat: Optional[int] = None) -> dict:
        return {
            "room": self.id,
            "game": {**self.game_def.info(), "seats": self.game_def.seats, "seat_colors": self.game_def.seat_colors},
            "host_id": self.host_id,
            "members": [m.to_dict(self.game_def) for m in sorted(self.members.values(), key=lambda m: m.joined_at)],
            "layout": self.game_def.layout,
            "pieces": {pid: dict(p) for pid, p in self.pieces.items()},
            "last_roll": self.last_roll,
            "status": self.status if self.rules else None,
            "play": self.play_state(seat),
            "settings": self.settings(),
            "settings_schema": self.settings_schema(),
        }

    def next_event(self, event: dict) -> dict:
        self.seq += 1
        return {"type": "EVENT", "seq": self.seq, "event": event}

    def snapshot_for(self, member_id: str) -> dict:
        return {"type": "SNAPSHOT", "seq": self.seq, "you": member_id, "state": self.state(self.seat_of(member_id))}

    # ---------- Mitglieder ----------
    def free_seat(self) -> Optional[int]:
        taken = {m.seat for m in self.members.values() if m.seat is not None}
        return next((i for i in range(self.game_def.seats) if i not in taken), None)

    def join(self, member_id: str, name: str, wants_host: bool, hub: Optional[tuple] = None) -> List[dict]:
        """Beitreten bzw. zurückkehren. Gibt die zu sendenden Ereignisse zurück.
        hub: (Raum, Spieler-ID) im Hub aus dem geprüften Ticket – daraus wird die Avatar-URL."""
        events = []
        avatar = hub_avatar_url(*hub) if hub else None
        m = self.members.get(member_id)
        if m is None:
            m = Member(member_id, clean_text(name, NAME_MAX, f"Gast {len(self.members) + 1}"))
            m.seat = self.free_seat() if self.status == "lobby" else None   # laufendes Spiel → zuschauen
            m.avatar = avatar
            self.members[member_id] = m
            events.append(self.next_event({"type": "MEMBER_JOINED", "member": m.to_dict(self.game_def)}))
        else:
            changed = not m.connected or (avatar is not None and avatar != m.avatar)
            if avatar is not None:
                m.avatar = avatar
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
        if self.rules and self.status == "playing" and not self.can_roll(m.seat):
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
            evs = self.rules.apply(self, m.seat, {"type": "roll", "values": values}) or []
            events += [self.next_event(e) for e in evs]
            events.append(self._play_event())
        return events

    def can_roll(self, seat) -> bool:
        if not self.rules or self.status != "playing" or seat is None:
            return False
        return any(a.get("type") == "roll" for a in self.rules.actions(self, seat))

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

    # ---------- Raum-Einstellungen (Hausregeln) ----------
    def settings_schema(self) -> dict:
        """Was der Host einstellen kann: {key: {default, label, min?, max?, choices?}} aus den Regeln."""
        return dict(getattr(self.rules, "settings_schema", None) or {})

    def settings(self) -> dict:
        """Aktuelle Werte – fehlende/ungültige fallen auf den Standard zurück."""
        out = {}
        for key, spec in self.settings_schema().items():
            v = self.game_settings.get(key, spec.get("default"))
            out[key] = v if valid_setting(spec, v) else spec.get("default")
        return out

    def set_settings(self, member_id: str, values) -> List[dict]:
        """Host ändert Hausregeln – nur in der Lobby, nur bekannte Schlüssel mit gültigem Wert."""
        if member_id != self.host_id or self.status != "lobby" or not isinstance(values, dict):
            return []
        schema = self.settings_schema()
        changed = False
        for key, v in values.items():
            spec = schema.get(key)
            if spec is None or not valid_setting(spec, v) or self.settings().get(key) == v:
                continue
            self.game_settings[key] = v
            changed = True
        if not changed:
            return []
        return [self.next_event({"type": "SETTINGS_UPDATED", "settings": self.settings()})]

    # ---------- Speichern/Wiederherstellen (persistence.py) ----------
    SAVE_VERSION = 1

    def to_saved(self) -> dict:
        return {
            "v": self.SAVE_VERSION, "id": self.id, "game": self.game_def.id, "seq": self.seq,
            "host_id": self.host_id, "host_claimed": self.host_claimed, "secrets": dict(self.secrets),
            "members": [{"id": m.id, "name": m.name, "seat": m.seat, "is_bot": m.is_bot, "joined_at": m.joined_at,
                         "avatar": m.avatar}
                        for m in self.members.values()],
            "pieces": {pid: ({"field": p["field"], "kind": p["kind"]} if p.get("kind") else {"field": p["field"]})
                       for pid, p in self.pieces.items()},
            "last_roll": self.last_roll, "status": self.status, "state": self.game,
            "settings": dict(self.game_settings), "created_at": self.created_at,
        }

    @classmethod
    def from_saved(cls, data: dict, game: GameDef) -> "Room":
        """Raum aus einem Spielstand. Menschen gelten als getrennt, bis sie wiederkommen (Computer vertritt sie)."""
        if data.get("v") != cls.SAVE_VERSION or data.get("game") != game.id:
            raise ValueError("Spielstand passt nicht zu diesem Spiel/dieser Version")
        room = cls(str(data["id"]), game)
        now = time.time()
        room.seq = int(data.get("seq", 0))
        room.host_id = data.get("host_id")
        room.host_claimed = bool(data.get("host_claimed"))
        room.secrets = {str(k): str(v) for k, v in (data.get("secrets") or {}).items()}
        for md in data.get("members", []):
            m = Member(str(md["id"]), str(md["name"]))
            m.seat, m.is_bot = md.get("seat"), bool(md.get("is_bot"))
            m.joined_at = float(md.get("joined_at", now))
            m.avatar = hub_avatar_url_checked(md.get("avatar"))
            if not m.is_bot:
                m.connected, m.disconnected_at = False, now
            room.members[m.id] = m
        for pid, p in (data.get("pieces") or {}).items():
            if pid in room.pieces:
                room.pieces[pid] = {"field": p["field"], "held_by": None}
                if isinstance(p.get("kind"), str):
                    room.pieces[pid]["kind"] = p["kind"]
        room.last_roll = data.get("last_roll")
        room.status = data.get("status", "lobby")
        room.game = data.get("state")
        room.game_settings = dict(data.get("settings") or {})
        room.created_at = float(data.get("created_at", now))
        room.empty_since = now
        return room

    def release_all_everyone(self) -> List[dict]:
        return [e for mid in list(self.members) for e in self.release_all(mid)]

    def bot_plan(self, seat: int) -> Optional[dict]:
        """Was der Computer an diesem Platz tun will (darf länger rechnen – app.py ruft es außerhalb des Locks)."""
        if not self.rules or self.status != "playing":
            return None
        return self.rules.bot_action(self, seat)

    def bot_apply(self, seat: int, action: Optional[dict], power: float = 0.6) -> List[dict]:
        """Aktion des Computers (oder Vertretung eines Abwesenden) ausführen."""
        if not self.rules or self.status != "playing" or not action:
            return []
        member = self.member_at(seat)
        if action.get("type") == "roll":
            return self.roll(member.id, power, auto=True) if member else []
        return self.apply_action(member.id if member else "rules", seat, action)

    def bot_move(self, seat: int) -> List[dict]:
        """Planen + ausführen in einem Schritt (Tests, schnelle Regeln)."""
        return self.bot_apply(seat, self.bot_plan(seat))

    def apply_action(self, by: str, seat: int, action: dict) -> List[dict]:
        """Aktion (außer Würfeln) durch die Regeln; None/ungültig → keine Ereignisse."""
        try:
            evs = self.rules.apply(self, seat, action)
        except (KeyError, TypeError, ValueError):
            evs = None
        if evs is None:
            return []
        out = []
        for e in evs:
            e.setdefault("by", by)
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
            return self.status == "playing" and self.rules.can_touch(self, m.seat, piece_id)
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
            out = self.apply_action(member_id, m.seat, {"type": "move", "piece": piece_id, "to": field_id}) \
                if isinstance(field_id, str) and self.status == "playing" else []
            if not out:
                return self.release(member_id, piece_id)
            self.pieces[piece_id]["held_by"] = None
            return out
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


def valid_setting(spec: dict, value) -> bool:
    """Passt ein Wert zur Einstellung? Typ wie der Standardwert; bei Zahlen min/max, bei Auswahl choices."""
    default = spec.get("default")
    if isinstance(default, bool):
        return isinstance(value, bool)
    if isinstance(default, int):
        if isinstance(value, bool) or not isinstance(value, int):
            return False
        return spec.get("min", value) <= value <= spec.get("max", value)
    if "choices" in spec:
        return value in spec["choices"]
    return isinstance(value, type(default))
