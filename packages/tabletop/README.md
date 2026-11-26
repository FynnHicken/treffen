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
| `ui/SeatLabels.ts` | Namensschilder an den Plätzen (Host-Krone, getrennt, „Hinsetzen“; hochkant unter dem Brett) |
| `objects/PieceLayer.ts` | Figuren: greifen (Capture vor der Kamera-Steuerung), ziehen mit Neigung, Einrast-Ring, Hüpfen aufs Feld, Zurückgleiten bei Ablehnung, fremde gehaltene Figuren folgen deren Zeiger |
| `objects/pawn.ts` | Klassische Spielfigur als Drehkörper, lackiertes Holz (`createPawn(color)`) |
| `dice/DiceLayer.ts` | Würfeln: Becher greifen + schütteln (Strecke bzw. Handy-Bewegungssensor = Stärke), Server bestimmt Zahl; Wurf wird mit cannon-es vorab simuliert, Würfel-Aussehen so gedreht, dass die Server-Zahl oben liegt, dann abgespielt (mit Aufprall-Klängen). Alle Clients sehen denselben Wurf |
| `dice/dieMesh.ts`, `dice/cup.ts` | Würfel (abgerundet, Elfenbein, vertiefte Augen, rote Eins) und Lederbecher mit Filz |
| `audio/sfx.ts` | Synthetische Tisch-Geräusche (Holz-Klack, Aufnehmen) + Vibration |

Regeln für den Code hier: kein Spielwissen (keine Mensch-/Monopoly-Begriffe), TypeScript `strict`,
alles Zeichnen über `invalidate()`/Animatoren (nie eine Dauerschleife), Handy zuerst.
