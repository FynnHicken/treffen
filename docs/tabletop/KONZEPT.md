# Treffen-Spieltisch – Konzept

> Stand: 2026-11-27 · Status: **M1–M5 ✅ · Engine 2.4.0 (§12) · Mensch (`/mensch/`) und Schach (`/schach/`) im Hub, Dame und Mau-Mau als Vorlagen** · Änderungen: [`packages/CHANGELOG.md`](../../packages/CHANGELOG.md)

## 1. Ziel

**Das echte Brettspiel-Erlebnis so gut wie möglich nachbauen.** Ein leerer 3D-Spieltisch, auf dem beliebige
Brettspiele liegen können. Man fasst die Dinge selbst an: Figur greifen und setzen, Würfel im Becher schütteln,
Karte ziehen und umdrehen. Der Server prüft die Regeln automatisch mit – wer falsch zieht, dessen Figur gleitet
zurück. Ein freier Modus ohne Regelprüfung (wie Tabletop Simulator) kann später als Einstellung dazukommen.

Leitsätze:

1. **Gefühl vor Funktion.** Jede Aktion hat Gewicht: Animation, Geräusch, am Handy Vibration.
2. **Anfassen statt Knöpfe.** Knöpfe gibt es nur als Abkürzung (Barrierefreiheit, „Würfeln“-Taste).
3. **Der Server ist der Schiedsrichter.** Zufall und Regeln entscheidet nur der Server; der Client zeigt an.
4. **Spielneutral.** Der Tisch weiß nichts von Mensch oder Monopoly. Ein Spiel bringt Regeln + Material mit.
5. **Handy zuerst.** Die meisten spielen am Handy; Desktop ist die Erweiterung.
6. **Von Anfang an robust.** Wiederverbinden, Spielstände, Zuschauer, Bots, Hub-Tickets, Tests – wie bei Monopoly erarbeitet.

## 2. Bausteine auf dem Tisch

Alles ist ein **Gegenstand** mit `id`, `typ`, Position (Feld/Zone oder freie Koordinate), Besitzer und
**Sichtbarkeit** (`offen` · `verdeckt` · `nur Besitzer`).

| Gegenstand | Beispiele | Interaktion |
|---|---|---|
| **Brett** | Mensch-Kreuz, Monopoly-Plan | liegt fest, hat **Felder** mit Positionen |
| **Feld / Zone** | Laufbahn, Häuschen, Ziel, Ablagestapel, Bank | Ablageziel; rastet ein (Snap) |
| **Figur** | Hütchen, Monopoly-Figur | greifen, über Feldern schweben, absetzen; hüpft Feld für Feld |
| **Würfel** | W6, später andere | im Becher schütteln/werfen; rollt physikalisch, Ergebnis vom Server. **Ein** Becher wird herumgereicht – wer ihn hat, ist dran (natürliche Zuganzeige) |
| **Karte / Stapel** | Ereignis-, Spielkarten | ziehen, umdrehen, mischen, ablegen |
| **Hand** | Karten eines Spielers | nur für den Besitzer sichtbar, aufgefächert am eigenen Platz |
| **Marker / Geld** | Scheine, Chips, Häuser | stapeln, zählen, übergeben |
| **Sitzplatz** | 4 Seiten des Tisches | eigener Platz ist immer „unten“; Platzset in Spielerfarbe, Name ins Platzset graviert (Würfel rollen darüber) |

Für Mensch ärgere dich nicht reichen: Brett, Felder/Zonen, Figuren, Würfel, Sitzplätze.

## 3. Wie es sich anfühlen soll (Interaktion)

- **Figur ziehen:** Antippen/Greifen hebt die Figur an (Schatten wird größer, leises „Klack“). Beim Ziehen
  werden **erlaubte Zielfelder** dezent hervorgehoben (Regel-Vorschau). Loslassen über einem Feld → rastet ein.
  Unerlaubt → Figur gleitet zurück, kurzer Hinweis warum. Antippen eines erlaubten Ziels geht auch (Handy).
