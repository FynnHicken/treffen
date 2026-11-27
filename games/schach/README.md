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

**Spielarten** (Hausregel „Spielart“ in der Lobby, ⚙️ – der Host wählt, das Brett wechselt sofort)

| Spielart | Plätze | Wie | Computer |
|---|---|---|---|
| Klassisch | 2 | Weiß vorn, Schwarz gegenüber | Stockfish (5 Stufen) |
| Teamschach | 4 | Weiß sitzt zu zweit vorn, Schwarz hinten; Zugfolge Weiß 1 → Schwarz 1 → Weiß 2 → Schwarz 2; jeder bewegt die Figuren seiner Farbe; Matt gewinnt fürs ganze Team | Stockfish (5 Stufen) |
| Tandem | 4 | Zwei Bretter, Partner sitzen nebeneinander und spielen verschiedene Farben (vorn A-Weiß + B-Schwarz). Geschlagene Figuren landen im Vorrat des Partners (Filz vor ihm); einsetzen = Figur greifen und auf ein freies Feld setzen (Bauern nicht auf Reihe 1/8). Beide Bretter laufen gleichzeitig, ohne Uhr. Matt auf einem Brett entscheidet; 600 Züge oder beide ohne Zug = Remis | eingebauter (schlägt, setzt nah am König ein, sieht Matt in 1) |
| Vierschach | 4 | Kreuzbrett 14×14 ohne Ecken: Rot vorn, Blau links, Gelb hinten, Grün rechts, reihum im Uhrzeigersinn. „Zwei gegen zwei“ (Partner gegenüber, Standard) oder „jeder gegen jeden“ (Hausregel). Bauern werden in der Brettmitte (8. Reihe) zur Dame, Rochade ja, kein en passant, Könige werden nie geschlagen. Geschlagenes landet in der Tischecke des Schlagenden und bringt Punkte (1/3/3/5/9). Matt: Team verliert bzw. Spieler scheidet aus; 50 Runden ohne Schlagen/Bauernzug → Punkte entscheiden | eingebauter |

**Computer: Stockfish** (klassisch und Teamschach)

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
| `server/layout.py` | Bretter aller Spielarten: klassisch (64 Felder, Ablagen `x-w-*`/`x-b-*`, `w-N-g1` = weißer Springer, Start g1), Tandem (`A-e4`, Vorräte `r-A-w-*`), Vierschach (`a4`…`n11`, Ecken-Ablagen `x-<platz>-*`); jede Figur mit Blickrichtung `facing` |
| `server/rules.py` | `SchachRules(GameRules)`: klassisch und Teamschach (`team=True`), bildet Züge auf Figuren/Felder des Tisches ab |
| `server/tandem.py` | `TandemRules`: zwei Stellungen (chess.py) + Einsetzen aus dem Vorrat, Weitergabe an den Partner |
| `server/vierer.py` | `VierRules`: eigener Zuggenerator für das Kreuzbrett, vier Blickrichtungen, Teams/jeder gegen jeden, Punkte |
| `client/src/board.ts` | Holzbrett mit Intarsien und gravierten Koordinaten (auch zwei Bretter / Kreuzbrett), Filz-Ablagen, Markierungen (letzte Züge, Schach) |
| `client/src/pieces.ts` | Staunton-Figuren als Drehkörper, Springerkopf ausgesägt |
| `client/src/hud.ts` | Eine Statuszeile + Ergebnis |

**Versionen des Spiels:** 1.0.0 (Schach, eingebauter Computer) · 1.1.0 Stockfish, Stärke 1–5 · **1.2.0** Spielarten
Teamschach, Tandem, Vierschach (Engine 2.2).

**Tests**
```bash
# Regeln (Perft, Sonderzüge, Ende, Computer, Stockfish, Pflicht-Prüfung) – mit Stockfish: STOCKFISH_PATH setzen
podman run --rm -v "$PWD":/repo:ro,z -w /tmp localhost/mono-test-deps python -I /repo/games/schach/tests/test_rules.py
# Spielarten (Team, Tandem, Vierschach: gezielte Regelfälle + Computer-Partien)
podman run --rm -v "$PWD":/repo:ro,z -w /tmp localhost/mono-test-deps python -I /repo/games/schach/tests/test_variants.py
# Browser (Desktop + Handy, Antippen, Schlagen, Computer, Render-on-Demand) – Server muss auf 8096 laufen
podman run --rm --network=host -v "$PWD/games/schach":/work:z -w /work localhost/mono-ui-test python tests/ui/schach_smoke.py http://127.0.0.1:8096 /work/tests/ui/shots
podman run --rm --network=host -v "$PWD/games/schach":/work:z -w /work localhost/mono-ui-test python tests/ui/variants_smoke.py http://127.0.0.1:8096 /work/tests/ui/shots
# Über den Hub: party-hub/tests/schach_via_hub.py · Titelbild neu: tests/ui/make_cover.py
```
