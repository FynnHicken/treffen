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
export type { Member, TableState, TableEvent, Layout, FieldSpec, PieceSpec, PieceState } from './net/state';
export { Presence } from './presence/Presence';
export { SeatLabels } from './ui/SeatLabels';
export { PieceLayer } from './objects/PieceLayer';
export type { PieceLayerOptions } from './objects/PieceLayer';
export { createPawn, pawnGeometry, lacqueredWood } from './objects/pawn';
export { knock, lift, vibrate, setMuted, unlockAudioOnGesture } from './audio/sfx';
