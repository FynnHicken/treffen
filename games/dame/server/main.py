"""Dame auf dem Treffen-Spieltisch (3D) – Vorlage für neue Tisch-Spiele.

Ganzes Spiel = Regeln (rules.py) + Brett aus den Engine-Hilfen (layout.py) + diese Datei.
Der Client (games/dame/client/src/main.ts) ist ein einziger Aufruf von startTable().

Start:  python games/dame/server/main.py   (Port 8097, Client vorher bauen: games/dame/client)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, os.environ.get("TABLETOP_SERVER_PATH", str(ROOT / "packages" / "tabletop-server")))

from tabletop_server import GameDef, create_app  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout import LAYOUT, SEAT_COLORS  # noqa: E402
from rules import DameRules  # noqa: E402

GAME_VERSION = "1.1.0"     # 1.1.0: Schachuhr (Engine 2.6)

GAME = GameDef("dame", "Dame", SEAT_COLORS, min_players=2, layout=LAYOUT, rules=DameRules(), version=GAME_VERSION,
               seat_names=["Weiß", "Schwarz"],
               lobby="Setzt euch hin (Weiß vorn, Schwarz gegenüber) oder holt einen Computer – dann starten.")
CLIENT_DIST = Path(os.environ.get("DAME_CLIENT_DIST", Path(__file__).resolve().parents[1] / "static"))
DB_PATH = os.environ.get("TABLETOP_DB", str(Path(__file__).resolve().parents[1] / "data" / "dame.sqlite3"))

app = create_app(GAME, client_dist=CLIENT_DIST, db_path=DB_PATH)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8097")))