- **Würfeln:** Becher greifen und schütteln (Maus-Bewegung bzw. Handy-Gyro), loslassen = werfen.
  Würfel rollen echt über den Tisch, prallen ab, bleiben liegen. Alternativ Doppeltipp/Taste.
- **Die anderen spüren:** Man sieht, wenn jemand eine Figur in der Hand hält (sie schwebt bei allen), wohin
  andere zeigen (dezente Hand/Punkt in Spielerfarbe), wer gerade am Zug ist (Licht auf dem Sitzplatz).
- **Kamera:** Standard = Blick vom eigenen Platz, leicht schräg. Zwei Finger drehen/zoomen; Doppeltipp = zurück.
  Kamerafahrten nur, wenn sie helfen (z. B. eigener Wurf), nie erzwungen beim Zug anderer.
- **Klang:** Material-Geräusche (Holz auf Holz, Würfel auf Brett, Karte auf Tisch), leise Tisch-Atmosphäre.

## 4. Architektur

```
packages/
  tabletop/            Client-Engine (TypeScript, Three.js aktuell)  ← spielneutral
    engine/            Renderer, Szene, Licht, Tisch, Render-on-Demand, Qualitätsstufen
    camera/            Sitzplatz-Kamera, Gesten, Einpassen ans Seitenverhältnis
    objects/           Brett, Feld/Zone, Figur, Würfel, Karte, Stapel, Hand, Marker
    input/             Greifen/Ziehen/Ablegen (Maus+Touch), Würfelbecher (Maus+Gyro)
    net/               Verbindung (aus boardgame-kit), Ereignis-Warteschlange, Präsenz
    audio/, haptics/   Geräusche nach Material, Vibration
    ui/                Spielerleiste, Hinweise, Lobby-Bausteine
  tabletop-server/     Python-Paket (FastAPI), spielneutral
                       Räume, AUTH/Tickets, Persistenz, Bot-Treiber, Zuschauer, Ereignis-Log
games/mensch/
  rules/               Mensch-Regeln (aus heutigem game_state.py) – reine Funktionen
  client/              Spieldefinition: Brett-Modell, Feldpositionen, Figuren, Farben, Theme
```

`packages/boardgame-kit` (heute von Monopoly genutzt) geht im Client-Teil von `tabletop` auf.
Monopoly bleibt unverändert lauffähig und ist **Steinbruch** (Würfel, Hüpfen, Kamera, Sounds, Bot-Erfahrung).

**Technik:** Three.js aktuell (0.187.0, exakt gepinnt), Vite + TypeScript strict, Physik-Engine für Würfel
(**cannon-es 0.20.0**, entschieden in M3: klein, reines JS, deterministisch genug – alle Clients berechnen denselben Wurf identisch), Python/FastAPI wie bei Monopoly/Mensch.

## 5. Wie Client und Server reden

- **Client → Server: Absichten.** `ROLL {power}`, `MOVE {piece, to}`, `DRAW {deck}` … Der Server prüft per Regeln.
- **Server → Client: Ereignisse mit laufender Nummer.** `DICE_ROLLED {values}`, `PIECE_MOVED {piece, path, captured}` …
  Der Client spielt sie **in seinem Tempo** nacheinander ab (Animationen). Der Server kennt keine Animationsdauern.
- **Voller Zustand nur beim (Wieder-)Verbinden** (`SNAPSHOT {seq, state}`); fehlt eine Nummer → neuer Snapshot.
- **Geheimes bleibt geheim:** Der Server filtert pro Spieler (`view_for`); verdeckte Karten anderer kommen
  nie im Browser an.
- **Präsenz** (Zeiger, „hält Figur X“, Ziehen in Echtzeit) läuft als leichter Nebenkanal: ungeprüft,
  gedrosselt (~15/s), wird nicht gespeichert.
