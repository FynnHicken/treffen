# Monopoly 3D – Entwickler-Dokumentation

Technische Übersicht für alle, die am Monopoly weiterarbeiten (Mensch oder KI).
Allgemeine Projektregeln stehen in [`/AGENTS.md`](../../AGENTS.md) – zuerst lesen.
Die Roadmap am Ende ist die **Arbeitsliste**: Status pflegen, wenn du etwas erledigst.

---

## 1. Dateien

| Datei | Inhalt |
|---|---|
| `server/main.py` | FastAPI-App: HTTP-API, WebSocket-Endpunkt, Nachrichten-Handler, **Raum-Lock**, Bot-Treiber, Auktions-Timer, Abwesenheit, Aufräumen |
| `server/game_state.py` | Reine Spiellogik: `SQUARES`, Karten, `Player`, `GameRoom` (Regeln, Zahlungen, Auktion, Handel, Bankrott, Debug) |
| `server/bot_ai.py` | Bot-Entscheidungen als reine Funktionen (kaufen, bieten, bauen, ablösen, Schulden, Gefängnis, Handel) |
| `static/index.html` | Markup: Header, Aktions-Dock, Modals (Lobby, Urkunde, Auktion, Handel, Game-Over, Debug …) |
| `static/js/game_client.js` | Gesamte Client-Logik (IIFE, `window.MonopolyGame`): WebSocket, State, HUD, Modals |
| `static/js/board3d.js` | Three.js-Szene (`window.MonopolyBoard3D`): Brett, Figuren, Würfel, Häuser, Karten auf dem Tisch |
| `static/js/asset_config.js` | Zentrale Asset-Registry (Texturen, Modelle, Sounds) |
| `static/js/audio.js` | Soundeffekte + Hintergrundmusik |
| `static/assets/` | Assets – **nicht verändern** (Entscheidung des Nutzers, siehe AGENTS.md) |
| `tests/` | Testskripte + `run_tests.sh` (siehe Abschnitt 3) |

Im Hub wird Monopoly unter `/monopoly/` per iframe eingebettet:
`/monopoly/?room=<HUB-RAUMCODE>&name=<Name>&host=1|0` (siehe `party-hub/app.js`).

## 2. Lokal starten

Auf dem Entwicklungsrechner gibt es kein Python-Setup auf dem Host – alles läuft in Podman:

```bash
cd games/monopoly
# einmalig: Image mit Abhängigkeiten (macht run_tests.sh automatisch)
podman build -t localhost/mono-test-deps -f tests/Containerfile .
# Dev-Server (Code wird read-only gemountet → Client-Änderungen = Browser-Reload,
# Server-Änderungen = Container neu starten; laufende Partien gehen dabei verloren)
podman run -d --name treffen-monopoly-dev -p 8090:8090 -v .:/src:ro,z \
    localhost/mono-test-deps sh -c 'cd /src && exec python -u server/main.py'
podman restart treffen-monopoly-dev     # nach Server-Änderungen
podman logs -f treffen-monopoly-dev
```

**Wichtig: immer `:z` (klein) beim Mounten** – `:Z` vergibt ein privates SELinux-Label und nimmt dem
jeweils anderen Container (Dev-Server ↔ Tests) die Leserechte (`PermissionError: index.html`).

Aufruf: **`http://127.0.0.1:8090/`** (nicht `localhost` – das löst auf diesem Rechner zu IPv6 auf,
wo die rootless-Portweiterleitung nicht antwortet). Im WLAN: `http://<LAN-IP>:8090/`.

Umgebungsvariablen: `PORT` (8090), `HOST` (0.0.0.0), `MONOPOLY_AWAY_GRACE_SEC` (30),
`TREFFEN_TICKET_SECRET` (gemeinsam mit dem Party-Server; leer = Host per `is_host`-Flag wie früher, siehe Abschnitt 7).

