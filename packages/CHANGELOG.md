# Spieltisch-Engine – Änderungen

Gilt für beide Hälften der Engine, die immer dieselbe Nummer tragen:
`packages/tabletop` (Client, `src/version.ts`) und `packages/tabletop-server` (Server, `tabletop_server/version.py`).
Ein Test (`packages/tabletop-server/tests/test_conformance.py`) prüft, dass beide gleich sind und hier ein Abschnitt steht.

**Versionsschema (SemVer)**

| Teil | Wann erhöhen | Was heißt das für Spiele? |
|---|---|---|
| MAJOR (`3.0.0`) | Regel-Schnittstelle oder Protokoll inkompatibel geändert | Spiele müssen angepasst werden – oder laufen über eine Übersetzungsschicht weiter (wie API 1 in 2.0) |
| MINOR (`2.1.0`) | Neue Möglichkeiten (z. B. Karten, Marker) | Bestehende Spiele laufen unverändert |
| PATCH (`2.0.1`) | Fehlerbehebung | Bestehende Spiele laufen unverändert |

**Welches Spiel läuft mit welcher Version?** Jedes Spiel meldet sie selbst:
`GET /<spiel>/api/health` → `{"version": "<Spiel>", "engine": "<Engine>", "rules_api": <1|2>}`,
im Spiel unten rechts („Schach 1.0.0 · Spieltisch 2.0.0“) und in der Browser-Konsole.
Weil jedes Spiel die Engine beim Bauen als Quellcode einbindet, hat ein frisch gebautes Spiel immer die aktuelle
Engine – es gibt keine „alten Stände“ einzelner Spiele, solange die CI grün ist.

**Ablauf bei einer Änderung an der Engine**
1. Nummer in `version.py` **und** `version.ts` erhöhen, hier einen Abschnitt schreiben.
2. CI prüft automatisch jedes Tisch-Spiel (Pflicht-Prüfung: Computer-Partien, Speichern/Laden, Ansichten)
   plus die Regel- und Browser-Tests der Spiele. Rot = nicht ausrollen.

---

## 2.7.0 – 2026-11-27

Tischgespräch – was am echten Tisch nebenbei passiert. In jedem Spiel mit `startTable`, ohne Spielcode.

- **Reaktionen**: 😊 unten links → Emoji-Leiste (👍 👏 😂 😮 😅 🤔 🔥 ❤️ 😬 🎉); das Emoji steigt bei allen über dem
  eigenen Platz auf. Nachricht `REACT` → `REACTION` (flüchtig wie Zeiger, nicht gespeichert, feste Auswahl, höchstens
  alle 1,2 s). Client: `client.react()`, `client.onReaction()`.
- **Verlauf**: 📜 zeigt die letzten 60 Einträge – Hinweise (NOTE, mit eigenem Text für den Betroffenen), Würfe, Züge
  auf Brettfeldern („e2 → e4“), Start/Ende. Regeln können jedem Ereignis einen Verlaufstext geben (`"log": "…"`).
- Zurücknehmen und Mau-Mau-Farbwunsch melden sich mit „Du …“ beim Betroffenen.

## 2.6.0 – 2026-11-27

Am Tisch: **Schachuhr** und **Zug zurücknehmen** – beides Hausregeln, Standard aus. Schach 1.4.0 (klassisch) und
Dame 1.1.0 bieten die Uhr an.

- **Bedenkzeit** (`clock`: ohne, 1, 3, 5, 10, 15, 30 Minuten je Spieler) für Regeln mit `uses_clock = True`. Die Zeit läuft
  für alle in `to_move` (auch mehrere), ein Zug „drückt die Uhr“. Abgelaufen → verloren (oder `on_timeout(room, seat)`
  der Regeln entscheidet); Server prüft viermal je Sekunde. `play.clock = {left, running}`; übersteht Speichern/Laden
  (Zeit, in der der Server weg war, zählt nicht).
