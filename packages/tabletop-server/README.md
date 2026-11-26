# tabletop-server – gemeinsamer Server für die Tisch-Spiele (Python/FastAPI)

`create_app(GameDef(...), client_dist=...)` liefert eine fertige App: WebSocket `/ws/<raum>/<id>`,
`AUTH` + Hub-Tickets (`auth.py`), Räume/Sitzplätze/Host (`rooms.py`), nummerierte Ereignisse, Präsenz-Relay
(gedrosselt, geprüft), paralleles Senden mit Timeout, Aufräumen, Auslieferung des gebauten Clients.
Beispiel: `games/mensch/server/main.py`. Protokoll: Kopf von `rooms.py` und `docs/tabletop/KONZEPT.md` §5.

Tests: `python -I packages/tabletop-server/tests/test_tabletop_ws.py` (startet selbst einen Server; ohne
Python auf dem Host: `podman run --rm -v "$PWD":/repo:ro,z localhost/mono-test-deps sh -c 'cd /tmp && python -I /repo/packages/tabletop-server/tests/test_tabletop_ws.py'`).

Spielablauf mit Regeln (M4): `GameDef(..., rules=MeineRegeln())` → Lobby (Plätze, Computer per `ADD_BOT`),
`START` (Host), Würfeln/Ziehen nur im eigenen Zug (Server prüft), `GAME_UPDATED` nach jeder Änderung,
Bot-Treiber spielt Computer und vertritt Getrennte nach `TABLETOP_AWAY_GRACE_SEC` (20 s), `NEW_ROUND`.

Hausregeln (M5): `Rules.settings_schema = {key: {default, label, hint?, min?, max?, choices?}}`. Der Host ändert sie
in der Lobby (`SET_SETTINGS`, geprüft per `valid_setting`), alle bekommen `SETTINGS_UPDATED`; beim Start stehen die
Werte über `room.settings()` bereit. Der Client zeigt sie automatisch (`SettingsPanel` in `packages/tabletop`).

Spielstände (M5): `create_app(..., db_path=…)` bzw. `TABLETOP_DB` → SQLite (`persistence.py`, JSON statt pickle).
Laufende/beendete Partien werden alle 2 s und beim Herunterfahren gespeichert und beim Start geladen; Menschen gelten
dann als getrennt (Computer vertritt sie nach 20 s), ihr Browser-Geheimnis bleibt gebunden.

## Neues Tisch-Spiel anlegen (Kurzfassung)

1. `games/<spiel>/server/`: `layout.py` (Felder, Figuren, Würfel), `rules.py` (Unterklasse von `Rules`),
   `main.py` wie bei Mensch (`GameDef` + `create_app`).
2. `games/<spiel>/client/`: Vite-Projekt wie `games/mensch/client` (Brett zeichnen, `PieceLayer`, `DiceLayer`,
   `SeatLabels`, `SettingsPanel`, eigener HUD-Text).
3. Einbinden: `Dockerfile` (Kontext = Repo), Dienst in `docker-compose.yml`, Location in
   `party-hub/nginx-locations.conf` + `fly_nginx.conf`, Fly-Build/-Start, im Hub `partyState.games`, `getGameUrl`
   (Ticket als `#ticket=`), Karte in `index.html`, `KNOWN_GAME_IDS` in `party-server/server.js`.
4. Tests: Regeln direkt auf `Room`, Server per WebSocket, Browser-Test; in `.github/workflows/tests.yml` eintragen.