### Weitere Asset-Quellen außerhalb des Repos (Stand 2026-11-22)
Unter `~/AGY/Treffen/` liegen alte Projektordner des Nutzers. Nichts davon ist im Repo; vor einer Übernahme
mit dem Nutzer klären (Herkunft/Lizenz):
- `Monopoly/extracted_assets/` – aus „Monopoly Plus“ (Ubisoft/Asobo) extrahiert: 418 SFX + 150 deutsche
  Sprachzeilen + 36 Musikstücke (nur Zahlen-IDs, müssen angehört/benannt werden), Texturen (Geldscheine,
  Figuren, Würfel, UI), `data/strings_de.json`, `data/cards.json`.
- `Skribbol/Monopoly/Assets/` – Quelle der bereits genutzten Assets (z. B. `08_Audio/figur_*.wav`: das sind
  Bewegungs-Schleifen pro Figur à 0,25–3 s, aktuell ungenutzt).
- `Skribbol/Monopoly/monopoly-master/` – Open-Source-Monopoly von Daniel Moyer (MIT-Lizenz), u. a. `ai.js`.
- `partyhub-bundle/` – ältere Fassung dieses Repos (in der Git-Historie enthalten, nichts Neues).

## 3. Tests

```bash
games/monopoly/tests/run_tests.sh          # alles (~5 min)
games/monopoly/tests/run_tests.sh rules    # | driver | settings | sim
```

| Datei | Prüft |
|---|---|
| `test_rules_ws.py` | Host-Rechte, Zug-/Kaufprüfungen, Validierung, Chat-Bereinigung, Bankrott-Geldmenge |
| `test_auth_ws.py` | Spieler-ID an Client-Secret gebunden, keine Bot-ID-Übernahme, Host nur per gültigem Hub-Ticket (läuft mit `TREFFEN_TICKET_SECRET`) |
| `test_driver_ws.py` | Bot-Treiber (nur Bots), Reaktionszeit während Bot-Zügen, Abwesenheit → Computer → Rückkehr, Reconnect-Reihenfolge, Zuschauer, 240 parallele Nachrichten |
| `test_settings.py` | Gameplay-Paket G1–G10 im Prozess gegen den echten Server-Code (Fake-Sockets, Sleeps auf 0): Einstellungs-Rechte, Startgeld, Frei-Parken-Topf, Los-Gehalt, Gefängnis-Würfe, Spieldauer, Zug-Timer, Schwierigkeiten, Bot-Angebote + Cooldown, Handelsablauf, 30 Partien mit gemischten Regeln |
| `test_bot_ai_sim.py` | 11 Unit-Tests der Bot-KI + 40 komplette Bot-Partien über den **echten** Bot-Treiber (Sleeps auf 0) mit Invarianten-Prüfung nach jedem Schritt |

Jede Datei endet mit Exit-Code ≠ 0 bei Fehlern; WS-Tests laufen gegen einen frischen Server pro Datei.
**Neue Features bekommen neue Prüfungen in diesen Dateien.**

## 4. Server-Architektur (`main.py`)

Globale Strukturen (alles im Speicher, kein Persistenz-Layer):
`rooms`, `connections[room][player_id] → WebSocket`, `room_locks`, `bot_tasks`, `auction_tasks`,
`away_tasks`, `room_expiry` (Solo-Lobby 60 s), `room_empty_since` (leere Räume nach 30 min löschen).

**Goldene Regel: Jede Zustandsänderung eines Raums passiert unter `async with get_lock(room_id)`.**
- Spieler-Nachrichten: `websocket_endpoint` → Lock → `handle_message()`.
- Hintergrund-Tasks (Bot-Treiber, Auktion, Abwesenheit, Bot-Handelsantwort) warten (`sleep`)
  **außerhalb** des Locks und ändern den Zustand nur innerhalb.
- `asyncio.Lock` ist nicht reentrant: innerhalb des Locks nie etwas `await`en, das den Lock erneut
  nimmt. Andere Tasks nur **anstoßen** (`kick_bot_driver`, `schedule_auction_flow`), nie awaiten.

