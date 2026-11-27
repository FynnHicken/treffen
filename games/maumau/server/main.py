"""Mau-Mau auf dem Treffen-Spieltisch (3D) – Vorlage für Kartenspiele (Engine 2.4).

Start:  python games/maumau/server/main.py   (Port 8098, Client vorher bauen: games/maumau/client)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, os.environ.get("TABLETOP_SERVER_PATH", str(ROOT / "packages" / "tabletop-server")))

from tabletop_server import GameDef, Variant, create_app  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout import LAYOUTS, SEAT_COLORS_ALL  # noqa: E402
from rules import MauMauRules  # noqa: E402

GAME_VERSION = "1.0.0"
NAMES = ["Gelb", "Grün", "Rot", "Blau", "Lila", "Orange"]

GAME = GameDef(
    "maumau", "Mau-Mau", min_players=2, version=GAME_VERSION, auto_variant=True, variant_label="Tisch",
    variants=[Variant(str(n), f"Bis zu {n}", SEAT_COLORS_ALL[:n], layout=LAYOUTS[n], rules=MauMauRules(),
                      players=(1, n) if n == 4 else (5, n), seat_names=NAMES[:n],
                      lobby="Setzt euch hin oder holt Computer an freie Plätze – dann starten.")
              for n in (4, 6)],
)
CLIENT_DIST = Path(os.environ.get("MAUMAU_CLIENT_DIST", Path(__file__).resolve().parents[1] / "static"))
DB_PATH = os.environ.get("TABLETOP_DB", str(Path(__file__).resolve().parents[1] / "data" / "maumau.sqlite3"))

app = create_app(GAME, client_dist=CLIENT_DIST, db_path=DB_PATH)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8098")))
