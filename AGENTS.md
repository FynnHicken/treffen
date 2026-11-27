# AGENTS.md – Einstieg für KI-Assistenten (und Menschen)

Diese Datei ist der **Startpunkt für jede KI-Instanz** (Claude, Gemini/Antigravity, Codex, …), die in
diesem Repo weiterarbeitet. Erst diese Datei lesen, dann die verlinkten Detail-Dokumente.
Wer etwas Wesentliches ändert, **aktualisiert den Abschnitt „Aktueller Stand“** unten und – für
Monopoly – die Roadmap in [`games/monopoly/DEVELOPMENT.md`](games/monopoly/DEVELOPMENT.md).

## Was ist das?

**Treffen** ist eine selbst gehostete, werbefreie Spieleabend-Plattform. Ein **Hub** (Lobby mit
Räumen, Host, Abstimmung, synchronem Start) bettet mehrere Multiplayer-Spiele per iframe ein:

| Teil | Pfad | Stack | Intern | Über Hub-Nginx |
|---|---|---|---|---|
| Hub-Frontend | `party-hub/` | Vanilla JS + Nginx | 80 (Host 8000) | `/` |
| Hub-Sync-Server | `party-server/` | Node.js, `ws` | 3001 | `/party-ws` |
| skribbl | `games/skribbl/` | Go (Scribble.rs) | 8080 | `/skribbl/` |
| UNO | `games/uno/` | Node.js | 8085 (Host 8086) | `/uno/` |
| Codenames | `games/codenames/` | Python/Flask | 5000 (Host 5005) | `/codenames/` |
| Guess The Price | `games/guess-the-price/` | React/Vite + Express/Prisma (SQLite) | 8088 / 3005 | `/price-guess/`, `/price-guess-api/`, `/price-guess-socket/` |
| **Monopoly 3D** | `games/monopoly/` | Python FastAPI + Three.js | 8090 | `/monopoly/` |
| **Mensch ärgere dich nicht** (Spieltisch 3D) | `games/mensch/` + `packages/tabletop*` | Python FastAPI + Three.js | 8095 | `/mensch/` |
| **Schach** (Spieltisch 3D) | `games/schach/` + `packages/tabletop*` | Python FastAPI + Three.js | 8096 | `/schach/` |

**Fokus des Nutzers: Monopoly perfektionieren – und daraus einen Brettspiel-Baukasten machen**, damit weitere
Brettspiele möglichst viel Code (Rendering, Verbindung, UI) übernehmen: [`packages/boardgame-kit/README.md`](packages/boardgame-kit/README.md).
**Neu (2026-11-26): Treffen-Spieltisch** – spielneutrales 3D-Brettspiel-Framework, erstes Spiel Mensch ärgere dich nicht.
Konzept & Fahrplan: [`docs/tabletop/KONZEPT.md`](docs/tabletop/KONZEPT.md). Code: `packages/tabletop` (Client-Engine),
`packages/tabletop-server` (Python), Spiele `games/mensch/` und `games/schach/`. **M1–M5 ✅, Engine 2.3.0** – im Hub unter `/mensch/` (2–8 Spieler) und `/schach/` (klassisch, Team, Tandem, Vierschach), mit Regeln, Computergegnern, Hausregeln und gespeicherten Spielständen. Neues Tisch-Spiel anlegen: [`docs/tabletop/KONZEPT.md` §12.5](docs/tabletop/KONZEPT.md), Engine-Änderungen: [`packages/CHANGELOG.md`](packages/CHANGELOG.md). Entscheidungen des Nutzers: Spielgefühl hat
Vorrang, Regeln werden automatisch vom Server mitgeprüft; freier Modus (wie Tabletop Simulator) evtl. später als Einstellung.
Der Monopoly-Client ist ein Vite-Projekt (`games/monopoly/client/`), das vor dem Deployen gebaut wird (passiert im Docker-Image). → [`games/monopoly/DEVELOPMENT.md`](games/monopoly/DEVELOPMENT.md)

## Deployment-Varianten

- **Docker/Podman Compose** (Mac mini / Heimserver): `./start.sh` → Portal `http://localhost:8000`.
  Mit `MY_DOMAIN=…` zusätzlich Caddy (HTTPS, `docker-compose.caddy.yml`).
  Hub-Nginx: `party-hub/nginx.conf` + `nginx-locations.conf` (gemeinsame Locations),
  HTTPS nur wenn Zertifikate unter `./letsencrypt/live/<SSL_DOMAIN>/` liegen (`40-enable-ssl.sh`).