**Bot-Treiber** (`kick_bot_driver` → `_bot_driver_loop` → `_bot_step`): ein Task pro Raum, läuft
solange der aktuelle Spieler `room.is_auto_controlled()` ist (Bot **oder** abwesender Mensch).
`_bot_step` macht **genau eine** Aktion und gibt `(Wartezeit, Erfolg)` zurück. Reihenfolge:
Schulden → Karte bestätigen → Einkommensteuer → Kaufen/Versteigern → Gefängnis → Würfeln →
Investieren (Handel mit Bot, Hypothek ablösen, bauen; max. `MAX_BOT_INVESTS_PER_TURN`) → Zug beenden.
Wartezeiten kommen aus `_calc_anim_wait_seconds()` (Animationen im Client). Pausiert, wenn niemand
verbunden ist; 3 Fehlschläge in Folge → Treiber gibt auf (Log-Zeile „Bot-Treiber gibt auf“).

**Auktion**: `_auction_lifecycle_loop` – Bots bieten im 1,1-s-Takt, 5 s ohne neues Gebot → Zuschlag.
Ungültige Gebote/Passes gehen nur als `ERROR` an den Absender und **starten den Timer nicht neu**.

**Abwesenheit**: Socket zu → `schedule_away_timer` → nach `AWAY_GRACE_SEC` `room.away_players.add()`
→ Treiber spielt (vorsichtig: kein Bauen/Handeln mit dem Geld des Menschen). Reconnect entfernt
den Status. Beim Schließen eines Sockets wird die Verbindung nur entfernt, wenn sie noch die
aktuelle ist (Reconnect kann sie schon ersetzt haben).

**Zuschauer**: `JOIN` während `PLAYING`/`GAME_OVER` von jemandem, der nicht Spieler ist →
`SPECTATOR`-Nachricht, kein Spieler. Nach `LOBBY_RESET` sendet der Client erneut `JOIN`.

**Rechte**: `START_GAME` nur Host (fehlt der Host, übernimmt der Startende); `is_host`-Flag vom Hub
nur einmal pro Raum (`room.host_claimed`); `RESET_LOBBY` Host jederzeit, Mitspieler nach Spielende.

## 5. Spiellogik (`game_state.py`)

- `board_state[idx] = {"owner", "houses" (0–4, 5 = Hotel), "mortgaged"}` nur für kaufbare Felder.
- `pending_action`: was der aktuelle Spieler als Nächstes tun muss
  (`BUY_OR_AUCTION`, `CARD_DRAWN`, `TAX_CHOICE`, `AUCTION`, `RENT_PAID`, `TAX_PAID`, `END_TURN`, `WENT_TO_JAIL`).
- **Zahlungsmodell** (wichtig, schon einmal kaputt gewesen):
  - `_record_payment(payer, amount, creditor)` – an die Bank (Geld verschwindet).
  - `_transfer(payer, payee, amount)` – an Mitspieler: Empfänger bekommt **nur vorhandenes Bargeld**,
    Rest landet in `payer.debts[payee_id]`.
  - `_credit_money(player, amount)` ruft `_settle_debts()` – neu eingehendes Geld zahlt offene
    Mitspieler-Schulden automatisch ab. Bei Bankrott verfallen Restschulden.
  - Niemals Mitspieler-Zahlungen als `_record_payment` + `_credit_money` schreiben (erzeugt Geld).
- Kaufen/Versteigern nur im eigenen Zug für `pending_action.square` (Client-`sq_idx` wird nur verglichen).
- Bauen: gleichmäßig, ganze Gruppe, keine Hypothek in der Gruppe, Bank-Limit 32 Häuser / 12 Hotels.
- Kartentexte: `CARD_TEXTS_DE` überschreibt die Asset-JSONs. Wortlaut beibehalten – der Client
  wählt Kartenbilder per Stichwortsuche (`getCardIllustration`).

**Regelabweichungen / Hausregeln (aktueller Stand, bewusst – vom Nutzer so gewünscht):**
- Gefängnis: Würfelversuche pro Runde per Einstellung `jail_rolls` (Standard 3, offiziell 1), nach 3 Runden 50 DM und weiterziehen.
- **Pasch im Gefängnis befreit nur** – die Figur bleibt stehen, der Spieler würfelt danach normal
  (offiziell zieht man mit der Pasch-Summe). Ergebnis `{"jail_freed": true}`, `rolled = False`.
