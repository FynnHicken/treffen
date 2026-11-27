"""Mensch ärgere dich nicht auf dem Treffen-Spieltisch (3D).

Start:  python games/mensch/server/main.py   (Port 8095, Client vorher bauen: games/mensch/client)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]                     # Repo-Wurzel
sys.path.insert(0, os.environ.get("TABLETOP_SERVER_PATH", str(ROOT / "packages" / "tabletop-server")))

from tabletop_server import GameDef, Variant, create_app  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout import LAYOUTS, PALETTE, colors_for  # noqa: E402
from rules import MenschRules  # noqa: E402

GAME_VERSION = "1.2.0"      # 1.1.0: Bretter für 6 und 8 Spieler; 1.2.0: Spieltisch-App der Engine 2.3

NAMES = {"yellow": "Gelb", "green": "Grün", "red": "Rot", "black": "Schwarz", "blue": "Blau", "orange": "Orange",
         "purple": "Lila", "white": "Weiß"}


def _board(n: int, title: str, players: tuple, hint: str) -> Variant:
    colors = colors_for(n)
    # Sitzplätze im Uhrzeigersinn = Zugreihenfolge: Gelb, Grün, Rot, Schwarz (, Blau, Orange, Lila, Weiß)
    return Variant(str(n), title, [PALETTE[c] for c in colors], layout=LAYOUTS[n], rules=MenschRules(colors),
                   players=players, hint=hint, seat_names=[NAMES[c] for c in colors])


GAME = GameDef(
    "mensch",
    "Mensch ärgere dich nicht",
    min_players=2,
    version=GAME_VERSION,
    # „automatisch“: Das Brett wächst in der Lobby mit, sobald mehr Leute sitzen wollen
    variants=[
        _board(4, "Klassisch für 2–4", (1, 4), "Kreuz mit 40 Feldern"),
        _board(6, "Großes Brett für 5–6", (5, 6), "Stern mit 60 Feldern"),
        _board(8, "Riesenbrett für 7–8", (7, 8), "Stern mit 80 Feldern"),
    ],
    auto_variant=True,
    variant_label="Brett",
)
CLIENT_DIST = Path(os.environ.get("MENSCH_CLIENT_DIST", Path(__file__).resolve().parents[1] / "static"))

# Spielstände (Neustart/Update übersteht eine Partie); leer = aus
DB_PATH = os.environ.get("TABLETOP_DB", str(Path(__file__).resolve().parents[1] / "data" / "mensch.sqlite3"))

app = create_app(GAME, client_dist=CLIENT_DIST, db_path=DB_PATH)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8095")))
