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
