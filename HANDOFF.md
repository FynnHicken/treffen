# HANDOFF – Stand 2026-11-22 (Claude, Wochenlimit fast erreicht)

Zuerst `AGENTS.md`, dann `games/monopoly/DEVELOPMENT.md` lesen. Dieser Bericht beschreibt nur den
**offenen** Arbeitsstand der letzten Sitzung.

## Letzter Nutzerauftrag (wörtlich sinngemäß)
1. Neuer Spielmodus **„Manuell“**: Karte selbst aufdecken (Ereignis/Gemeinschaft), auf dem Handy per
   **Gyro würfeln**, am PC **mit der Maus**, **Figur selbst bewegen**; „alles durchdenken und weitere
   passende Dinge machen“.
2. **Handymodus überarbeiten** (Auffälligkeiten finden und beheben).

## Bereits erledigt in diesem Commit (Code fertig, aber NICHT final im Browser geprüft)
- **Kamera-Bug (wichtig):** Würfeln/Figurbewegung liefen für ALLE Spieler mit Kamerafahrt
  (`Board3D.rollDice/animateMoveToken(..., true)`), dadurch Zwangszuschauen + stark gezoomtes Brett.
  Jetzt `useCinematicFor(isMyTurn)` (nur eigener Zug) + Schalter 🎥/📷 (`window.toggleCinematic`,
  localStorage `monopoly_cinematic`). Früher habe ich dem Nutzer fälschlich gesagt, es gäbe keine Kamerafahrt.
- **Kamera passt sich dem Seitenverhältnis an:** `Board3D.getFitMultiplier()`, `maxDistance` dynamisch,
  Neu-Einpassen beim Drehen des Handys (`onResize`).
- **Handy-Layout** (CSS am Ende von `static/css/style.css`, Block „Handy-Layout“): zweizeiliger Header,
  Werkzeuge im ⋯-Menü (`#btn-more-tools`, `.game-header.tools-open`), Spielerleiste wischbar,
  Protokoll/Chat als Bottom-Sheet (war < 900 px komplett `display:none`!), Dock als 3er-Raster,
  Tippflächen ≥ 40 px, Querformat-Regeln (`max-height: 500px`).
- **UI-Testwerkzeug:** `games/monopoly/tests/ui/walkthrough.py` (Playwright, Screenshots Handy hoch/quer +
  Desktop, meldet Überläufe/kleine Tippflächen/Konsolenfehler). Image einmal bauen:
  `podman build -t localhost/mono-ui-test -f tests/ui/Containerfile tests/ui`, dann
  `podman run --rm --network=host -v "$PWD":/work:z -w /work localhost/mono-ui-test python tests/ui/walkthrough.py http://127.0.0.1:8090 /work/tests/ui/shots handy,handy-quer,desktop`
  (aus `games/monopoly`, Dev-Server muss laufen). Ergebnis in `tests/ui/shots/` (gitignored).

**Nächster Schritt:** Walkthrough erneut laufen lassen und prüfen, ob das Brett jetzt ganz sichtbar ist
(war der letzte, vom Nutzer abgebrochene Schritt). Dev-Server ggf. `podman restart treffen-monopoly-dev`.

## Noch offen: Modus „Manuell“ – fertiger Entwurf (noch kein Code)
Raum-Einstellung `play_mode` ∈ {`auto`, `manual`} in `SETTINGS_SCHEMA`. Server bleibt Herr über Zufall/Regeln;
Bots, abwesende Spieler und Zug-Timer-Übernahmen spielen immer automatisch.

Server (`game_state.py`/`main.py`):
- Ereignis-/Gemeinschaftsfeld bei menschlichem, nicht auto-gesteuertem Spieler: `pending_action =
  {"type":"DRAW_CARD","deck":…}` statt sofort ziehen. Neue Aktion `DRAW_CARD` → zieht, setzt `last_card`,
  `pending CARD_DRAWN` (wie bisher), Broadcast z. B. `CARD_DRAWN`.
