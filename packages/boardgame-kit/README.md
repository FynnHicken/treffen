# @treffen/boardgame-kit – Brettspiel-Baukasten

**Ziel (Vision des Nutzers, Stand 2026-11-26):** Weitere Brettspiele sollen so viel Code wie möglich von
Monopoly übernehmen – Verbindung, Identität, 3D-Rendering (Tisch, Kamera, Figuren, Würfel, Karten), Sound,
UI-Bausteine. Was bei Monopoly von Anfang an anders hätte gemacht werden sollen, wird **hier** gleich
richtig gemacht. Monopoly nutzt den Baukasten Schritt für Schritt; so kann später auch eine neue
Monopoly-Version darauf aufbauen. (Kann sich ändern – bei Konzeptfragen den Nutzer fragen.)

## Regeln

- **Kein Monopoly-Wissen hier drin.** Keine Feldnamen, Preise, Regeln, DM. Spielspezifisches bleibt im Spiel;
  der Baukasten bekommt es als Parameter/Callback (z. B. Brettgröße, Feldpositionen, Asset-Pfade).
- TypeScript, `strict`. Wird nicht separat gebaut, sondern vom Vite-Build des Spiels als Quellcode
  eingebunden (Alias `@treffen/boardgame-kit`, siehe `games/monopoly/client/vite.config.ts`).
- Server-Gegenstück liegt (noch) in `games/monopoly/server/auth.py` – beim zweiten Spiel in ein
  gemeinsames Python-Paket ziehen.

## Inhalt

| Modul | Was | Stand |
|---|---|---|
| `identity.ts` | Spieler-ID (pro Tab), Client-Secret (pro Browser), Hub-Ticket aus `#ticket=` | ✅ von Monopoly genutzt |
| `socket.ts` | `GameSocket`: `ws/<raum>/<id>`, `AUTH` zuerst, Wiederverbinden mit Backoff, neue ID bei Close 4003 | ✅ von Monopoly genutzt |
| `html.ts` | `escapeHtml` für alles, was von anderen Spielern kommt | ✅ |

## Fahrplan (Kandidaten aus Monopoly, in dieser Reihenfolge)

1. **Sound** (`legacy/audio.js`): Lautstärke, Stummschalten, Musik, Sound-Sprites – weitgehend spielneutral.
2. **3D-Grundgerüst** aus `legacy/board3d.js`: Renderer/Szene/Licht/Tisch, Kamera-Presets (2D/2.5D/3D),
   Kamerafahrt, Größenanpassung ans Seitenverhältnis, Render-Schleife (Performance: nur bei Bewegung rendern).
3. **Figuren & Würfel**: Modelle laden, Figur entlang eines Pfads hüpfen lassen (Pfad liefert das Spiel),
   Würfelwurf-Animation, Würfelbecher-Eingabe (Maus/Gyro).
4. **UI-Bausteine**: Modals, Toasts/„Du bist dran“, Spielerleiste, Protokoll/Chat-Sheet fürs Handy.
5. **Lobby**: Raum erstellen/beitreten, Bots, Raum-Einstellungen aus einem Schema (wie Monopolys `SETTINGS_SCHEMA`).

Beim Herauslösen jeweils: Monopoly-Verhalten unverändert lassen (Screenshot-Vergleich mit
`games/monopoly/tests/ui/walkthrough.py`), dann im Baukasten aufräumen.

## Notizen „hätte man von Anfang an anders machen sollen“ (für neue Spiele/Monopoly v2)

- Server schickt bei jedem Ereignis den **ganzen** Zustand → besser Ereignisse + Zustandsversion, voller Zustand nur beim Verbinden.
- Server kennt Animationsdauern des Clients (`_calc_anim_wait_seconds`) → Client sollte Ereignisse selbst takten.
- UI wird per `innerHTML`-Strings gebaut → Komponenten mit automatischem Escaping.
- Riesige Einzeldateien mit globalem Zustand (`window.MonopolyGame`) → Module mit klaren Schnittstellen.
- 3D rendert dauerhaft mit weichen Schatten → nur bei Änderungen rendern, Qualität fürs Handy reduzieren.
- Three.js r128 (2021) → neue Spiele mit aktuellem Three.js starten (andere Licht-/Farbwerte!).