- **Fly.io All-in-One**: `Dockerfile.fly`, `fly_entrypoint.sh`, `fly_nginx.conf`, `fly.toml`.
- Mac-mini-Anleitung: [`AGY_INSTRUCTIONS.md`](AGY_INSTRUCTIONS.md).

## Git & Konventionen

- Remote `origin` = `git@github.com:NobleBrains/treffen.git` (Repo des Nutzers).
  Es gibt einen Fork `FynnHicken/treffen` (Mitentwickler); er wurde am 2026-11-21 in `main` gemergt.
- **Commits**: Deutsch, Conventional-Commit-Präfix mit Scope, z. B.
  `fix(monopoly): …`, `feat(monopoly): …`, `docs: …`. Body erklärt *warum*, nicht nur *was*.
- Bisher wurde **direkt auf `main` gepusht** – das hat der Nutzer ausdrücklich so gewünscht.
  Bei Unsicherheit trotzdem fragen.
- Alle UI-Texte und Logs sind **Deutsch**, Währung im Monopoly ist **DM**.
- Nichts committen, was Secrets enthält (`.env`, Zertifikate unter `letsencrypt/`).

## Bewusste Entscheidungen des Nutzers (nicht eigenmächtig ändern)

- **Ziel des Nutzers (2026-11-26):** sicherer werden, Spiele leichter hinzufügen, Updates sollen die Seite
  nicht mehr so leicht kaputt machen. Bugs dürfen behoben werden; bei Änderungen, die das **Konzept**
  der Seite berühren, vorher fragen.
- Freiheiten für Mitspieler („jeder kann …“) sind **Host-Einstellungen, Standard aus**.
- **Spieltisch-Engine (2026-11-27):** hat eine **Versionsnummer** (SemVer, `packages/CHANGELOG.md`; Client
  `packages/tabletop/src/version.ts` = Server `tabletop_server/version.py`) – bei jeder Engine-Änderung erhöhen und
  dokumentieren. Engine-Updates dürfen Spiele nicht kaputt machen (alte Regel-API über Übersetzungsschicht weiter
  unterstützen), neue Spiele sollen leicht hinzuzufügen sein. **Rückfragen/Dialoge für Spieler minimal halten** –
  möglichst alles über Handgriffe am Tisch (Brettspiel-Gefühl). Leitlinie: `docs/tabletop/KONZEPT.md` §12.3.

- **Monopoly-Assets** (`games/monopoly/static/assets/`, inkl. `rom/`) bleiben unverändert.
  Kartentexte werden deshalb im Server überschrieben (`CARD_TEXTS_DE` in `game_state.py`), nicht im JSON.
- **Debug-Passwort `admin123`** (Monopoly, steht auch im Client) bleibt vorerst so – „später ändern“.

## Sicherheitsmodell (gilt für Hub und Monopoly – bitte beibehalten)

- Alles, was von anderen Clients kommt (Namen, Avatare, Chat, Raumcodes, IDs), wird **serverseitig
  bereinigt** und im Client **vor `innerHTML` escaped** (`escapeHtml()` im Hub, `esc()` in Monopoly).
- Hub (`party-server/server.js`): Spieler-ID ist per Client-Secret an den Browser gebunden;
  Host-/Spieleraktionen nutzen nur die **an den Socket gebundene** ID, nie Felder aus der Nachricht.
- **Raum-Einstellungen des Hubs** (⚙️, nur Host): `HUB_SETTINGS_SCHEMA` in `server.js` + Texte in
  `HUB_SETTING_LABELS` in `party-hub/app.js`. Neue Einstellung = je ein Eintrag dort, der Server erzwingt sie.
  Bisher: `anyoneCanVote` (Standard aus → nur der Host startet/beendet Abstimmungen).
- Monopoly: Aktionen prüfen Zug/Host/Mitgliedschaft serverseitig; Raum-/Spieler-IDs `[A-Za-z0-9_-]{1,40}`.
  Erste WebSocket-Nachricht ist `AUTH {secret}` – die Spieler-ID ist daran gebunden; `bot_`-IDs sind gesperrt.
- **Spiel-Tickets**: Der Party-Server signiert pro Person ein Ticket (`gameTicket` in `ROSTER_SYNC`,
  HMAC mit `TREFFEN_TICKET_SECRET`), der Hub hängt es als `#ticket=…` an die Spiel-URL. Spiele glauben
  das Host-Recht nur mit gültigem Ticket. `start.sh` erzeugt den Schlüssel in `.env` (nie committen);
  auf Fly besser per `fly secrets set TREFFEN_TICKET_SECRET=…`. Neue Spiele sollten das genauso nutzen
  (Prüfcode: `games/monopoly/server/auth.py`).