- Client: **3D-Schachuhr** neben dem Brett (zwei Plätze; Ziffernblatt je Spieler zu ihm gedreht, Drücker), eigene Zeit in
  der Statuszeile (unter 20 s rot). Zeichnet nur, wenn sich eine Ziffer ändert. Lage: `layout.board.clock = {x, z}`.
- **Zurücknehmen** (`undo`, nur Spiele ohne Geheimwissen, `GameDef(undo=False)` schaltet ab): Knopf „↩️ Zurücknehmen“;
  alle anderen Menschen am Tisch werden gefragt (Ja/Nein), Computer stimmen immer zu. Zurück geht es bis vor den letzten
  eigenen Zug (spätere Züge anderer gehen mit). Würfe werden nie zurückgenommen. Ereignisse `UNDO_ASKED`,
  `UNDO_CLEARED`, `STATE_RESTORED`; Nachrichten `UNDO`, `UNDO_ANSWER`.
- Auswahl-Hausregeln mit Zahlen prüfen jetzt `choices`.
- Computer-Tempo für Tests: `TABLETOP_BOT_SPEED`. Neuer Test `tests/test_table.py`.

## 2.5.0 – 2026-11-27

**Freies Spiel** – wie am echten Tisch, ohne Regelprüfung. Für jedes Tisch-Spiel automatisch dabei.

- Hausregel „Freies Spiel (ohne Regeln)“ (Schlüssel `free`, Standard **aus**), kommt von der Engine. Abschaltbar je Spiel:
  `GameDef(free_play=False)`. Aufgebaut wird wie gewohnt (`setup` der Regeln), danach gilt:
  alle am Tisch dürfen jede Figur/Karte greifen und auf jedes freie Feld bzw. jede Zone legen, jederzeit würfeln,
  Karten doppelt antippen = umdrehen, Knopf „🔀 … mischen“ je Stapel; Computer spielen nicht mit; der Host beendet die
  Runde mit „🏁 Zurück in die Lobby“. Geheimes bleibt geheim (fremde Hand verdeckt, bis man sich eine Karte nimmt).
- Spielstand im freien Spiel: `{"free": true, "say": …, "acts": …}` statt der Ansicht der Regeln.
- Zonen-Feldern kann man `label` geben (Text des Misch-Knopfs).
- Antippen-Ziel: Liegt auf einer Ziel-Zone schon eine Karte, legt Antippen darauf ab, statt sie zu greifen.
- Neuer Test `tests/test_free.py`.

## 2.4.0 – 2026-11-27

Karten, Stapel, Hände – und Knöpfe für Aktionen ohne Figur. Erstes Kartenspiel: **Mau-Mau** (1.0.0, Vorlage, nicht im Hub),
wieder ohne eigenen Client-Code.

**Neu – Server**
- **Zonen**: Felder mit `zone` = `stack` | `hand` (mit `owner`) | `row` tragen mehrere Gegenstände in einer Reihenfolge
  (`order`); `up` = offen/verdeckt. `room.move_piece(id, feld, up=…)` und `room.flip_piece(id, up)` für Regeln.
- **Geheime Vorderseiten**: Karten (`kind: "card"`) haben eine Vorderseite (`face`), die nur der Server kennt. Spieler
  bekommen sie als `show` nur, wenn sie sie sehen dürfen (offen, eigene Hand; Regeln können `can_see` setzen) – im
  Zustand je Platz und in Ereignissen (`secret` je Platz, `personalize` setzt es ein). Mischen tauscht die Vorderseiten
  zwischen den Karten (gemerkte Karten-IDs helfen nichts). Ereignisse `PIECE_FLIPPED`, `STACK_SHUFFLED`.
- `tabletop_server.cards`: `french_deck`, `card_pieces`, `zone`, `deal_new`, `shuffle`, `pieces_on`, `top`, `card_name`.
- **Aktionen ohne Figur**: jeder Aktionstyp (`pass`, `choose` …); mit `label` und `action_buttons = True` als Knopf
  am Tisch (`acts` im Spielstand). Neue Nachricht `ACT` (nur einfache Werte, Regeln prüfen).
