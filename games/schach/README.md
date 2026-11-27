# Schach (Treffen-Spieltisch, 3D)

Schach am Holztisch im Hub unter `/schach/` (Port 8096). Läuft auf der Spieltisch-Engine (`packages/tabletop*`,
Regel-API 2) – Version des Spiels in `server/main.py` (`GAME_VERSION`), Engine-Version im `packages/CHANGELOG.md`.

**Spielen – alles am Brett, keine Dialoge**
- Figur greifen und auf ein erlaubtes Feld setzen; am Handy: Figur antippen (sie hebt sich, Ziele leuchten), Ziel antippen.
- Schlagen = auf die fremde Figur setzen; sie wandert rechts neben das Brett des Schlagenden (Filz-Ablage).
- Rochade = König zwei Felder Richtung Turm setzen, der Turm springt von selbst. En passant wie am echten Brett.
- Bauer auf der letzten Reihe wird ohne Nachfrage zur Dame.
- Schach: der König glimmt rot; der letzte Zug ist dezent markiert; das Platzset des Spielers am Zug leuchtet.
- Ende: Schachmatt, Patt, dreifache Wiederholung, 50-Züge-Regel, zu wenig Material. Host startet eine neue Partie.
- Allein: in der Lobby „+ Computer“ auf den freien Platz. Stärke 1–3 als Hausregel (⚙️). Wer zuerst am Tisch ist, spielt Weiß; in der Lobby kann man den Platz wechseln.

**Code**

| Datei | Was |
|---|---|
| `server/chess.py` | Schachlogik ohne Tisch: Stellung, legale Züge, Remis-Regeln, Computer (Alpha-Beta, Figur-Feld-Tabellen) |
| `server/layout.py` | 64 Felder, Ablagen `x-w-*`/`x-b-*`, 32 Figuren (`w-N-g1` = weißer Springer, Start g1) |
| `server/rules.py` | `SchachRules(GameRules)`: bildet Züge auf Figuren/Felder des Tisches ab |
| `client/src/board.ts` | Holzbrett mit Intarsien und gravierten Koordinaten, Filz-Ablagen, Markierungen (letzter Zug, Schach) |
| `client/src/pieces.ts` | Staunton-Figuren als Drehkörper, Springerkopf ausgesägt |
| `client/src/hud.ts` | Eine Statuszeile + Ergebnis |

**Tests**
```bash
# Regeln (Perft, Sonderzüge, Ende, Computer, Pflicht-Prüfung)
podman run --rm -v "$PWD":/repo:ro,z -w /tmp localhost/mono-test-deps python -I /repo/games/schach/tests/test_rules.py
# Browser (Desktop + Handy, Antippen, Schlagen, Computer, Render-on-Demand) – Server muss auf 8096 laufen
podman run --rm --network=host -v "$PWD/games/schach":/work:z -w /work localhost/mono-ui-test python tests/ui/schach_smoke.py http://127.0.0.1:8096 /work/tests/ui/shots
# Über den Hub: party-hub/tests/schach_via_hub.py · Titelbild neu: tests/ui/make_cover.py
```
