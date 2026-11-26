# Treffen-Spieltisch – Konzept

> Stand: 2026-11-26 · Status: **abgestimmt · M1 ✅ · M2 ✅ · M3 ✅ · M4 ✅ · als Nächstes M5 (Lobby/Hub, Persistenz, Feinschliff)** · Erstes Spiel: Mensch ärgere dich nicht

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
| **Würfel** | W6, später andere | im Becher schütteln/werfen; rollt physikalisch, Ergebnis vom Server |
| **Karte / Stapel** | Ereignis-, Spielkarten | ziehen, umdrehen, mischen, ablegen |
| **Hand** | Karten eines Spielers | nur für den Besitzer sichtbar, aufgefächert am eigenen Platz |
| **Marker / Geld** | Scheine, Chips, Häuser | stapeln, zählen, übergeben |
| **Sitzplatz** | 4 Seiten des Tisches | eigener Platz ist immer „unten“; Name, Farbe, Avatar |

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

Umgesetzt in `packages/tabletop-server/tabletop_server/rules.py` (Doku im Dateikopf), Mensch-Regeln in
`games/mensch/server3d/rules.py`. Abweichend vom Entwurf hier: Regeln arbeiten direkt auf `room.pieces`/
`room.game` und liefern Ereignisse ohne Nummer; `public()` statt `view_for()` (Mensch hat keine geheimen Infos).

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
| **M5 Fertig** | Lobby, Einstellungen, Persistenz, Zuschauer, Handy-Feinschliff → ersetzt das heutige 2D-Mensch im Hub |
| später | Karten/Hand/Stapel, Geld/Marker, freier Modus (Einstellung), weitere Spiele, Monopoly v2 |

## 10. Lokal ausprobieren (ohne Python/Node auf dem Host)

```bash
# Client bauen (Repo-Wurzel)
podman run --rm -v "$PWD":/repo:z -w /repo/games/mensch/client docker.io/library/node:22-alpine sh -c 'npm ci && npm run build'
# Server starten → http://127.0.0.1:8095/  (zweites Fenster/Handy mit gleichem ?room=… öffnen)
podman run -d --name tisch-dev -p 8095:8095 -v "$PWD":/repo:ro,z localhost/mono-test-deps sh -c 'cd /tmp && exec python -u /repo/games/mensch/server3d/main.py'
# Browser-Test (zwei Spieler, Präsenz, Leerlauf ohne Rendern) mit Screenshots
podman run --rm --network=host -v "$PWD/games/mensch":/work:z -w /work localhost/mono-ui-test python tests/ui/tisch_smoke.py http://127.0.0.1:8095 /work/tests/ui/shots
```

## 11. Entscheidungen (Nutzer, 2026-11-26)

| Frage | Entscheidung |
|---|---|
| Regeln | Spielgefühl hat Vorrang, Regeln prüft der Server automatisch mit. Freier Modus (wie Tabletop Simulator) evtl. später als Einstellung |
| Erstes Spiel | Mensch ärgere dich nicht (einfache Regeln, schnell gespielt) |
| Optik | **Realistisch-warm**: Holztisch, weiches Licht, echte Materialien – Spieleabend am Küchentisch |
| Material | **Selbst modellieren** (einfache, saubere Formen per Code), keine fremden Assets → keine Lizenzfragen |
| Spielerzahl Mensch | **Klassisch 4**; 6er-Brett später als zweites Brett möglich |
| Server | **Gemeinsames Python-Paket** für alle Tisch-Spiele (`packages/tabletop-server`) |
