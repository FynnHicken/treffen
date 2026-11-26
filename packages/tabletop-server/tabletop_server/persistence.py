"""Spielstände in SQLite: laufende Partien überstehen einen Neustart oder ein Update des Servers.

Muster wie bei Monopoly (games/monopoly/server/persistence.py), hier spielneutral und als JSON statt
pickle (ein Spielstand kann so nie Code ausführen):
- `mark_dirty(room_id)` bei jedem Broadcast; `flush()` schreibt geänderte Räume alle FLUSH_INTERVAL_SEC
  Sekunden und beim Herunterfahren.
- Gespeichert werden nur Räume mit laufendem oder beendetem Spiel – Lobbys sind schnell neu erstellt.
- Zu alte, unpassende oder kaputte Einträge werden beim Laden übersprungen und gelöscht, statt den Start
  zu verhindern.

Pfad: `TABLETOP_DB` (z. B. data/mensch.sqlite3); leer = Speichern aus.
"""
import json
import sqlite3
import time
from pathlib import Path
from typing import Callable, Dict, Optional, Set

FLUSH_INTERVAL_SEC = 2.0
MAX_AGE_SEC = 24 * 3600


class Store:
    def __init__(self, path: Optional[str]):
        self.path = (path or "").strip()
        self._dirty: Set[str] = set()
        self._conn: Optional[sqlite3.Connection] = None
        self.disabled_reason: Optional[str] = None if self.path else "kein Pfad (TABLETOP_DB)"

    @property
    def enabled(self) -> bool:
        return self._connect() is not None

    def _connect(self) -> Optional[sqlite3.Connection]:
        if self._conn is not None or self.disabled_reason:
            return self._conn
        try:
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("""CREATE TABLE IF NOT EXISTS rooms (
                room_id TEXT PRIMARY KEY,
                updated_at REAL NOT NULL,
                state TEXT NOT NULL
            )""")
            self._conn = conn
            print(f"[Persistenz] Spielstände in {self.path}")
        except Exception as e:
            self.disabled_reason = repr(e)
            print(f"[Persistenz] ⚠️ deaktiviert ({e!r}) – Spiele gehen bei Neustart verloren")
        return self._conn

    def mark_dirty(self, room_id: str) -> None:
        self._dirty.add(room_id)

    def flush(self, rooms: Dict[str, object]) -> None:
        """Schreibt alle geänderten Räume. Läuft im Event-Loop ohne await → konsistenter Schnappschuss."""
        conn = self._connect()
        if conn is None or not self._dirty:
            self._dirty.clear()
            return
        pending, self._dirty = list(self._dirty), set()
        now = time.time()
        for room_id in pending:
            room = rooms.get(room_id)
            try:
                if room is None or getattr(room, "status", "lobby") == "lobby":
                    conn.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
                    continue
                conn.execute(
                    "INSERT INTO rooms (room_id, updated_at, state) VALUES (?, ?, ?) "
                    "ON CONFLICT(room_id) DO UPDATE SET updated_at=excluded.updated_at, state=excluded.state",
                    (room_id, now, json.dumps(room.to_saved(), separators=(",", ":"))),
                )
            except Exception as e:
                print(f"[Persistenz] Raum {room_id} nicht gespeichert: {e!r}")

    def forget(self, room_id: str) -> None:
        self._dirty.discard(room_id)
        conn = self._connect()
        if conn is not None:
            try:
                conn.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
            except Exception as e:
                print(f"[Persistenz] Raum {room_id} nicht gelöscht: {e!r}")

    def load_all(self, restore: Callable[[dict], object]) -> Dict[str, object]:
        """{room_id: Raum}; `restore(data)` baut den Raum (wirft bei unpassenden Daten)."""
        conn = self._connect()
        if conn is None:
            return {}
        result = {}
        cutoff = time.time() - MAX_AGE_SEC
        for room_id, updated_at, blob in conn.execute("SELECT room_id, updated_at, state FROM rooms").fetchall():
            try:
                if updated_at < cutoff:
                    raise ValueError("zu alt")
                result[room_id] = restore(json.loads(blob))
            except Exception as e:
                print(f"[Persistenz] Raum {room_id} übersprungen: {e!r}")
                conn.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
        if result:
            print(f"[Persistenz] {len(result)} Spiel(e) wiederhergestellt: {', '.join(sorted(result))}")
        return result