- **Würfel:** Der Server würfelt. Der Client simuliert die Physik und dreht die Würfel unsichtbar so, dass
  oben die richtige Zahl liegt (übliche Technik) – sieht echt aus, ist fälschungssicher.

## 6. Schnittstelle für ein Spiel (Server, Python)

Umgesetzt in `packages/tabletop-server/tabletop_server/rules.py` (Doku im Dateikopf). **Seit Engine 2.0 gilt
Regel-API 2 (§12)**; der Entwurf unten war die Vorlage. Mensch nutzt noch API 1 (`Rules`), die über `LegacyRules`
unverändert weiterläuft. Regeln arbeiten direkt auf `room.pieces`/`room.game` und liefern Ereignisse ohne Nummer.

```python
class Rules:
    def setup(self, players, settings) -> State                 # Anfangsaufstellung
    def legal_actions(self, state, player) -> list[Action]        # auch für Zielvorschau im Client
    def apply(self, state, player, action) -> list[Event]         # prüft, ändert State, liefert Ereignisse
    def view_for(self, state, player) -> dict                     # gefilterte Sicht (geheime Infos)
    def bot_action(self, state, player, difficulty) -> Action     # Bot-KI
    settings_schema: dict                                          # Raum-Einstellungen (Hausregeln)
```

Zufall über einen **Zufallsgenerator pro Raum mit Startwert** → jede Partie lässt sich exakt nachspielen
(Fehlerberichte, Tests). Mensch-Regeln heute in `games/mensch/server/game_state.py` werden dorthin portiert.

**Client-Seite** beschreibt ein Spiel deklarativ: Brett (Modell/Textur, Maße), Felder mit Koordinaten und
Typen, Figuren (Modell, Farben), Würfel-Anzahl, Sitzplätze. Der Tisch baut daraus die Szene.

## 7. Hub & Betrieb

- Spiel-Manifest (`game.json`: Name, Icon, Spielerzahl, Einstellungen) → Hub listet Spiele automatisch
  (Schritt „Spiele als Plug-ins“ aus dem Umbau-Plan).
- Hub-Tickets, Raum-Einstellungen, Persistenz, Abwesenheit → Computer, Zuschauer: aus Monopoly übernommen.
- Ein Server-Prozess kann mehrere Spiele hosten (spart Container); Entscheidung in M5.

## 8. Qualität

- Regeln: Unit-Tests + Simulation vieler Bot-Partien (wie heute bei Mensch/Monopoly).
- Protokoll: WebSocket-Tests (Rechte, Reconnect, Geheimes gefiltert).
- Browser: Durchlauf + Screenshot-Vergleich in der CI; Handy und Desktop.
- Performance-Budget: Handy-Mittelklasse 60 fps beim Ziehen, Leerlauf ≈ 0 % GPU (Render-on-Demand),
  erster Aufbau < 3 s im WLAN.

## 9. Fahrplan