## Werkzeuge

- `tools/asset-labeler/` – lokale Seite zum Anhören/Ansehen und Benennen von Sounds und 3D-Modellen
  (Labels in `~/AGY/Treffen/asset-labels.json`). Siehe dessen README.

## Testen

**CI** (`.github/workflows/tests.yml`) läuft bei jedem Push auf `main` und bei Pull Requests: Monopoly-Suite,
Spieltisch-/Mensch-Tests (inkl. Start über den Hub), Hub-Sync-Server-Tests, JS-Syntax, `docker compose config`, `nginx -t`, alle Images bauen und
ein Browser-Rauchtest des Hubs. **Rot = nicht deployen.** Status: `gh run list --limit 5`.

- **Monopoly**: `games/monopoly/tests/run_tests.sh` (Podman oder Docker, nichts auf dem Host
  installieren). Details in DEVELOPMENT.md. Vor jedem Push laufen lassen.
- **Hub-Sync-Server**: `party-server/test/server.test.mjs` (`node --test`). Lokal ohne Node auf dem Host:
  `podman run --rm -v "$PWD/party-server":/app:ro,z docker.io/library/node:22-alpine sh -c 'cp -r /app /s && cd /s && npm ci --silent && npm test'`
- **Hub im Browser**: `party-hub/tests/browser_smoke.py` (Playwright; Hub muss laufen, Aufruf im Dateikopf).
- **Tisch-Spiele (Mensch, Schach, …)**: Pflicht-Prüfung aller Spiele + Versions-Check
  `packages/tabletop-server/tests/test_conformance.py`; je Spiel `games/<spiel>/tests/test_rules.py`, Browser-Test unter
  `games/<spiel>/tests/ui/`, Start über den Hub `party-hub/tests/<spiel>_via_hub.py` (Aufrufe in den Dateiköpfen).
- **Abhängigkeiten sind exakt gepinnt** (`requirements.txt`, `package-lock.json`). Updates bewusst machen:
  Version ändern → Tests → committen.
- Auf diesem Rechner ist **kein Node/npm auf dem Host** – JS-Syntax per
  `podman run --rm -v .:/j:ro,Z docker.io/library/node:22-alpine node --check /j/<datei>.js`.

## Aktueller Stand (zuletzt aktualisiert: 2026-11-27)

Erledigt und auf `main`:
1. Infrastruktur-Review: Compose-GTP auf SQLite, Nginx-Socket-Route, optionales HTTPS, Ports/Doku.
2. Hub-Sicherheit: XSS, Host-Übernahme, Reconnect.
3. Monopoly Block 1: Zug-/Host-Prüfungen, Fehlerbehandlung, XSS, Bankrott-Geldmenge, Auktions-Timer.
4. Monopoly Block 2: Bot-Treiber pro Raum mit Lock, Abwesenheit (Computer übernimmt), Zuschauer, Reconnect.
5. Monopoly Block 3: Bot-KI (`bot_ai.py`), Bot↔Bot-Handel, lesbare Kartentexte.
6. Tests ins Repo (`games/monopoly/tests/`), diese Dokumentation.

7. Monopoly Gameplay-Paket G1–G10: Raum-Einstellungen in der Lobby (Startgeld, Spieldauer ∞/30–120 Min,
   Zug-Timer, Bot-Schwierigkeit, Frei-Parken-Topf, 400 DM auf Los, Gefängnis-Würfe), Bot-Angebote an
   Menschen, Handelsablauf nach 60 s, Zuschauer-Ansicht, Header-Uhren, Zeitende mit Rangliste.

8. Playtest-Feedback 1: fremde Züge ohne Zwangs-Popups, Kontostand in der Auktion, Handel mit Kartenbildern
   und Partner-Übersicht, Kartenstapel-Bug, Gefängnis-Pasch befreit nur, Bauregel „nur auf der eigenen Farbe“.

9. Sicherheit S1 (2026-11-26): Monopoly-Identität per Client-Secret, keine Bot-Übernahme, Host per
   signiertem Hub-Ticket (siehe Sicherheitsmodell oben).