- **Bauen** per Einstellung `build_rule`: Standard `on_group` = nur im eigenen Zug, wenn die Figur auf
  einer Straße dieser Farbgruppe steht (`GameRoom.build_location_error`, gilt für Menschen und Bots);
  `anytime` = offizielle Regel. Verkaufen von Häusern ist immer erlaubt (Schulden).
- Einkommensteuer: Wahl 200 DM oder 10 % des Vermögens (alte Parker-Regel).
- Miete auf unbebauter kompletter Gruppe doppelt, auch wenn Teile belastet sind.
- Unbekaufte Straßen werden versteigert, alle (auch der Ablehnende) dürfen bieten.

## 6. Bot-KI (`bot_ai.py`)

Reine Funktionen, die über normale `GameRoom`-Methoden ausgeführt werden (gleiche Regeln wie Menschen).
`cash_reserve` (abhängig von der höchsten Gegner-Miete) steuert, wie viel Bargeld ein Bot hält.
`should_buy`/`auction_limit` (Gruppen komplettieren oder Gegner blocken zählt mehr), `choose_build`
(gleichmäßig, Orange/Rot zuerst, bis 3 Häuser dann Hotels), `choose_unmortgage`, `resolve_debt`
(erst Einzelstraßen beleihen, dann Häuser der schwächsten Gruppe), `jail_decision`,
`evaluate_trade` (eigene Gruppe nie abgeben; was eine Gruppe komplettiert, zählt doppelt),
`find_bot_trade` (Bot↔Bot-Tausch/Kauf gegen Patt), `find_human_offer` (Angebote an Menschen mit
Cooldown in `room.bot_offer_log`).
**Schwierigkeit** (`room.settings["bot_difficulty"]`): `bot_ai.DIFFICULTY` + `params(room)`.
`easy` = altes naives Verhalten (kauft nur mit 120 DM Puffer, Handel nach Kaufpreis, max. 2 Häuser,
kein Bot-Handel, keine Angebote – kann im Patt enden), `normal` = volle KI, `hard` = höhere Gebote,
80 % Reserve, Angebote alle 6 statt 10 Züge.
Abwesende Menschen nutzen nur die vorsichtigen Regeln (kaufen bei Geld ≥ Preis + 120).

## 7. Protokoll

WebSocket: `ws(s)://<host>/<basepath>/ws/{room_id}/{player_id}`, JSON-Nachrichten.

**Client → Server** (`{"action": …}`): `JOIN {name, token, color, is_host}`, `START_GAME`, `ADD_BOT`,
`ROLL_DICE`, `BUY_PROPERTY {sq_idx}`, `START_AUCTION {sq_idx}`, `AUCTION_BID {amount}`,
`AUCTION_PASS`, `AUCTION_TIMEOUT`, `CONFIRM_CARD`, `PAY_INCOME_TAX {mode: flat|percent}`,
`BUILD_HOUSE {sq_idx}`, `SELL_HOUSE {sq_idx}`, `TOGGLE_MORTGAGE {sq_idx}`, `PAY_BAIL`,
`USE_JAIL_CARD`, `PROPOSE_TRADE {target_id, offer_money, offer_props[], req_money, req_props[],
offer_jail_cards, req_jail_cards}`, `ACCEPT_TRADE`, `REJECT_TRADE`, `END_TURN`, `BANKRUPTCY`,
`RESET_LOBBY`, `SET_SETTINGS {settings: {key: value}}` (nur Host, nur Lobby),
`CHAT {message}`, `UPDATE_ANIM_CONFIG {password, config}`,
`DEBUG_ACTION {password, cmd, target_id, value}`.