| Meilenstein | Ergebnis (jeweils spielbar/vorführbar) |
|---|---|
| **M1 Leerer Tisch** ✅ | 3D-Tisch, Sitzplätze, Kamera mit Gesten, zwei Browser sehen sich (Präsenz-Zeiger), Hub-Ticket |
| **M2 Gegenstände** ✅ | Mensch-Brett + Figuren: greifen, ziehen, einrasten, Sync über Server (noch ohne Regeln) |
| **M3 Würfel** ✅ | Becher, Physik-Würfel, Ergebnis vom Server, Klang + Vibration |
| **M4 Regeln** ✅ | Regel-Schnittstelle, Mensch-Regeln portiert, Zielvorschau, „gleitet zurück“, Bots |
| **M5 Fertig** ✅ | Im Hub (`/mensch/`, Host per Ticket), Hausregeln in der Lobby (⚙️), Spielstände in SQLite, Zuschauer, ein Becher für alle; 2D-Prototyp entfernt |
| **E2.0 Engine 2** ✅ | Versionsnummer, Regel-API 2 (Aktionen), Ansicht je Platz, `PIECE_CHANGED`, Antippen → Ziel antippen, Pflicht-Prüfung für alle Spiele; **Schach** als zweites Spiel (§12) |
| **E2.1 Spielvarianten** ✅ | Mehrere Bretter je Spiel (`Variant`), automatisch nach Spielerzahl, Lage der Plätze frei, mehrere Plätze gleichzeitig am Zug, Figuren nach Regeln; **Mensch für 4/6/8**, Schach-Varianten (§12.7) |
| **E2.2 Gleichzeitig** ✅ | Mehrere Computer gleichzeitig am Zug kommen reihum dran (Tandem), Variante + Hausregeln in einer Nachricht |
| **E2.3 Spieltisch-App** ✅ | `startTable()`: Oberfläche, Statuszeile, Siegerehrung, Markierungen aus Daten der Regeln; Standard-Brett und -Figuren; Brett-Hilfen (Raster, Hex, Laufbahn, Ablagen); **Dame** als Vorlage ohne Client-Code (§12.5) |
| **E2.4 Karten & Zonen** ✅ | Karte, Stapel (mischen, ziehen), Hand (aufgefächert am eigenen Platz, nur für den Besitzer sichtbar), Auslage; geheime Vorderseiten; Knöpfe für Aktionen ohne Figur; **Mau-Mau** als Vorlage (§12.8) |
| E2.5 Freier Tisch | Hausregel „Regeln prüfen: aus“ – alle dürfen alles bewegen wie am echten Tisch; Spiele nur aus Material |
| E2.6 Am Tisch | Schachuhr/Zugzeit, Zug zurücknehmen (mit Zustimmung), Verlauf, Zähler/Marker/Geld |
| E2.7 Ein Server für alle | Alle Tisch-Spiele in einem Container, `game.json` je Spiel, Hub liest die Spieleliste vom Server (§12.5) |
| später | Eingreifen außerhalb des eigenen Zugs, Spiel im Stil von Munchkin mit eigenen Karten, Monopoly v2 |

## 10. Lokal ausprobieren (ohne Python/Node auf dem Host)

```bash
# Client bauen (Repo-Wurzel)
podman run --rm -v "$PWD":/repo:z -w /repo/games/mensch/client docker.io/library/node:22-alpine sh -c 'npm ci && npm run build'
# Server starten → http://127.0.0.1:8095/  (zweites Fenster/Handy mit gleichem ?room=… öffnen)
podman run -d --name tisch-dev -p 8095:8095 -e TABLETOP_DB=/tmp/mensch.sqlite3 -v "$PWD":/repo:ro,z localhost/mono-test-deps sh -c 'cd /tmp && exec python -u /repo/games/mensch/server/main.py'
# Browser-Test (zwei Spieler, Präsenz, Leerlauf ohne Rendern) mit Screenshots
podman run --rm --network=host -v "$PWD/games/mensch":/work:z -w /work localhost/mono-ui-test python tests/ui/tisch_smoke.py http://127.0.0.1:8095 /work/tests/ui/shots
# Langsame Maschine wie die CI nachstellen: zusätzlich -e THROTTLE=4
# Server-Tests: Regeln (+100 Computer-Partien) und Hausregeln/Spielstände
podman run --rm -v "$PWD":/repo:ro,z -w /tmp localhost/mono-test-deps python -I /repo/games/mensch/tests/test_rules.py
podman run --rm -v "$PWD":/repo:ro,z -w /tmp localhost/mono-test-deps python -I /repo/games/mensch/tests/test_server.py
```

Im Hub (wie in Produktion): `TREFFEN_TICKET_SECRET=… podman compose up -d --build party-server partyhub mensch schach`, dann
`http://127.0.0.1:8000` → Karte „Mensch ärgere dich nicht“ bzw. „Schach“. Tests: `party-hub/tests/mensch_via_hub.py`,
`party-hub/tests/schach_via_hub.py`.

