"""Stockfish als Computer-Gegner (UCI über stdin/stdout, ein Prozess für alle Partien).

- Programm: Umgebungsvariable STOCKFISH_PATH, sonst /opt/stockfish/stockfish, sonst `stockfish` im PATH.
  Holen: games/schach/tools/fetch_stockfish.py (offizielles GitHub-Release, Prüfsumme fest).
- Ein Prozess, nacheinander benutzt (Lock): Stockfish braucht ~260 MB (Bewertungsnetz) – mehrere wären zu viel.
- Startet erst beim ersten Computerzug und beendet sich nach IDLE_SEC ohne Zug wieder (Speicher frei).
- Jede Anfrage hat ein hartes Zeitlimit. Hängt oder stirbt Stockfish → Prozess weg, Antwort None; die Regeln
  nehmen dann den eingebauten Python-Computer (chess.best_move). Das Spiel bleibt also immer spielbar.
"""
import os
import queue
import shutil
import subprocess
import threading
import time
from typing import Optional

IDLE_SEC = float(os.environ.get("STOCKFISH_IDLE_SEC", "600"))
START_TIMEOUT = 10.0
HASH_MB = 16


def find_binary() -> Optional[str]:
    for cand in (os.environ.get("STOCKFISH_PATH"), "/opt/stockfish/stockfish", shutil.which("stockfish")):
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


class Stockfish:
    def __init__(self, path: Optional[str] = None):
        if path is not None and not (os.path.isfile(path) and os.access(path, os.X_OK)):
            path = None                    # angegebener Pfad taugt nicht → kein Stockfish (Python übernimmt)
            self.path = None
        else:
            self.path = path or find_binary()
        self.proc: Optional[subprocess.Popen] = None
        self.lines: "queue.Queue[Optional[str]]" = queue.Queue()
        self.lock = threading.Lock()
        self.last_used = 0.0
        self.version = ""
        self.failures = 0
        if self.path:
            threading.Thread(target=self._idle_watch, daemon=True).start()

    @property
    def available(self) -> bool:
        return bool(self.path) and self.failures < 5      # nach 5 Fehlschlägen in Folge: aufgeben (Python übernimmt)

    # ---------- Prozess ----------
    def _send(self, cmd: str) -> None:
        self.proc.stdin.write(cmd + "\n")
        self.proc.stdin.flush()

    def _read_until(self, prefix: str, timeout: float) -> Optional[str]:
        """Zeilen lesen, bis eine mit `prefix` beginnt; None bei Zeitüberschreitung oder Prozessende.
        (Ein Lese-Thread füllt die Warteschlange – select() auf gepufferte Pipes wäre unzuverlässig.)"""
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            try:
                line = self.lines.get(timeout=left)
            except queue.Empty:
                return None
            if line is None:
                return None
            if line.startswith(prefix):
                return line.strip()

    @staticmethod
    def _pump(stream, q) -> None:
        for line in stream:
            q.put(line)
        q.put(None)

    def _start(self) -> bool:
        try:
            self.proc = subprocess.Popen([self.path], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.DEVNULL, text=True, bufsize=1)
            self.lines = queue.Queue()
            threading.Thread(target=self._pump, args=(self.proc.stdout, self.lines), daemon=True).start()
            self._send("uci")
            if self._read_until("uciok", START_TIMEOUT) is None:
                raise RuntimeError("kein uciok")
            for name, value in (("Threads", 1), ("Hash", HASH_MB)):
                self._send(f"setoption name {name} value {value}")
            self._send("isready")
            if self._read_until("readyok", START_TIMEOUT) is None:
                raise RuntimeError("kein readyok")
            return True
        except Exception as e:
            print(f"[Stockfish] Start fehlgeschlagen: {e!r}")
            self._kill()
            return False

    def _kill(self) -> None:
        p, self.proc = self.proc, None
        if p:
            try:
                p.kill()
                p.wait(timeout=2)
            except Exception:
                pass

    def _idle_watch(self) -> None:
        while True:
            time.sleep(30)
            if self.proc and time.time() - self.last_used > IDLE_SEC and self.lock.acquire(blocking=False):
                try:
                    if self.proc and time.time() - self.last_used > IDLE_SEC:
                        self._send("quit")
                        self._kill()
                finally:
                    self.lock.release()

    # ---------- Zug ----------
    def best_move(self, fen: str, movetime_ms: int, elo: Optional[int] = None, skill: Optional[int] = None) -> Optional[str]:
        """Bester Zug als UCI-Text (z. B. "e2e4", "e7e8q") oder None (nicht verfügbar/Fehler)."""
        if not self.available:
            return None
        with self.lock:
            self.last_used = time.time()
            if self.proc is None or self.proc.poll() is not None:
                self._kill()
                if not self._start():
                    self.failures += 1
                    return None
            try:
                limit = elo is not None
                self._send(f"setoption name UCI_LimitStrength value {'true' if limit else 'false'}")
                if limit:
                    self._send(f"setoption name UCI_Elo value {max(1320, min(3190, int(elo)))}")
                self._send(f"setoption name Skill Level value {20 if skill is None else max(0, min(20, int(skill)))}")
                self._send("ucinewgame")
                self._send(f"position fen {fen}")
                self._send(f"go movetime {int(movetime_ms)}")
                line = self._read_until("bestmove", movetime_ms / 1000 + 5)
            except Exception as e:
                print(f"[Stockfish] Fehler: {e!r}")
                line = None
            self.last_used = time.time()
            if not line:
                self._kill()
                self.failures += 1
                return None
            self.failures = 0
            move = line.split()[1] if len(line.split()) > 1 else ""
            return move if move and move != "(none)" else None


_ENGINE: Optional[Stockfish] = None


def engine() -> Stockfish:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = Stockfish()
    return _ENGINE
