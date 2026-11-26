# @treffen/tabletop – der 3D-Spieltisch (Client)

Spielneutrale Engine für alle Tisch-Spiele. Konzept und Fahrplan: [`docs/tabletop/KONZEPT.md`](../../docs/tabletop/KONZEPT.md).
Wird als Quellcode vom Vite-Build eines Spiels eingebunden (Alias `@treffen/tabletop`, siehe
`games/mensch/client/vite.config.ts`; `three` kommt aus dem Spiel-Projekt, `resolve.dedupe`).

| Modul | Was |
|---|---|
| `engine/TableScene.ts` | Renderer, warmes Licht (Hängelampe + Raumlicht), Holztisch, Platzsets, Kamera vom eigenen Platz, **Render-on-Demand** (`invalidate()`, `addAnimator()`), `pickTable()` |
| `engine/materials.ts` | Prozedurale Holz- und Filztexturen (selbst erzeugt, keine fremden Assets) |
| `net/TableClient.ts` | Verbindung (über `@treffen/boardgame-kit`), SNAPSHOT + nummerierte EVENTs, bei Lücke `SYNC`, gedrosselte Präsenz |
| `net/state.ts` | Zustand + `applyEvent` (Gegenstück: `packages/tabletop-server/tabletop_server/rooms.py`) |
| `presence/Presence.ts` | Eigener Zeiger → Server; fremde Zeiger als Ring + Name in Spielerfarbe, weich nachgezogen |
| `ui/SeatLabels.ts` | Namensschilder an den Plätzen (Host-Krone, getrennt, „Hinsetzen“) |

Regeln für den Code hier: kein Spielwissen (keine Mensch-/Monopoly-Begriffe), TypeScript `strict`,
alles Zeichnen über `invalidate()`/Animatoren (nie eine Dauerschleife), Handy zuerst.