10. Stabilität (2026-11-26): CI, Hub-Tests, gepinnte Abhängigkeiten, Raum-Einstellungen im Hub (⚙️),
    Abstimmung über Geräte hinweg repariert (`broadcastVotes` fehlte), Nginx-Resolver aus `resolv.conf`
    (feste, teils nicht existierende Resolver ließen Anfragen alle 10 s bis zu 5 s hängen).

12. Monopoly-Client auf Vite + TypeScript (2026-11-26): `games/monopoly/client/`, Three.js r128 aus npm
    (identisch zur vorherigen Kopie), Build im Docker-Image, gemeinsamer Baukasten `packages/boardgame-kit/`
    (Identität, WebSocket, Escaping). Optik pixelgenau unverändert (Screenshot-Vergleich).

11. Monopoly-Spielstände in SQLite (2026-11-26): Partien überstehen Neustart/Update, Volume `./data/monopoly`.

15. Guess The Price im Hub (2026-11-26): Start aus dem Hub führt alle in eine gemeinsame Runde pro Raum
    (`hub-<RAUM>`), Namen und Host-Recht per Hub-Ticket (`apps/server/src/domain/hub/hub-ticket.ts`), Aktionen an den
    Socket gebunden, Preis erst mit dem Ergebnis. Oberfläche deutsch, Euro, dunkel. Produktfotos lokal von Wikimedia
    Commons (`apps/client/public/products/`, Lizenzen in `QUELLEN.md`). Abhängigkeiten per `package-lock.json` gepinnt.
    Browser-Test: `party-hub/tests/gtp_via_hub.py`.

17. Spieltisch-Engine 2.0.0 + Schach (2026-11-27): Engine hat eine Versionsnummer (`packages/CHANGELOG.md`), neue
    Regel-API 2 mit Aktionen (`GameRules`: `setup/actions/apply/view/to_move/bot_action`), Ansicht je Platz für geheime
    Infos, `PIECE_CHANGED` (Figur wechselt die Art), Antippen → Ziel antippen, Computer rechnet außerhalb des Raum-Locks,
    Pflicht-Prüfung für jedes Tisch-Spiel in der CI. Mensch (API 1) läuft unverändert über `LegacyRules`.
    **Schach** (`/schach/`, Port 8096): Holzbrett, gedrechselte Figuren, Geschlagene neben dem Brett, Rochade per
    Königszug, Umwandlung automatisch zur Dame, Matt/Patt/Remis-Regeln. Computer: **Stockfish 19** in 5 Stufen (Hausregel),
    ein Prozess für alle Partien, ~250 MB nur solange gespielt wird; Ersatz = eingebauter Python-Computer
    (`games/schach/README.md`, Stockfish-Download mit Prüfsumme: `games/schach/tools/fetch_stockfish.py`, GPL-3.0).
    Zuggenerator per Perft geprüft (`games/schach/tests/test_rules.py`). Konzept & Fahrplan E2.1–E2.3:
    `docs/tabletop/KONZEPT.md` §12.

18. Spielvarianten, Engine 2.1/2.2 (2026-11-27): Ein Spiel kann mehrere Bretter/Spielarten mitbringen (`Variant`, Hausregel
    „Spielvariante“, `BOARD_CHANGED`, Lage der Plätze `seat_angles`, mehrere Plätze gleichzeitig am Zug, Computer reihum).
    **Mensch 1.1.0** für 4/6/8 – das Brett wächst in der Lobby automatisch mit (4er-Kreuz Feld für Feld wie vorher).
    **Schach 1.2.0**: Teamschach (2 gegen 2 an einem Brett, Stockfish), Tandem (zwei Bretter, Einsetzen aus dem Vorrat,
    `server/tandem.py`), Vierschach (Kreuzbrett, Teams oder jeder gegen jeden, Punkte, `server/vierer.py`). Konzept §12.7,
    `games/schach/README.md`, Tests `packages/tabletop-server/tests/test_variants.py`, `games/*/tests/…variants…`/`boards_smoke.py`.

19. Spieltisch-App, Engine 2.3 (2026-11-27): Auftrag des Nutzers: „alles, was man für Tabletop-Spiele braucht, soll die
    Engine anbieten“ – Spiele sollen sich mit wenig spielspezifischem Code einbinden lassen. Client: `startTable()` baut
    die ganze Oberfläche; Statuszeile/Siegerehrung/Markierungen kommen als Daten aus den Regeln (`say`, `alerts`,
    `scores`, `marks`, `NOTE`); Standard-Brett und -Figuren; Server: `tabletop_server.boards`. Mensch 1.2.0 und
    Schach 1.3.0 umgestellt. **Dame 1.0.0** (`games/dame/`) = Vorlage ohne Client-Code, läuft in CI, **nicht im Hub**
    (Einbinden erst nach Rückfrage). Fahrplan danach: Karten & Zonen (2.4), freier Tisch (2.5), Uhr/Rücknahme/Marker (2.6).