- Pflicht-Prüfung: keine Vorderseite verlässt den Server, `show` nur für die, die sehen dürfen.
- Spielstände speichern `order`, `up`, `face`.

**Neu – Client**
- `createCard` (Vorderseite aus `layout.cards`, Rückseite aus `layout.card_back`); Standard für `kind: "card"`.
- `PieceLayer`: Stapel übereinander, Hand aufgefächert am Platz (die eigene größer, gekippt, sortiert; spielbare Karten
  rücken vor), Auslage in einer Reihe; Karten drehen sich um, wenn sie sichtbar werden. `restPose()`.
- Knöpfe der Regeln unter der Statuszeile (`client.act()`, `client.myActs`); Hinweise erscheinen darunter statt darüber.
- Standard-Brett: `surface: "felt"` (Spielmatte), Stapel als Kartenumriss.
- Punktezeile zeigt nur besetzte Plätze, mit Namen.

**Behoben**: Erlaubte Züge galten nur in einer Phase namens `move` – jetzt in jeder Phase, wenn die Regeln Züge liefern.

## 2.3.0 – 2026-11-27

Spieltisch-App und Bausteine: Ein neues Tisch-Spiel besteht aus Regeln + Brett-Daten, der Client aus einem Aufruf.
Mensch (1.2.0) und Schach (1.3.0) sind umgestellt (je ~400 Zeilen weniger), **Dame** (1.0.0) ist das erste Spiel
ganz ohne eigenen Client-Code und dient als Vorlage.

**Neu – Client**
- **`startTable({id, title, board?, piece?, texts?, hint?, status?, setup?})`**: baut Oberfläche (Raum-Link, Name,
  Statuszeile, Start, Siegerehrung, Würfel-Knopf, Hinweise, Versionen), Tisch, Namensschilder, Hausregeln, Zeiger,
  Figuren, Würfel (wenn das Layout welche hat), Markierungen und das Leuchten am Platz, der am Zug ist. Brett und
  Würfel-Hindernisse werden beim Variantenwechsel neu gebaut. HTML/CSS liegt in der Engine (`app/app.css`).
- **Standard-Anzeige** (`setupHud`) aus dem Spielstand: `say` (Statuszeile), `alerts` („Schach!“, Handy vibriert),
  `scores`, `finished`/`result` (Siegerehrung), Ereignis `NOTE` (kurzer Hinweis an alle, eigener Text für den
  Betroffenen). Platzhalter `{who}`, `{p2}`, `{s2}`; Texte werden escaped.
- **`MarkLayer`**: `marks: [{field, kind: last|alert|hint}]` der Regeln → Felder leuchten (eckig bei `cells: "square"`).
- **Standard-Brett** (`createGenericBoard`): Holzplatte mit gemalten Feldern (rund/eckig, Farben), Linien, rund oder eckig.
- **Standard-Figuren** (`createPiece`): `pawn`, `disc`, `king` (Doppelstein), `stone`, `flip`, `cube`, `cone`, `ring`.
- `PieceLayer({surfaceY})` nimmt auch eine Funktion (Brett mit anderer Höhe nach Variantenwechsel).

**Neu – Server**
- `tabletop_server.boards`: `grid` (Schachbrett-Muster, Löcher), `hexgrid`, `ring_track`, `tray` (Ablagen),
  `seat_point`, `lines_between`, `layout` (Größe aus den Feldern).
- `Variant(seat_names=…, min_players=…, lobby=…)` (auch an `GameDef` für Spiele ohne Varianten) →
  `state.game.seat_names/min_players/lobby`. Start prüft `min_players` der Variante.
- Pflicht-Prüfung prüft die Standard-Anzeige (Platzhalter, Plätze, Felder der Markierungen, NOTE).