**Server → Client** (`{"type": …, "state": room.to_dict(), "result"?: …}`): `STATE_UPDATE`,
`GAME_STARTED`, `DICE_ROLLED`, `PROPERTY_BOUGHT`, `AUCTION_UPDATED`, `CARD_APPLIED`, `TAX_PAID`,
`HOUSE_BUILT`, `HOUSE_SOLD`, `MORTGAGE_TOGGLED`, `BAIL_PAID`, `JAIL_CARD_USED`, `TRADE_PROPOSED`,
`TRADE_ACCEPTED`, `TRADE_REJECTED` (auch bei Ablauf, `result.expired`), `TURN_ENDED`, `BANKRUPTCY`,
`LOBBY_RESET`, `SETTINGS_UPDATED`, `GAME_OVER` (Spieldauer abgelaufen), `CHAT`,
`ANIM_CONFIG_UPDATED`, `DEBUG_ACTION_APPLIED`, `PLAYER_DISCONNECTED`, `SPECTATOR`, `ROOM_EXPIRED`,
`ERROR {message, code?}` (nur an den Absender).

HTTP: `GET /api/config`, `GET /api/rooms`. (`POST /api/create_room` wurde am 2026-11-26 entfernt –
ungenutzt, und man konnte damit vorab einen Raum mit beliebigem Host anlegen.)

**Verbindungsaufbau & Identität** (`server/auth.py`): `WS /ws/{room_id}/{player_id}`; die **erste
Nachricht muss `AUTH {secret}`** sein (16–128 Zeichen `[A-Za-z0-9_-]`, Client: `localStorage
monopoly_client_secret`). Der Server bindet `player_id` pro Raum an `sha256(secret)` (`room_secrets`);
anderes Secret → `ERROR ID_IN_USE` + Close `4003` (Client holt sich still eine neue ID). IDs mit
`bot_`-Präfix werden abgelehnt (sonst könnte man Computerzüge spielen). Host-Recht: ist
`TREFFEN_TICKET_SECRET` gesetzt, nur per `JOIN {ticket}` mit gültigem, vom Party-Server signiertem
Ticket (`base64url(JSON{v,room,pid,name,host,exp}).base64url(HMAC-SHA256)`, 30 min gültig, kommt per
`#ticket=` im iframe-Fragment); sonst wie früher per `is_host`. In beiden Fällen nur einmal pro Raum.

`state` enthält u. a. `status` (LOBBY|PLAYING|GAME_OVER), `host_id`, `players[]` (+ `away`, `debts`),
`current_player`, `dice`, `rolled`, `board_state`, `pending_action`, `pending_trade`,
`auction_state`, `last_card`, `anim_config`, `logs` (letzte 25), `winner` (bei Zeitende mit
`reason: "time"` + `ranking[]`), `squares`, `settings`, `settings_schema`, `free_parking_pot`,
`game_ends_at`, `turn_deadline`, `turn_autoplay_id`, `server_time` (Unix-Sekunden, für Countdowns).

**Raum-Uhr** (`tick_room_timers` im 1-s-Cleanup-Loop, unter dem Lock): Handelsangebote verfallen
nach `TRADE_TIMEOUT_SEC` (60 s); Spieldauer abgelaufen → `finish_by_time()` **sofort** (bzw. direkt
nach einer laufenden Versteigerung); Zug-Timer abgelaufen → `turn_autoplay_id` setzen, Treiber anstoßen.

## 8. Client (`game_client.js`) – Einstiegspunkte

`connectWebSocket` / `sendJoinMessage` / `sendWsMessage` · `handleServerMessage` (setzt
`gameState`, dann `switch(msg.type)`) · `updateLobbyUI` · `updateHUD` (Spielerlisten, Dock,
Buttons) · `handleDiceRollEvent` / `handleCardAppliedEvent` (Animationen) · Modals:
`showDeedModal`, `showAuctionModal`, `showTradeModal`, `showIncomingTradeModal`,
`showTaxChoiceModal`, `showGameOverModal`, `showCardModal` (nur für den Ziehenden – andere sehen die
Karte auf dem Tisch) · `showYourTurnPopup` (generisches
Hinweis-Popup, auch für `ERROR`) · `esc()` (HTML-Escaping – **für alles von anderen Spielern nutzen**).
Es gibt bereits einen clientseitigen „Zug automatisch beenden“-Timer
(`syncEndTurnTimer`, `getActiveTurnTimerMode`) und einen Kauf/Versteigern-Countdown
(`syncBuyOrAuctionTimer`).

