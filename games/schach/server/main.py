"""Schach auf dem Treffen-Spieltisch (3D).

Start:  python games/schach/server/main.py   (Port 8096, Client vorher bauen: games/schach/client)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]                     # Repo-Wurzel
sys.path.insert(0, os.environ.get("TABLETOP_SERVER_PATH", str(ROOT / "packages" / "tabletop-server")))

from tabletop_server import GameDef, Variant, create_app  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout import (LAYOUT, SEAT_COLORS, TANDEM_LAYOUT, TANDEM_SEAT_COLORS, TEAM_LAYOUT,  # noqa: E402
                    V_SEAT_COLORS, VIER_LAYOUT)
from rules import SchachRules  # noqa: E402
from tandem import TandemRules  # noqa: E402
from vierer import VierRules  # noqa: E402
from stockfish_uci import find_binary  # noqa: E402

GAME_VERSION = "1.3.0"     # Version des Spiels (SemVer); 1.2.0: Teamschach, Tandem, Vierschach; 1.3.0: Engine-App 2.3

GAME = GameDef(
    "schach",
    "Schach",
    min_players=2,
    version=GAME_VERSION,
    variant_label="Spielart",
    variants=[
        # Platz 0 = Weiß (vorn), Platz 1 = Schwarz
        Variant("klassisch", "Klassisch (zu zweit)", SEAT_COLORS, layout=LAYOUT, rules=SchachRules(),
                hint="ein Brett, Weiß gegen Schwarz", seat_names=["Weiß", "Schwarz"], min_players=2,
                lobby="Setzt euch hin (Weiß vorn, Schwarz gegenüber) oder holt einen Computer – dann starten."),
        # Weiß-Team sitzt vorn nebeneinander (0, 1), Schwarz-Team hinten (2, 3); Zugfolge W1 S1 W2 S2
        Variant("team", "Teamschach (2 gegen 2)", [SEAT_COLORS[0]] * 2 + [SEAT_COLORS[1]] * 2, layout=TEAM_LAYOUT,
                rules=SchachRules(team=True), seat_angles=[20, -20, 160, 200],
                hint="ein Brett, je Farbe zwei, die abwechselnd ziehen", seat_names=["Weiß", "Weiß", "Schwarz", "Schwarz"],
                min_players=4, lobby="Teamschach: Weiß sitzt vorn zu zweit, Schwarz gegenüber. Ihr zieht abwechselnd für euer Team."),
        Variant("tandem", "Tandem (2 gegen 2, zwei Bretter)", TANDEM_SEAT_COLORS, layout=TANDEM_LAYOUT,
                rules=TandemRules(), seat_angles=[30, -30, 150, 210],
                hint="geschlagene Figuren gehen an den Partner, der sie einsetzen darf", min_players=4,
                seat_names=["Weiß auf Brett A", "Schwarz auf Brett B", "Schwarz auf Brett A", "Weiß auf Brett B"],
                lobby="Tandem: Partner sitzen nebeneinander und spielen verschiedene Farben. Geschlagenes geht an den Partner."),
        Variant("vierer", "Vierschach (zu viert)", V_SEAT_COLORS, layout=VIER_LAYOUT, rules=VierRules(),
                hint="Kreuzbrett mit vier Heeren", seat_names=["Rot", "Blau", "Gelb", "Grün"], min_players=4,
                lobby="Vierschach: Rot vorn, Blau links, Gelb hinten, Grün rechts."),
    ],
)
CLIENT_DIST = Path(os.environ.get("SCHACH_CLIENT_DIST", Path(__file__).resolve().parents[1] / "static"))
DB_PATH = os.environ.get("TABLETOP_DB", str(Path(__file__).resolve().parents[1] / "data" / "schach.sqlite3"))

app = create_app(GAME, client_dist=CLIENT_DIST, db_path=DB_PATH)
print(f"[Schach] Computer: {'Stockfish ' + find_binary() if find_binary() else 'eingebauter Python-Computer (Stockfish nicht gefunden)'}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8096")))
