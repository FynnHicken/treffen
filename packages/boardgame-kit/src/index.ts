/**
 * @treffen/boardgame-kit – gemeinsamer Baukasten für die Brettspiele in Treffen.
 * Siehe ../README.md für Ziel und Aufbau.
 */
export { loadIdentity, newPlayerId, randomToken } from './identity';
export type { Identity } from './identity';
export { GameSocket, pageBasePath, CLOSE_ID_IN_USE } from './socket';
export type { GameSocketOptions } from './socket';
export { escapeHtml } from './html';