---

## Roadmap & Status

Legende: ✅ erledigt · 🚧 in Arbeit · ⬜ offen

### Erledigt
- ✅ Sicherheit S1 (2026-11-26) – Spieler-ID an Client-Secret gebunden, Bot-ID-Übernahme gesperrt,
  Host per signiertem Hub-Ticket, `create_room` entfernt (Details Abschnitt 7)
- ✅ Block 1 – Zug-/Host-Prüfungen, Fehlerbehandlung, XSS, Bankrott-Geldmenge, Auktions-Timer-Blockade
- ✅ Block 2 – Bot-Treiber + Lock, Abwesenheit, Zuschauer (Basis), Reconnect, Aufräumen
- ✅ Block 3 – Bot-KI, Bot↔Bot-Handel, Kartentexte

### ✅ Gameplay-Paket (vom Nutzer am 2026-11-21 beauftragt, umgesetzt am selben Tag)

Alle Einstellungen sind **Raum-Einstellungen**, die der **Host in der Lobby** setzt
(andere sehen sie nur). Speicherort: `GameRoom.settings` (Dict), validiert gegen
`SETTINGS_SCHEMA` in `game_state.py`, an Clients in `state.settings` + `state.settings_schema`.
Neue Client-Aktion: `SET_SETTINGS {settings: {key: value}}` (nur Host, nur `LOBBY`).

| # | Feature | Spezifikation | Status |
|---|---|---|---|
| G1 | Startgeld | `start_money` ∈ {1000, 1500, 2000, 2500}, Standard 1500 | ✅ |
| G2 | Frei-Parken-Topf | `free_parking_pot` bool. Steuern, Strafkarten (`PAY_MONEY`, `PAY_FOR_BUILDINGS`) und Kaution/Gefängnis-Bußgeld gehen in `room.free_parking_pot` (nur tatsächlich bezahlter Anteil!). Wer auf Feld 20 landet, bekommt den Topf. Topf in `state`, Anzeige im Header. | ✅ |
| G3 | Doppeltes Gehalt auf Los | `double_go` bool: genau auf Feld 0 landen (Würfel oder Karte „Rücke vor bis auf Los“) → 400 statt 200 DM | ✅ |
| G4 | Gefängnis-Würfe | `jail_rolls` ∈ {1, 3}, Standard 3 (bisheriges Verhalten); ersetzt die feste 3 in `roll_dice` | ✅ |
| G5 | Spieldauer | `time_limit_min` ∈ {0 (= ∞), 30, 45, 60, 90, 120}. Start setzt `game_ends_at`. Nach Ablauf endet das Spiel **sofort** (bzw. direkt nach einer laufenden Versteigerung – sonst könnte ein Mensch ohne Zug-Timer das Ende hinauszögern); Sieger = höchstes Vermögen (`calculate_player_wealth`), `winner.reason = "time"` + `ranking[]`. Client: Restzeit im Header, Game-Over-Text für Zeitende. `state.server_time` für Uhrabgleich. | ✅ |
| G6 | Zug-Timer | `turn_timer_sec` ∈ {0 (aus), 60, 90, 120, 180}. Gilt nur für Menschen; `turn_started_at` bei jedem Spielerwechsel. Abgelaufen (und keine Auktion läuft) → `room.turn_autoplay_id = id`, `is_auto_controlled` liefert True, Computer beendet den Zug (vorsichtige Regeln wie bei Abwesenheit). Prüfung im 1-s-Cleanup-Loop. Client: Countdown in der Turn-Anzeige; vorhandenen Client-Timer (`syncEndTurnTimer`) berücksichtigen. | ✅ |
| G7 | Bot-Schwierigkeit | `bot_difficulty` ∈ {easy, normal, hard} (Raum). `bot_ai.DIFFICULTY[...]`-Parameter: easy = altes Verhalten (kauft bei Geld ≥ Preis+120, kein Blocken, naive Handelsbewertung, max. 2 Häuser, kein Bot-Handel, keine Angebote); normal = aktuelle KI; hard = höhere Gebote, kleinere Reserve, häufigere Angebote. | ✅ |
| G8 | Bot-Angebote an Menschen | Normal/Schwer: Bot schlägt Menschen einen Kauf/Tausch vor, wenn ihm das eine Farbgruppe komplettiert (Preis × 1,6 bzw. 1,5; Tausch mit Ausgleich). Cooldown pro (Bot, Mensch, Gruppe): 10 bzw. 6 Züge (`room.turn_counter`). Nur wenn kein anderes Angebot offen ist. Handelsangebote verfallen nach 60 s (Cleanup-Loop → `TRADE_REJECTED`). Ein Mensch darf ein eigenes Angebot machen, auch wenn ihm gerade ein Bot-Angebot vorliegt (ersetzt es). | ✅ |
| G9 | Zuschauer-Ansicht | Client: `body.spectator-mode` wenn `PLAYING` und nicht in `players` → Banner „👀 Du schaust zu – in der nächsten Runde spielst du mit“, Aktions-Dock/Konto ausgeblendet, Spielerlisten bleiben sichtbar. | ✅ |
| G10 | Lobby-UI für Einstellungen | Abschnitt in `#lobby-step-room` vor `.lobby-actions`, aus `settings_schema` generiert; Host: Selects/Toggles → `SET_SETTINGS`; Gäste: read-only. Im Spiel: kompakte Regel-Übersicht (z. B. im Log-Panel oder Tooltip). | ✅ |