- `roll_dice` im manuellen Modus: Würfel werfen, aber nicht ziehen → `pending MOVE_TOKEN {from, steps, to,
  double}`. Neue Aktion `MOVE_TOKEN` (nur aktueller Spieler) → `move_player(...)`, Broadcast mit
  `manual: true` (Clients animieren nicht erneut, wenn die Figur schon steht). Gilt auch für den
  Gefängnis-Zwangsauszug nach 3 Runden. Kartenbewegungen bleiben automatisch.
- Relay `MOVE_PROGRESS {step}` (ohne Zustandsänderung, validiert 0..steps) → andere sehen jeden Hüpfer live.
- `ROLL_DICE {power}` optional → im Broadcast mitschicken (nur Animation).
- `end_turn` blockieren bei `DRAW_CARD`/`MOVE_TOKEN`; `_check_doubles_reroll` erst nach dem Zug.
- Bot-Treiber `_bot_step`: `DRAW_CARD` → sofort ziehen, `MOVE_TOKEN` → sofort abschließen.
- Tests in `tests/test_settings.py` (+ Simulation mit `play_mode: manual`).

Client:
- **Würfelbecher-Overlay** beim Tippen auf „Würfeln“: Handy → `DeviceMotionEvent` (iOS:
  `DeviceMotionEvent.requestPermission()` im Klick-Handler!), Schütteln erkennen, beim Abklingen werfen;
  Fallback „Becher gedrückt halten, loslassen = werfen“; PC → Becher mit Maus greifen, schütteln,
  loslassen (Mausgeschwindigkeit = `power`). Rassel-Sound (`wuerfeln_*.wav`), `navigator.vibrate`.
- **Karte ziehen:** Stapel pulsiert, Tippen auf Stapel (Raycast in `board3d.js`, pointer-Handler ab
  `renderer.domElement.addEventListener('pointerdown'`) oder Knopf „Karte ziehen“ → `DRAW_CARD`;
  Karte dreht sich um (vorhandener `showCardModal`).
- **Figur ziehen:** Hinweis „Tippe auf deine Figur für jeden Schritt (3/7) – oder zieh sie aufs Zielfeld“;
  jeder Tipp = ein Hüpfer (`Board3D.animateMoveToken(pid, pos, pos+1)`, Klack-Sound, Vibration,
  `MOVE_PROGRESS`); falsches Zielfeld → „Falsch gezählt!“ zurückspringen; letzter Schritt → `MOVE_TOKEN`.
- Weitere Ideen (mit Nutzer abstimmen): „Miete muss eingefordert werden“ (echte Tischregel),
  Geld als Scheine auf den Tisch zählen, Haptik generell.

## Weitere offene Punkte
- Nutzer wollte evtl. deutsche Sprachzeilen per **Whisper** transkribieren lassen (nicht begonnen,
  Download ~0,5–1,5 GB – vorher fragen).
- Asset-Labeler (`tools/asset-labeler/`) funktioniert; umgewandelte Monopoly-Plus-Sounds liegen in
  `~/AGY/Treffen/Monopoly/extracted_assets/audio_playable/` (außerhalb des Repos). vgmstream liegt in
  `/tmp/vgmstream.EYzf` (Nutzer hat Ausführen erlaubt; /tmp ist flüchtig).
- Debug-Passwort `admin123` bleibt (Nutzerentscheidung). Monopoly-Assets nicht verändern.

## Hinweise zur Zusammenarbeit
- Nutzer schreibt Deutsch, Commits Deutsch mit `fix(monopoly):`-Präfix, direkt auf `main` pushen ist erlaubt.
- Laufende Dev-Server nur nach Rückfrage neu starten (Nutzer spielt evtl. gerade, z. B. von 192.168.2.187).
- Container-Mounts immer mit `:z` (klein), sonst verliert der Dev-Server die Leserechte.
- Keine Dateien im WLAN freigeben (`0.0.0.0`) ohne ausdrücklichen Wunsch.