Schach genauso: Client unter `games/schach/client` bauen, Server `games/schach/server/main.py` (Port 8096),
Tests `games/schach/tests/test_rules.py` und `games/schach/tests/ui/schach_smoke.py`.
Pflicht-Prüfung aller Tisch-Spiele: `python -I packages/tabletop-server/tests/test_conformance.py`.

## 11. Entscheidungen (Nutzer, 2026-11-26)

| Frage | Entscheidung |
|---|---|
| Regeln | Spielgefühl hat Vorrang, Regeln prüft der Server automatisch mit. Freier Modus (wie Tabletop Simulator) evtl. später als Einstellung |
| Erstes Spiel | Mensch ärgere dich nicht (einfache Regeln, schnell gespielt) |
| Optik | **Realistisch-warm**: Holztisch, weiches Licht, echte Materialien – Spieleabend am Küchentisch |
| Material | **Selbst modellieren** (einfache, saubere Formen per Code), keine fremden Assets → keine Lizenzfragen |
| Spielerzahl Mensch | Klassisch 4; **seit 2026-11-27 auch Bretter für 6 und 8** (wachsen in der Lobby automatisch mit) |
| Mehr Spieler (2026-11-27) | Mensch bis 8; Schach in **allen Varianten** für mehr als 2: Teamschach, Tandem, Vierschach |
| Server | **Gemeinsames Python-Paket** für alle Tisch-Spiele (`packages/tabletop-server`) |
| Engine-Version (2026-11-27) | **Versionsnummer für die Engine**, damit man immer weiß, welches Spiel welche Version hat (§12.1) |
| Bedienung (2026-11-27) | **Rückfragen an Spieler minimal halten.** Möglichst alles über Handgriffe am Tisch, damit das Brettspiel-Gefühl bleibt (§12.3) |
| Ziel (2026-11-27) | Engine-Updates dürfen Spiele nicht kaputt machen, Spiele sollen leicht/automatisch mitgehen, neue Spiele leicht hinzuzufügen sein |

## 12. Engine 2 – viele Brettspiele auf einem Tisch

Ziel: Möglichst viele Brettspiele (Schach, Mau-Mau, Spiele im Stil von Munchkin, Catan …) auf derselben Engine,
ohne dass ein Engine-Update laufende Spiele kaputt macht. Stand: **2.0.0** – Grundlage + Schach.

### 12.1 Versionen

- Eine Nummer für Client und Server: `packages/tabletop/src/version.ts` = `tabletop_server/version.py` (Test prüft das).
- SemVer: **MAJOR** bricht Spiele, **MINOR** erweitert, **PATCH** repariert. Jede Änderung steht in
  [`packages/CHANGELOG.md`](../../packages/CHANGELOG.md).
- Jedes Spiel hat zusätzlich eine eigene Version (`GameDef(version=…)`) und spricht eine Regel-API (`api_version`).
- Sichtbar: `/<spiel>/api/health`, unten rechts im Spiel („Schach 1.0.0 · Spieltisch 2.0.0“), Browser-Konsole.
- Spiele binden die Engine beim Bauen als Quellcode ein → jedes Image hat automatisch die aktuelle Engine
  („automatisch upgedatet“). Abgesichert durch die CI (§12.4).

### 12.2 Regel-API 2: Aktionen

Alles, was ein Spieler tun kann, ist eine **Aktion** – ein Dict mit `type`. Der Tisch übersetzt Handgriffe in Aktionen:

| Handgriff am Tisch | Aktion | seit |
|---|---|---|
| Becher schütteln/werfen | `{"type": "roll"}` (Zahlen bestimmt der Server) | 2.0 |
| Figur greifen und absetzen / antippen + Ziel antippen | `{"type": "move", "piece", "to"}` | 2.0 |
| Karte ziehen, ausspielen, abwerfen | `{"type": "card", …}` | geplant 2.2 |
| Marker/Geld nehmen, geben | `{"type": "token", …}` | geplant 2.3 |