Tests: `tests/test_settings.py` (siehe Abschnitt 3). Offene Punkte aus diesem Paket:
im Browser noch nicht von Hand durchgespielt (Lobby-Einstellungen, Header-Uhren, Zuschauer-Banner,
Game-Over-Rangliste) – bitte beim ersten echten Spiel prüfen.

### ✅ Playtest-Feedback 1 (2026-11-21)
- ✅ Fremde Züge erzwingen kein Zuschauen mehr: kein Kartendialog für fremde Karten, Miet-Popups nur für
  Zahler/Empfänger, Gefängnis-/Pasch-Hinweise nur für den Betroffenen. (Eine echte Kamerafahrt gab es
  nicht – falls der Nutzer etwas anderes meinte, nachfragen.)
- ✅ Versteigerung zeigt eigenes Bargeld + „Du hast x/y Straßen dieser Farbe“.
- ✅ Handel mit Urkundenbildern (Kacheln), Gefängnisfrei-Karten als Kacheln, Partner-Übersicht
  (Bargeld, Anzahl, Link zur kompletten Besitzliste); eingehendes Angebot ebenfalls mit Bildern.
- ✅ Gezogene Karte verschwindet nach dem Bestätigen/Zugwechsel (`last_card` wird geleert), nie zwei
  Karten gleichzeitig, kein erneutes Einfliegen bei jedem State-Update.
- 🔍 Gefängnisfrei-Karte „nicht in der Sammlung“: Server/Tisch-Ablage/Besitzliste/3D zeigen sie korrekt
  (getestet); vermutlich Folge des Stapel-Bugs. Hinweis-Popup ergänzt. Bei erneutem Auftreten genaue
  Stelle (HUD-Ablage, Besitz-Dialog, 3D-Tisch) erfragen.
- ✅ Pasch im Gefängnis befreit nur, danach neu würfeln.
- ✅ Bauregel `build_rule` (Standard: nur auf der eigenen Farbe stehend), auch für Bots.

### ⬜ Später / Ideen
- Debug-Passwort aus dem Client entfernen (Server-ENV) – Nutzer: „später“.
- Gegenangebote im Handel.
- Persistenz (Spielstand übersteht Server-Neustart).
- Bot-Persönlichkeiten (vorsichtig, aggressiv) zusätzlich zur Schwierigkeit.
