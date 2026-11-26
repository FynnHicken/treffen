/**
 * @treffen/tabletop – spielneutraler 3D-Spieltisch. Konzept: docs/tabletop/KONZEPT.md
 */
import './tabletop.css';

export { TableScene, isTouchDevice } from './engine/TableScene';
export type { TableSceneOptions, Animator } from './engine/TableScene';
export { woodTextures, feltTexture, seededRandom } from './engine/materials';
export { TableClient } from './net/TableClient';
export type { PresenceData } from './net/TableClient';
export { applyEvent } from './net/state';
export type { Member, TableState, TableEvent, Layout, FieldSpec, PieceSpec, PieceState, Roll, ThrowSpec, SettingSpec, SettingValue } from './net/state';
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