```python
class MeineRegeln(GameRules):              # tabletop_server.rules
    settings_schema = {...}                # Hausregeln (Lobby ⚙️)
    shared_view = True                     # False → Ansicht je Platz (Geheimes bleibt geheim)
    def setup(self, room) -> list          # Aufstellung, room.game füllen
    def actions(self, room, seat) -> list  # was dieser Platz jetzt tun darf (auch Zielvorschau im Client)
    def apply(self, room, seat, action)    # ausführen → Ereignisse, None = nicht erlaubt (Figur gleitet zurück)
    def view(self, room, seat) -> dict     # Spielstand für einen Platz (None = Zuschauer)
    def to_move(self, room) -> list        # wer handeln darf (mehrere = gleichzeitig, z. B. Eingreifen)
    def bot_action(self, room, seat)       # Computer (darf rechnen – läuft außerhalb des Raum-Locks)
```

Ende einer Partie: `room.status = "finished"`, im Spielstand `phase: "over"`, `finished: [Plätze nach Rang]`,
`result: {"winners": [...], "reason": "...", "text": "..."}`. Figur wechselt die Art: `room.pieces[id]["kind"]` +
Ereignis `PIECE_CHANGED`.

**Alte Spiele:** API 1 (`Rules`, Mensch) läuft über `LegacyRules` weiter – identisches Protokoll, kein Umbau nötig.
Wird eine neue MAJOR-Version fällig, bekommt die alte API wieder so eine Übersetzung, statt alle Spiele umzuschreiben.

### 12.3 Leitlinie: Am Tisch statt in Dialogen

Rückfragen an den Spieler nur, wenn es wirklich nicht anders geht. Vorher prüfen:
1. **Gibt es einen Handgriff dafür?** Rochade = König zwei Felder setzen (Turm folgt von selbst). Schlagen = auf die
   fremde Figur setzen (sie wandert neben das Brett). Würfeln = Becher schütteln.
2. **Gibt es eine sinnvolle Vorgabe?** Bauernumwandlung → Dame (fast immer richtig), ohne Nachfrage.
3. **Ist es nur eine Information?** Dann am Tisch zeigen statt Text: leuchtende Ziele, Glimmen unter dem König im
   Schach, markierter letzter Zug, Platzset des Spielers am Zug leuchtet, Vibration am Handy.
4. Nur wenn nichts davon passt: knappe Auswahl **am Tisch** (z. B. Figuren zur Wahl neben dem Feld), kein Modal.

Der Status oben ist eine Zeile („Du bist am Zug“), kein Erklärtext. Einstellungen (Hausregeln) gibt es nur in der Lobby.

### 12.4 Damit Updates nichts kaputt machen

- **Pflicht-Prüfung** (`tabletop_server/conformance.py`): Für jedes Spiel unter `games/*/server/main.py` spielen
  Computer ganze Partien; geprüft werden lückenlose Ereignisse, gültige Felder/Züge, Ansichten je Platz als JSON,
  Speichern/Laden mitten in der Partie. Läuft in der CI (`test_conformance.py`) – ein neues Spiel ist automatisch dabei.
- Jedes Spiel hat dazu eigene Regel-Tests und einen Browser-Test (Handy + Desktop), plus einen Test über den Hub.
- Ältere Clients ignorieren unbekannte Ereignisse; Spielstände speichern nur, was zum Wiederherstellen nötig ist.

### 12.5 Neues Spiel hinzufügen (heute)

**Vorlage: `games/dame/`** – kopieren und umbauen. Seit Engine 2.3 braucht ein Spiel:

1. `server/layout.py`: Felder und Figuren aus den Brett-Hilfen (`tabletop_server.boards`: `grid`, `hexgrid`,
   `ring_track`, `tray`, `layout`). Figuren nennen nur ihre Art (`pawn`, `disc`, `king`, `stone`, `flip`, `cube`, `cone`,
   `ring`) und Farbe – die Engine baut die Modelle.
