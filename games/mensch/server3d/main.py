"""Mensch ärgere dich nicht auf dem Treffen-Spieltisch (3D). Ersetzt ab M5 den 2D-Prototyp in ../server.

Start:  python games/mensch/server3d/main.py   (Port 8095, Client vorher bauen: games/mensch/client)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]                     # Repo-Wurzel
sys.path.insert(0, os.environ.get("TABLETOP_SERVER_PATH", str(ROOT / "packages" / "tabletop-server")))

from tabletop_server import GameDef, create_app  # noqa: E402

GAME = GameDef(
    "mensch",
    "Mensch ärgere dich nicht",
    # Sitzplätze im Uhrzeigersinn = Zugreihenfolge: Gelb, Grün, Rot, Schwarz
    seat_colors=["#f1c40f", "#27ae60", "#e74c3c", "#2c3e50"],
    min_players=2,
)
CLIENT_DIST = Path(os.environ.get("MENSCH_CLIENT_DIST", Path(__file__).resolve().parents[1] / "static3d"))

app = create_app(GAME, client_dist=CLIENT_DIST)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8095")))
