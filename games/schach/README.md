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
- Allein: in der Lobby „+ Computer“ auf den freien Platz. Stärke 1–5 als Hausregel (⚙️). Wer zuerst am Tisch ist, spielt Weiß; in der Lobby kann man den Platz wechseln.

**Computer: Stockfish**

| Stufe | Stockfish-Einstellung | Bedenkzeit |
|---|---|---|
| 1 Anfänger | Skill Level 0 (macht echte Fehler) | 0,08 s |
| 2 Gelegenheitsspieler (Standard) | UCI_Elo 1500 | 0,3 s |
| 3 Vereinsspieler | UCI_Elo 1900 | 0,4 s |
| 4 Meister | UCI_Elo 2400 | 0,6 s |
| 5 volle Stärke | ohne Begrenzung | 1 s |

- Stockfish 19, offizielles Release von GitHub, geholt von `tools/fetch_stockfish.py` (feste SHA-256-Prüfsummen für
  x86-64 und arm64; Update = Version + Prüfsummen dort ändern). Liegt im Image unter `/opt/stockfish/` samt Lizenz.
- **Lizenz:** Stockfish ist GPL-3.0 (`/opt/stockfish/Copying.txt`, Quellcode: https://github.com/official-stockfish/Stockfish).
  Er läuft als eigenständiges Programm, unser Server spricht nur per UCI mit ihm – unser Code bleibt davon unberührt.
- **Ressourcen:** ein Prozess für alle Partien (nacheinander), 1 Thread, 16 MB Hash. Er braucht ~250 MB RAM, startet erst
  beim ersten Computerzug und beendet sich nach 10 Minuten ohne Zug (`STOCKFISH_IDLE_SEC`).
- **Ausfallsicher:** Fehlt Stockfish, hängt oder stirbt er, spielt der eingebaute Python-Computer (`server/chess.py`).
  Abschalten: `SCHACH_STOCKFISH=off`. Eigener Pfad: `STOCKFISH_PATH`. Beim Start steht im Log, welcher Computer spielt.

**Code**

| Datei | Was |
|---|---|
| `server/chess.py` | Schachlogik ohne Tisch: Stellung, legale Züge, Remis-Regeln, Ersatz-Computer (Alpha-Beta, Figur-Feld-Tabellen) |
| `server/stockfish_uci.py` | Stockfish per UCI: ein Prozess, Lese-Thread, Zeitlimit, Neustart nach Absturz, Abschalten im Leerlauf |
| `tools/fetch_stockfish.py` | Stockfish-Release laden + Prüfsumme prüfen (Docker, Fly, CI) |
| `server/layout.py` | 64 Felder, Ablagen `x-w-*`/`x-b-*`, 32 Figuren (`w-N-g1` = weißer Springer, Start g1) |
| `server/rules.py` | `SchachRules(GameRules)`: bildet Züge auf Figuren/Felder des Tisches ab |
| `client/src/board.ts` | Holzbrett mit Intarsien und gravierten Koordinaten, Filz-Ablagen, Markierungen (letzter Zug, Schach) |
| `client/src/pieces.ts` | Staunton-Figuren als Drehkörper, Springerkopf ausgesägt |
| `client/src/hud.ts` | Eine Statuszeile + Ergebnis |

**Versionen des Spiels:** 1.0.0 (Schach, eingebauter Computer) · **1.1.0** Stockfish, Stärke 1–5.

**Tests**
```bash
# Regeln (Perft, Sonderzüge, Ende, Computer, Stockfish, Pflicht-Prüfung) – mit Stockfish: STOCKFISH_PATH setzen
podman run --rm -v "$PWD":/repo:ro,z -w /tmp localhost/mono-test-deps python -I /repo/games/schach/tests/test_rules.py
# Browser (Desktop + Handy, Antippen, Schlagen, Computer, Render-on-Demand) – Server muss auf 8096 laufen
podman run --rm --network=host -v "$PWD/games/schach":/work:z -w /work localhost/mono-ui-test python tests/ui/schach_smoke.py http://127.0.0.1:8096 /work/tests/ui/shots
# Über den Hub: party-hub/tests/schach_via_hub.py · Titelbild neu: tests/ui/make_cover.py
```