16. Hub-Avatare in den Spielen (2026-11-26): Der party-server liefert jeden Avatar als Bild,
    `/party-ws/avatar/<RAUM>/<Hub-Spieler-ID>.svg` (strenge CSP, ETag), und als `.json` ({color, face}) für
    Canvas/WebGL. Die Spiele kennen die ID aus dem Hub-Ticket (`pid`), es fließen keine Bilddaten durch ihre
    Protokolle. Eingebaut in Guess The Price (Warteraum, Ergebnis, Wertung; `PlayerAvatar`) und den Spieltisch
    (Platzschilder, Zeiger, Statuszeile, Siegerehrung; `packages/tabletop/src/ui/avatar.ts`) und skribbl (Spielerliste;
    Client schickt das Ticket als `hub-avatar`, Prüfung in `games/skribbl/internal/game/hubticket.go`). Ohne Ticket gibt es
    keinen Avatar (Anfangsbuchstabe bzw. nichts). Neues Spiel: `pid` aus dem Ticket → URL bauen → `<img>`.

14. Hub-Lobby als Kachelraster (2026-11-26, Entwurf „F1 · Arcade × Bento“): `party-hub/tiles.js` (`HUB_TILES` –
    Kachel hinzufügen/entfernen = ein Eintrag), Stil in `party-hub/hub.css`. Bühne mit ausgewähltem Spiel, Einladen,
    Spieler, „Heute gespielt“ (Verlauf kommt vom Party-Server, `history` in `ROSTER_SYNC`), Abstimmung nur solange eine
    läuft. Feste Arcade-Optik, der Design-Umschalter ist entfallen. Spieldaten (Cover, Dauer) in `partyState.games`.

13. Treffen-Spieltisch M1–M5 (2026-11-26): Mensch ärgere dich nicht in 3D im Hub (`/mensch/`, Host per Ticket),
    Hausregeln in der Lobby, Spielstände in SQLite (Volume `./data/mensch`), ein Becher wird herumgereicht.
    Der 2D-Prototyp (`games/mensch/server`, `static`) wurde ersetzt.

**Umbau-Plan (mit dem Nutzer am 2026-11-26 abgestimmt, Schritt für Schritt):** 1. ✅ Monopoly-Verbindungen
absichern · 1b. ✅ CI + Hub-Tests · 2. ✅ Monopoly-Spielstände in SQLite speichern · 3. 🚧 Vite + TypeScript
(✅ Build-Pipeline + Baukasten angelegt; als Nächstes legacy-Module in `packages/boardgame-kit` herauslösen) · 4. Hub-Client: Server als einzige Wahrheit (localStorage/BroadcastChannel-Abgleich raus), Spiele
als Plug-ins mit Manifest statt fest verdrahtet · 5. Design/Handy. Performance-Notizen für später:
`broadcast_room` sendet seriell unter dem Raum-Lock (langsamer Client bremst alle), volle `to_dict()` bei
jedem Event, Hub schickt Avatare (bis 32 KB) bei jedem `ROSTER_SYNC`, 3D rendert dauerhaft mit Soft-Shadows,
34 MB Assets ohne komprimierte Texturen.

**➡️ Offene Arbeit der letzten Sitzung: [`HANDOFF.md`](HANDOFF.md) (Modus „Manuell“, Handy-Überarbeitung).**

**Checkliste Nutzer:** Handytest Mensch (über den Hub, echtes Gerät) – Feedback abwarten, dann Handy-Feinschliff.

**Als Nächstes:** Browser-Playtest des Gameplay-Pakets durch den Nutzer (Server-Seite ist getestet,
UI noch nicht von Hand). Weitere Ideen: [`games/monopoly/DEVELOPMENT.md` → Roadmap](games/monopoly/DEVELOPMENT.md#roadmap--status).

Lokaler Testserver (falls er läuft): Podman-Container `treffen-monopoly-dev`, `http://127.0.0.1:8090/`
bzw. im WLAN `http://<LAN-IP>:8090/` – Start-/Neustart-Befehle in DEVELOPMENT.md Abschnitt 2.