2. `server/rules.py`: `GameRules` (§12.2). Für die Anzeige nur Daten in den Spielstand: `say`, `alerts`, `scores`,
   `marks`, `result`/`finished`; Hinweise als Ereignis `NOTE` (Doku im Kopf von `tabletop_server/rules.py`).
3. `server/main.py`: `GameDef(…, seat_names=[…], lobby="…", version=…)` bzw. `Variant(…)` je Spielart.
4. `client/src/main.ts`: `startTable({ id, title })` – fertig. Eigenes Brett/eigene Figuren nur, wenn das Standard-Holzbrett
   nicht passt (`board: (layout, ctx) => …`, `piece: (id, spec, layout) => …`, Beispiele: Mensch, Schach).
   `index.html` enthält nur das Skript; `package.json`, `tsconfig.json`, `vite.config.ts` aus der Vorlage (Port anpassen).
5. Tests: `tests/test_rules.py` (ruft am Ende `check_game`), `tests/ui/<spiel>_smoke.py`.
6. Einbinden in den Hub: `Dockerfile`, Dienst in `docker-compose.yml`, `party-hub/nginx-locations.conf` + `fly_nginx.conf`,
   `Dockerfile.fly` + `fly_entrypoint.sh`, Hub (`partyState.games`, `votes`, `getGameUrl`, `SLOT_GAMES`, Titelbild
   `party-hub/assets/cover_<spiel>.jpg`), `KNOWN_GAME_IDS` in `party-server/server.js`, CI-Schritte.

Schritt 6 schrumpft mit **E2.7** (ein Container für alle Tisch-Spiele, `game.json`, Hub liest die Liste vom Server)
auf „Ordner anlegen“. Dame und Mau-Mau sind bisher nur Vorlagen (laufen lokal und in der CI, noch nicht im Hub).

### 12.6 Was die Engine für welche Spiele noch braucht

| Fähigkeit | Stand | Spiele |
|---|---|---|
| Würfel, Figuren auf Feldern, Schlagen, Bots, Hausregeln | ✅ 1.x | Mensch, Ludo, Leiterspiel |
| Aktionen, Art wechseln, Antippen → Ziel, Computer mit Bedenkzeit | ✅ 2.0 | Schach, Dame, Mühle, Halma, Reversi |
| Ansicht je Platz (Geheimes) | ✅ 2.0 (Server) | Grundlage für alle Kartenspiele |
| Mehrere Bretter je Spiel, Platzzahl/Lage je Brett, mehrere gleichzeitig am Zug, Figuren wechseln den Besitzer | ✅ 2.1 | Mensch 6/8, Teamschach, Tandem, Vierschach |
| Karten, Stapel, Hand, Auslage, geheime Vorderseiten, Knöpfe (Aktionen ohne Figur) | ✅ 2.4 | Mau-Mau, Rommé, Skat, Uno-artige Spiele |
| Eingreifen außerhalb des Zugs, Marker/Zähler/Geld | E2.4 | Spiele im Stil von Munchkin, Catan, Monopoly v2 |
| Oberfläche/Statuszeile/Siegerehrung aus Daten, Standard-Brett und -Figuren, Raster/Hex/Laufbahn aus Daten | ✅ 2.3 | Dame, Mühle, Go, Reversi, Halma |
| Plättchen mit Drehung | später | Carcassonne-artige Legespiele |
| Freier Modus ohne Regeln | später | beliebige Spiele „wie am echten Tisch“ |

### 12.7 Spielvarianten (Engine 2.1)

Ein Spiel kann mehrere Spielarten mitbringen – jede mit eigenem Brett, eigener Platzzahl, eigenen Regeln:

```python
GAME = GameDef("mensch", "Mensch ärgere dich nicht", version="1.1.0", auto_variant=True, variant_label="Brett",
               variants=[Variant("4", "Klassisch für 2–4", farben4, layout=L4, rules=MenschRules(c4), players=(1, 4)),
                         Variant("6", "Großes Brett für 5–6", farben6, layout=L6, rules=MenschRules(c6), players=(5, 6)),
                         Variant("8", "Riesenbrett für 7–8", farben8, layout=L8, rules=MenschRules(c8), players=(7, 8))])
```

