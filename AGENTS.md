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

**Fokus des Nutzers: Monopoly perfektionieren.** → [`games/monopoly/DEVELOPMENT.md`](games/monopoly/DEVELOPMENT.md)

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

- **Monopoly-Assets** (`games/monopoly/static/assets/`, inkl. `rom/`) bleiben unverändert.
  Kartentexte werden deshalb im Server überschrieben (`CARD_TEXTS_DE` in `game_state.py`), nicht im JSON.
- **Debug-Passwort `admin123`** (Monopoly, steht auch im Client) bleibt vorerst so – „später ändern“.

## Sicherheitsmodell (gilt für Hub und Monopoly – bitte beibehalten)

- Alles, was von anderen Clients kommt (Namen, Avatare, Chat, Raumcodes, IDs), wird **serverseitig
  bereinigt** und im Client **vor `innerHTML` escaped** (`escapeHtml()` im Hub, `esc()` in Monopoly).
- Hub (`party-server/server.js`): Spieler-ID ist per Client-Secret an den Browser gebunden;
  Host-/Spieleraktionen nutzen nur die **an den Socket gebundene** ID, nie Felder aus der Nachricht.
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

- **Monopoly**: `games/monopoly/tests/run_tests.sh` (Podman oder Docker, nichts auf dem Host
  installieren). Details in DEVELOPMENT.md. Vor jedem Push laufen lassen.
- Hub: kein automatisierter Test im Repo; manuell `node --check` und Compose-Start.
- Auf diesem Rechner ist **kein Node/npm auf dem Host** – JS-Syntax per
  `podman run --rm -v .:/j:ro,Z docker.io/library/node:20-alpine node --check /j/<datei>.js`.

## Aktueller Stand (zuletzt aktualisiert: 2026-11-26)

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

**Umbau-Plan (mit dem Nutzer am 2026-11-26 abgestimmt, Schritt für Schritt):** 1. ✅ Monopoly-Verbindungen
absichern · 2. Monopoly-Spielstände in SQLite speichern · 3. Vite + TypeScript, `game_client.js` in Module
zerlegen · 4. Hub-Client: Server als einzige Wahrheit (localStorage/BroadcastChannel-Abgleich raus), Spiele
als Plug-ins mit Manifest statt fest verdrahtet · 5. Design/Handy. Performance-Notizen für später:
`broadcast_room` sendet seriell unter dem Raum-Lock (langsamer Client bremst alle), volle `to_dict()` bei
jedem Event, Hub schickt Avatare (bis 32 KB) bei jedem `ROSTER_SYNC`, 3D rendert dauerhaft mit Soft-Shadows,
34 MB Assets ohne komprimierte Texturen.

**➡️ Offene Arbeit der letzten Sitzung: [`HANDOFF.md`](HANDOFF.md) (Modus „Manuell“, Handy-Überarbeitung).**

**Als Nächstes:** Browser-Playtest des Gameplay-Pakets durch den Nutzer (Server-Seite ist getestet,
UI noch nicht von Hand). Weitere Ideen: [`games/monopoly/DEVELOPMENT.md` → Roadmap](games/monopoly/DEVELOPMENT.md#roadmap--status).

Lokaler Testserver (falls er läuft): Podman-Container `treffen-monopoly-dev`, `http://127.0.0.1:8090/`
bzw. im WLAN `http://<LAN-IP>:8090/` – Start-/Neustart-Befehle in DEVELOPMENT.md Abschnitt 2.