**Kompatibel**: Spiele, die `startTable` nicht nutzen, laufen wie bisher (alle Bausteine bleiben einzeln exportiert).

## 2.2.0 – 2026-11-27

Für Schach zu viert (Schach 1.2.0: Teamschach, Tandem, Vierschach).

**Neu**
- `TableScene.setTurnSeat()` nimmt auch mehrere Plätze (Tandem: auf beiden Brettern ist jemand am Zug).
- `Room.auto_member()` / `note_auto()`: Wer vom Computer gespielt wird, sitzt jetzt am Raum (testbar). Dürfen mehrere
  Plätze gleichzeitig handeln, kommen die Computer **reihum** dran – je Stelle in `to_move` (bei Tandem: je Brett).

**Behoben**
- Zwei Computer gleichzeitig am Zug: Bisher spielte immer nur der erste, das zweite Brett stand still.
- `SET_SETTINGS` mit Spielvariante **und** deren Hausregeln in einer Nachricht: Die Variante gilt jetzt zuerst, ihre
  Hausregeln danach (vorher wurden sie verworfen, weil die alte Variante sie nicht kannte).

## 2.1.0 – 2026-11-27

Spielvarianten: Ein Spiel kann mehrere Bretter/Spielarten mitbringen, jede mit eigener Platzzahl und eigenen Regeln.
Erstes Spiel damit: Mensch ärgere dich nicht für 4, 6 und 8 (Mensch 1.1.0).

**Neu**
- **`Variant`** (`tabletop_server.rooms`, exportiert): `Variant(id, titel, seat_colors, layout, rules, seat_angles?,
  players?, hint?)`; `GameDef(…, variants=[…], auto_variant=True|False, variant_label="…")`. Die erste Variante ist der
  Standard. Bestehende Spiele (ein Brett) ändern nichts – sie haben intern eine Variante `standard`.
- **Hausregel „Spielvariante“** kommt von der Engine (Schlüssel `variant`, erscheint nur bei mehreren Varianten). Mit
  `auto_variant` gibt es „automatisch (nach Spielerzahl)“: Kommt jemand in die volle Lobby, wechselt der Tisch auf das
  nächstgrößere Brett und gibt ihm einen Platz; steht jemand auf, geht es zurück. Kein Dialog, keine Rückfrage.
- **Ereignis `BOARD_CHANGED`** (nur in der Lobby): neues `game` (Plätze, Farben, Lage), `layout`, `pieces`, `members`,
  `settings`, `settings_schema`. Passen die Plätze nicht mehr, rücken alle der Reihe nach zusammen; wer keinen Platz hat,
  schaut zu (Menschen vor Computern).
- **Lage der Plätze** (`seat_angles` in Grad, 0 = unten, im Uhrzeigersinn): Partner können nebeneinander sitzen.
  Client: `TableScene.setSeats(n, winkel)`, `seatAngle()`, `onSeatsChanged()`, `setFocusRadius()`; Platzsets und
  Namensschilder bauen sich bei einem Wechsel selbst neu (SeatLabels übernimmt die Werte aus dem Zustand).
- **`to_move` im Spielstand**: Der Raum ergänzt die Liste der Plätze, die handeln dürfen. `TableClient.myTurn` nutzt
  sie – mehrere Plätze gleichzeitig am Zug sind möglich.
- **Figuren nach Regeln (API 2)**: Ob ein Platz eine Figur greifen darf, entscheiden allein `can_touch`/`actions` der
  Regeln, nicht mehr das feste `seat` im Layout (Team-Figuren, Figuren, die den Besitzer wechseln). API 1 wie bisher.
