"""Mensch ärgere dich nicht auf dem Treffen-Spieltisch (3D). Ersetzt ab M5 den 2D-Prototyp in ../server.

Start:  python games/mensch/server3d/main.py   (Port 8095, Client vorher bauen: games/mensch/client)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]                     # Repo-Wurzel
sys.path.insert(0, os.environ.get("TABLETOP_SERVER_PATH", str(ROOT / "packages" / "tabletop-server")))

from tabletop_server import GameDef, create_app  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout import COLORS, LAYOUT, PALETTE  # noqa: E402

GAME = GameDef(
    "mensch",
    "Mensch ärgere dich nicht",
    # Sitzplätze im Uhrzeigersinn = Zugreihenfolge: Gelb, Grün, Rot, Schwarz
    seat_colors=[PALETTE[c] for c in COLORS],
    min_players=2,
    layout=LAYOUT,
)
CLIENT_DIST = Path(os.environ.get("MENSCH_CLIENT_DIST", Path(__file__).resolve().parents[1] / "static3d"))

app = create_app(GAME, client_dist=CLIENT_DIST)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8095")))
