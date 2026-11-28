/**
 * @treffen/tabletop – spielneutraler 3D-Spieltisch. Konzept: docs/tabletop/KONZEPT.md
 */
import './tabletop.css';

export { ENGINE_VERSION } from './version';
export { TableScene, isTouchDevice } from './engine/TableScene';
export type { TableSceneOptions, Animator } from './engine/TableScene';
export { woodTextures, feltTexture, seededRandom } from './engine/materials';
export { TableClient } from './net/TableClient';
export type { PresenceData } from './net/TableClient';
export { applyEvent } from './net/state';
export type { Member, GameInfo, Mark, TableState, TableEvent, Layout, FieldSpec, PieceSpec, PieceState, PlayState, Roll, ThrowSpec, SettingSpec, SettingValue } from './net/state';
export { Presence } from './presence/Presence';
export { SeatLabels } from './ui/SeatLabels';
export { avatarUrl, avatarImgHtml, avatarCanvas } from './ui/avatar';
export { SettingsPanel } from './ui/SettingsPanel';
export { PieceLayer } from './objects/PieceLayer';
export type { PieceLayerOptions } from './objects/PieceLayer';
export { createPawn, pawnGeometry, lacqueredWood } from './objects/pawn';
export { knock, lift, vibrate, setMuted, unlockAudioOnGesture } from './audio/sfx';
export { DiceLayer } from './dice/DiceLayer';
export type { DiceLayerOptions, Obstacle } from './dice/DiceLayer';
export { createDie, topValue } from './dice/dieMesh';
export { createCup } from './dice/cup';
// Engine 2.3: Spieltisch-App, Standard-Anzeige, Standard-Brett und -Figuren, Feld-Markierungen
export { startTable, boardObstacles } from './app/startTable';
export type { TableApp, TableAppOptions, BoardHandle, BoardContext } from './app/startTable';
export { setupHud, hudContext, movers } from './app/hud';
export type { Hud, HudContext, HudTexts } from './app/hud';
export { createGenericBoard, GENERIC_THICKNESS } from './boards/generic';
export { createPiece, colorOf } from './objects/pieces';
export { MarkLayer } from './objects/MarkLayer';
// Engine 2.4: Karten, Stapel, Hände
export { createCard, CARD_W, CARD_H, CARD_T } from './objects/cards';
export type { CardFace } from './objects/cards';
// Engine 2.6: Schachuhr
export { ClockLayer, formatClock } from './objects/ClockLayer';
// Engine 2.7: Tischgespräch (Reaktionen, Verlauf)
export { setupTalk, screenOf, REACTIONS } from './app/talk';
export type { Talk } from './app/talk';