- Optional an Regeln: `can_start(room)` (genügt die Besetzung), `conformance_max_steps` (lange Spiele in der Prüfung).
- `SettingSpec.labels`: Anzeigetexte für Auswahlwerte. `DiceLayer.setObstacles()`, runde Hindernisse (`r`).
- Spielstände speichern die Variante; `/api/health` listet `variants`, `/api/rooms` die Variante je Raum.
- Pflicht-Prüfung spielt **jede Variante** einzeln (mit deren `conformance_settings`); bei mehreren Plätzen am Zug
  wechselt sie zufällig zwischen ihnen. Neuer Test `tests/test_variants.py`.

**Kompatibel**: Mensch-Regeln bleiben API 1. Das klassische 4er-Brett ist Feld für Feld gleich (Test vergleicht),
alte Spielstände laden weiter. Clients ohne `BOARD_CHANGED`-Kenntnis würden es ignorieren – neu laden hilft.

## 2.0.1 – 2026-11-27

- Pflicht-Prüfung (`tests/test_conformance.py`) setzt `TABLETOP_CONFORMANCE=1` für jedes Spiel. Spiele dürfen dann einen
  schnellen Computer nehmen (Schach: eingebauter statt Stockfish), damit die Prüfung kurz bleibt. Keine Änderung für Spiele,
  die das nicht beachten.

## 2.0.0 – 2026-11-27

Erste Version mit Nummer. Neue Regel-Schnittstelle für Spiele jenseits von „würfeln und ziehen“; Schach als erstes Spiel darauf.

**Neu**
- **Regel-API 2** (`tabletop_server.rules.GameRules`): alles, was ein Spieler tun kann, ist eine *Aktion*
  (`{"type": "roll"}`, `{"type": "move", "piece", "to"}`). Pflicht: `setup`, `actions`, `apply`; optional `view`,
  `to_move`, `bot_action`, `can_touch`. Doku im Kopf von `rules.py` und in `docs/tabletop/KONZEPT.md` §12.
- **Ansicht je Platz** (`view(room, seat)`, `shared_view = False`): Server schickt jedem Mitglied nur seinen Spielstand
  (`GAME_UPDATED` mit `views` → `personalize`). Grundlage für Kartenspiele mit Handkarten.
- **Figuren wechseln die Art**: `room.pieces[id]["kind"]` + Ereignis `PIECE_CHANGED` (Bauer → Dame); Client tauscht
  das Modell an Ort und Stelle, Spielstände speichern die Art mit.
- **Antippen, dann Ziel antippen** (`PieceLayer`): Hat eine Figur mehrere Ziele, bleibt sie nach dem Antippen
  angehoben, die Ziele leuchten. Ein Ziel → zieht sofort (wie bisher). Kein Dauer-Rendern beim Warten.
- **Computer denkt außerhalb des Raum-Locks** (`Room.bot_plan` in einem Thread, danach `bot_apply`, wenn sich nichts
  geändert hat) – ein rechnender Schach-Computer bremst niemanden.
- **Versionen**: `ENGINE_VERSION`, `GameDef(version=…)`, `/api/health` und `state.game` mit `version`, `engine`, `rules_api`;
  `TableClient.versions`.
- **Pflicht-Prüfung** (`tabletop_server.conformance.check_game`, Runner `tests/test_conformance.py`) für jedes Spiel unter
  `games/*/server/main.py`.

**Kompatibel**
- Regel-API 1 (`Rules`: `can_roll/on_roll/moves/move/…`) läuft über `LegacyRules` unverändert weiter – Protokoll und
  Verhalten wie 1.x. Mensch ärgere dich nicht wurde **nicht** angefasst und besteht alle bisherigen Tests.
- Clients ignorieren unbekannte Ereignisse (älterer Client + neuer Server bleibt spielbar).

## 1.x – bis 2026-11-26 (ohne Nummer)

M1–M5 aus `docs/tabletop/KONZEPT.md`: Tisch, Präsenz, Figuren, Würfel, Regeln (API 1), Lobby, Hausregeln, Spielstände,
Hub-Tickets, Avatare. Einziges Spiel: Mensch ärgere dich nicht.
