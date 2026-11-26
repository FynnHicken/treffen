"""Spielstände in SQLite: laufende Partien überstehen einen Neustart oder ein Update des Servers.

- `mark_dirty(room_id)` wird bei jedem Broadcast aufgerufen; ein Hintergrund-Loop schreibt geänderte
  Räume alle FLUSH_INTERVAL_SEC Sekunden (und beim Herunterfahren) in die Datenbank.
- Gespeichert werden nur Räume mit laufendem oder beendetem Spiel – Lobbys sind schnell neu erstellt.
- Robust gegen Code-Updates: Beim Laden wird ein frisches GameRoom/Player-Objekt erzeugt und mit den
  gespeicherten Feldern überschrieben. Neue Felder behalten so ihren Standardwert, entfernte Felder
  werden ignoriert. Kaputte Einträge werden übersprungen (und gelöscht), statt den Start zu verhindern.

Datenbankpfad: MONOPOLY_DB (Standard: <monopoly>/data/monopoly.sqlite3), leer = Speichern aus.
"""
import os
import pickle
import sqlite3
import time
from pathlib import Path
from typing import Dict, Optional, Set

from game_state import GameRoom, Player

SCHEMA_VERSION = 1           # erhöhen, wenn alte Spielstände bewusst ungültig werden sollen
FLUSH_INTERVAL_SEC = 2.0
MAX_AGE_SEC = 24 * 3600       # ältere Spielstände werden beim Start verworfen

_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "monopoly.sqlite3"
DB_PATH = os.environ.get("MONOPOLY_DB", str(_DEFAULT_PATH)).strip()

_dirty: Set[str] = set()
_conn: Optional[sqlite3.Connection] = None
_disabled_reason: Optional[str] = None


def enabled() -> bool:
    return _connect() is not None


def _connect() -> Optional[sqlite3.Connection]:
    global _conn, _disabled_reason
    if _conn is not None or _disabled_reason:
        return _conn
    if not DB_PATH:
        _disabled_reason = "MONOPOLY_DB ist leer"
        return None
    try:
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, isolation_level=None, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("""CREATE TABLE IF NOT EXISTS rooms (
            room_id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL,
            updated_at REAL NOT NULL,
            state BLOB NOT NULL
        )""")
        _conn = conn
        print(f"[Persistenz] Spielstände in {DB_PATH}")
    except Exception as e:
        _disabled_reason = repr(e)
        print(f"[Persistenz] ⚠️ deaktiviert ({e!r}) – Spiele gehen bei Neustart verloren")
    return _conn


def mark_dirty(room_id: str):
    _dirty.add(room_id)


def _snapshot(room: GameRoom, secrets: Dict[str, str]) -> bytes:
    room_fields = {k: v for k, v in room.__dict__.items() if k != "players"}
    players = [dict(p.__dict__) for p in room.players]
    return pickle.dumps({"room": room_fields, "players": players, "secrets": dict(secrets)},
                        protocol=pickle.HIGHEST_PROTOCOL)


def _restore(room_id: str, blob: bytes):
    data = pickle.loads(blob)
    room = GameRoom(room_id, data["room"].get("host_id", ""))
    room.__dict__.update(data["room"])
    room.players = []
    for pd in data["players"]:
        p = Player(pd["id"], pd.get("name", "Spieler"), pd.get("token", "dog"), pd.get("color", "#e74c3c"),
                   is_bot=pd.get("is_bot", False))
        p.__dict__.update(pd)
        room.players.append(p)
    return room, data.get("secrets", {})


def flush(rooms: Dict[str, GameRoom], room_secrets: Dict[str, Dict[str, str]]):
    """Schreibt alle geänderten Räume. Läuft im Event-Loop ohne await → konsistenter Schnappschuss."""
    conn = _connect()
    if conn is None or not _dirty:
        _dirty.clear()
        return
    pending = list(_dirty)
    _dirty.clear()
    now = time.time()
    for room_id in pending:
        room = rooms.get(room_id)
        try:
            if room is None or room.status == "LOBBY":
                conn.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
                continue
            conn.execute(
                "INSERT INTO rooms (room_id, schema_version, updated_at, state) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(room_id) DO UPDATE SET schema_version=excluded.schema_version, "
                "updated_at=excluded.updated_at, state=excluded.state",
                (room_id, SCHEMA_VERSION, now, _snapshot(room, room_secrets.get(room_id, {}))),
            )
        except Exception as e:
            print(f"[Persistenz] Raum {room_id} nicht gespeichert: {e!r}")


def forget(room_id: str):
    """Raum wurde gelöscht → Eintrag sofort entfernen."""
    _dirty.discard(room_id)
    conn = _connect()
    if conn is not None:
        try:
            conn.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
        except Exception as e:
            print(f"[Persistenz] Raum {room_id} nicht gelöscht: {e!r}")


def load_all() -> Dict[str, tuple]:
    """Gibt {room_id: (GameRoom, secrets)} zurück; unlesbare oder zu alte Einträge werden gelöscht."""
    conn = _connect()
    if conn is None:
        return {}
    result = {}
    cutoff = time.time() - MAX_AGE_SEC
    for room_id, version, updated_at, blob in conn.execute(
            "SELECT room_id, schema_version, updated_at, state FROM rooms").fetchall():
        if version != SCHEMA_VERSION or updated_at < cutoff:
            conn.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
            continue
        try:
            result[room_id] = _restore(room_id, blob)
        except Exception as e:
            print(f"[Persistenz] Raum {room_id} übersprungen (nicht lesbar): {e!r}")
            conn.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
    if result:
        print(f"[Persistenz] {len(result)} Spiel(e) wiederhergestellt: {', '.join(sorted(result))}")
    return result
