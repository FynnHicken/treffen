/**
 * Einstieg des Monopoly-Clients. Reihenfolge der Imports ist wichtig: erst THREE als globale
 * Variable, dann der bestehende Code, der sich an `window.Monopoly*` hängt.
 */
import './style.css';
import './three-global';
import './legacy/asset_config.js';
import './legacy/audio.js';
import './legacy/board3d.js';
import './legacy/game_client.js';

function launchMonopoly(): void {
    const w = window as any;
    try {
        w.MonopolyGame?.init();
    } catch (err) {
        console.error('MonopolyGame.init error:', err);
    }
    try {
        w.MonopolyBoard3D?.init('canvas-container');
    } catch (err) {
        console.error('MonopolyBoard3D.init error:', err);
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', launchMonopoly);
} else {
    launchMonopoly();
}