- Der Host wählt in den Hausregeln (Schlüssel `variant`). Mit `auto_variant` gibt es „automatisch“: Will jemand in die
  volle Lobby, wechselt der Tisch auf das nächstgrößere Brett und gibt ihm den Platz – keine Frage an irgendwen.
- Ein Wechsel geht nur in der Lobby und kommt als ein Ereignis `BOARD_CHANGED`. Plätze rücken der Reihe nach zusammen.
- `seat_angles` legt fest, wo die Plätze am Tisch liegen (Partner nebeneinander); ohne Angabe gleichmäßig.
- Regeln greifen auf `room.layout`, `room.seats`, `room.seat_colors` zu (nicht `room.game_def.…`).
- Client: Platzsets/Namensschilder folgen von selbst; das Spiel baut sein Brett neu, wenn sich `state.layout` ändert
  (Beispiel `games/mensch/client/src/main.ts`), und gibt dem Würfel ggf. neue Hindernisse (`dice.setObstacles`).
- Mehrere Plätze gleichzeitig am Zug (`to_move` mit mehreren Einträgen, z. B. Tandem-Schach): Der Client färbt alle
  Platzsets (`setTurnSeat([...])`), der Computer-Treiber wechselt fair zwischen den Spuren (`Room.auto_member`). Bei
  geheimen/eigenen Zügen je Platz `shared_view = False`, damit jeder nur seine eigenen Zielfelder sieht.
- Figuren dürfen den Besitzer wechseln (Tandem: geschlagene Figur geht an den Partner) oder einem Team gehören –
  bei Regel-API 2 entscheidet nur `actions`/`can_touch`, nicht das `seat` im Layout.

Schach (Engine 2.2): `klassisch` (2), `team` (4, `seat_angles=[20, -20, 160, 200]`), `tandem` (4, zwei Bretter), `vierer`
(4, Kreuzbrett) – Details in `games/schach/README.md`.

### 12.8 Karten, Stapel, Hände (Engine 2.4)

Vorlage: `games/maumau/`. Bausteine in `tabletop_server/cards.py` (Doku im Kopf der Datei):

```python
fields = {"deck": zone(-0.55, 0, "stack"), "pile": zone(0.55, 0, "stack", up=True)}
fields |= {f"hand-{s}": zone(*seat_point(s, n, 4.55), "hand", owner=s, angle=s * 360 / n) for s in range(n)}
LAYOUT = layout(fields, card_pieces(32, "deck"), shape="round", size=3.4, surface="felt") | {"cards": french_deck(32)}
# Regeln: deal_new(room, "deck", list(CARDS)); room.move_piece(top(room, "deck"), f"hand-{s}"); shuffle(room, "deck")
```

- **Geheimes bleibt beim Server**: Die Vorderseite (`face`) steht nie im Layout und verlässt den Server nur als `show`
  an die, die sie sehen dürfen. Die Pflicht-Prüfung prüft das für jedes Spiel.
- **Am Tisch**: Karte aus der Hand auf die Ablage ziehen oder antippen (ein Ziel → sofort), Stapel antippen = ziehen
  (oberste Karte hat das Ziel „eigene Hand“). Die eigene Hand ist sortiert, gekippt und größer; spielbare Karten rücken vor.
- **Knöpfe** nur für echte Entscheidungen ohne Handgriff (Farbe wünschen, „Weiter“): Aktion mit `label`, Regeln mit
  `action_buttons = True`.

Hinweis: Kommerzielle Spiele (Munchkin, Catan …) nur als **eigene Umsetzung der Mechanik** mit eigenen Karten,
Texten und Grafiken – keine Kopie von Kartentexten, Namen oder Bildern.
