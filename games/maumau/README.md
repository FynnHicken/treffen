# Mau-Mau

Mau-Mau am Treffen-Spieltisch – und **Vorlage für Kartenspiele** (Engine 2.4, `docs/tabletop/KONZEPT.md` §12.8).
2–6 Spieler; der Tisch wächst in der Lobby von 4 auf 6 Plätze mit.

| Datei | Inhalt |
|---|---|
| `server/layout.py` | Spielmatte mit Stapel und Ablage, je Platz eine Hand – aus `tabletop_server.boards`/`cards` |
| `server/rules.py` | Regeln (API 2): passend legen, 7 = zwei ziehen, 8 = aussetzen, Bube = Farbe wünschen (Knöpfe) |
| `server/main.py` | `GameDef` mit zwei Varianten (4/6 Plätze, automatisch) |
| `client/src/main.ts` | ein Aufruf `startTable()` |

Am Tisch: Karte auf die Ablage ziehen oder antippen, Stapel antippen = Karte ziehen. Wer nach dem Ziehen nicht legen
will, tippt „Weiter“. Hausregeln: Kartenzahl zu Beginn, 7 auf 7.

Lokal: `python games/maumau/server/main.py` (Port 8098), Client `games/maumau/client` (`npm run build`).
Tests: `python -I games/maumau/tests/test_rules.py`, Browser `tests/ui/maumau_smoke.py`. Im Hub unter `/maumau/`
(Container `maumau`, Test über den Hub: `party-hub/tests/maumau_via_hub.py`).
