"""Schach auf dem Treffen-Spieltisch (3D).

Start:  python games/schach/server/main.py   (Port 8096, Client vorher bauen: games/schach/client)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]                     # Repo-Wurzel
sys.path.insert(0, os.environ.get("TABLETOP_SERVER_PATH", str(ROOT / "packages" / "tabletop-server")))

from tabletop_server import GameDef, create_app  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout import LAYOUT, SEAT_COLORS  # noqa: E402
from rules import SchachRules  # noqa: E402
from stockfish_uci import find_binary  # noqa: E402

GAME_VERSION = "1.1.0"     # Version des Spiels (SemVer); Engine-Version kommt aus tabletop_server

GAME = GameDef(
    "schach",
    "Schach",
    seat_colors=SEAT_COLORS,          # Platz 0 = Weiß (vorn), Platz 1 = Schwarz
    min_players=2,
    layout=LAYOUT,
    rules=SchachRules(),
    version=GAME_VERSION,
)
CLIENT_DIST = Path(os.environ.get("SCHACH_CLIENT_DIST", Path(__file__).resolve().parents[1] / "static"))
DB_PATH = os.environ.get("TABLETOP_DB", str(Path(__file__).resolve().parents[1] / "data" / "schach.sqlite3"))

app = create_app(GAME, client_dist=CLIENT_DIST, db_path=DB_PATH)
print(f"[Schach] Computer: {'Stockfish ' + find_binary() if find_binary() else 'eingebauter Python-Computer (Stockfish nicht gefunden)'}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8096")))
