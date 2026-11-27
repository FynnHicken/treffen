# Dame

Deutsche Dame am Treffen-Spieltisch – und **Vorlage für neue Tisch-Spiele** (Engine 2.3, `docs/tabletop/KONZEPT.md` §12.5).

| Datei | Inhalt |
|---|---|
| `server/layout.py` | Brett aus `tabletop_server.boards` (8×8-Raster, Ablagen), Steine `disc` |
| `server/rules.py` | Regeln (API 2): Schlagzwang (Hausregel), Mehrfachsprung, fliegende Dame, Remis nach 40 Damenzügen |
| `server/main.py` | `GameDef` mit Platznamen und Lobby-Satz |
| `client/src/main.ts` | ein Aufruf `startTable()` – Brett, Steine, Anzeige kommen aus der Engine |

Regeln: Steine ziehen ein Feld schräg vorwärts und schlagen vorwärts (Hausregel: auch rückwärts). Wer schlagen kann,
muss (Hausregel). Auf der letzten Reihe wird der Stein zur Dame (Doppelstein), die beliebig weit zieht und schlägt.
Wer nicht mehr ziehen kann, verliert.

Lokal: `python games/dame/server/main.py` (Port 8097), Client `games/dame/client` (`npm run build`).
Tests: `python -I games/dame/tests/test_rules.py`, Browser `tests/ui/dame_smoke.py`.
Noch nicht im Hub eingebunden.
