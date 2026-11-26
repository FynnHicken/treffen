# tabletop-server – gemeinsamer Server für die Tisch-Spiele (Python/FastAPI)

`create_app(GameDef(...), client_dist=...)` liefert eine fertige App: WebSocket `/ws/<raum>/<id>`,
`AUTH` + Hub-Tickets (`auth.py`), Räume/Sitzplätze/Host (`rooms.py`), nummerierte Ereignisse, Präsenz-Relay
(gedrosselt, geprüft), paralleles Senden mit Timeout, Aufräumen, Auslieferung des gebauten Clients.
Beispiel: `games/mensch/server3d/main.py`. Protokoll: Kopf von `rooms.py` und `docs/tabletop/KONZEPT.md` §5.

Tests: `python -I packages/tabletop-server/tests/test_tabletop_ws.py` (startet selbst einen Server; ohne
Python auf dem Host: `podman run --rm -v "$PWD":/repo:ro,z localhost/mono-test-deps sh -c 'cd /tmp && python -I /repo/packages/tabletop-server/tests/test_tabletop_ws.py'`).

Kommt in M3–M5 dazu: Regel-Schnittstelle (`Rules`), Zufall mit Startwert, Bots, Persistenz (wie Monopoly), Zuschauer-Sicht.
