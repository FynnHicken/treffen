/**
 * Mensch ärgere dich nicht – 3D-Spieltisch (läuft eigenständig auf Port 8095 oder im Hub unter /mensch/).
 */
import './app.css';
import {
    createPawn, DiceLayer, isTouchDevice, PieceLayer, Presence, SeatLabels, SettingsPanel, TableClient, TableScene,
    unlockAudioOnGesture
} from '@treffen/tabletop';
import { BOARD_THICKNESS, createBoard } from './board';
import { setupHud } from './hud';

const params = new URLSearchParams(location.search);
const NAME_KEY = 'mensch_name';

function roomCode(): string {
    const fromUrl = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    if (fromUrl) return fromUrl;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => alphabet[b % alphabet.length]).join('');
    params.set('room', code);
    history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
    return code;
}

function askName(): Promise<string> {
    const fromUrl = params.get('name')?.trim();
    if (fromUrl) return Promise.resolve(fromUrl);
    const stored = localStorage.getItem(NAME_KEY);
    if (stored) return Promise.resolve(stored);
    const welcome = document.getElementById('welcome')!;
    const form = document.getElementById('welcome-form') as HTMLFormElement;
    const input = document.getElementById('name-input') as HTMLInputElement;
    welcome.hidden = false;
    input.focus();
    return new Promise(resolve => {
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            const name = input.value.trim();
            if (!name) return;
            try { localStorage.setItem(NAME_KEY, name); } catch { /* egal */ }
            welcome.hidden = true;
            resolve(name);
        });
    });
}

function toast(text: string): void {
    const el = document.getElementById('toast')!;
    el.textContent = text;
    el.hidden = false;
    clearTimeout((toast as any).t);
    (toast as any).t = setTimeout(() => { el.hidden = true; }, 2200);
}

async function start(): Promise<void> {
    const room = roomCode();
    document.getElementById('room-code')!.textContent = room;
    document.getElementById('room-btn')!.addEventListener('click', async () => {
        const url = `${location.origin}${location.pathname}?room=${room}`;
        try { await navigator.clipboard.writeText(url); toast('Link kopiert – schick ihn deinen Mitspielern'); }
        catch { toast(url); }
    });

    const table = new TableScene({ container: document.getElementById('table')!, seats: 4 });
    const name = await askName();
    const client = new TableClient({ namespace: 'mensch', room, name });
    const presence = new Presence(table, client);
    const labels = new SeatLabels(table, client);
    new SettingsPanel(client, document.querySelector('.top-center')!);
    unlockAudioOnGesture();

    // Brett, sobald das Layout vom Server da ist
    let boardBuilt = false;
    client.onState(s => {
        if (boardBuilt || !s.layout?.board) return;
        boardBuilt = true;
        table.scene.add(createBoard(s.layout, table.renderer.capabilities.getMaxAnisotropy(), !isTouchDevice()));
        table.invalidate();
    });
    const pieces = new PieceLayer(table, client, {
        surfaceY: BOARD_THICKNESS,
        createMesh: (_id, spec, layout) => createPawn(layout.palette?.[spec.color ?? ''] ?? '#999')
    });
    // Würfel: rollen im Streifen zwischen Brett und Tischkante; das Brett ist ein Hindernis
    const BOARD_SIZE = 11 * 0.8 + 0.9;
    const dice = new DiceLayer(table, client, {
        obstacles: [{ x: 0, z: 0, w: BOARD_SIZE, d: BOARD_SIZE, h: BOARD_THICKNESS }]
    });
    const rollBtn = document.getElementById('roll-btn') as HTMLButtonElement;
    rollBtn.addEventListener('click', () => { if (client.canRoll) dice.throwDice(0.6); });
    setupHud(client, toast);

    client.onError(err => {
        if (err.code === 'DROP_REJECTED') toast('Dort kann die Figur nicht hin.');
    });

    const dot = document.getElementById('conn-dot')!;
    client.onConnection(ok => dot.classList.toggle('ok', ok));
    setTimeout(() => document.getElementById('hint')?.classList.add('fade'), 6000);

    // Für Tests und Fehlersuche
    (window as any).__tisch = { table, client, presence, pieces, dice, labels };
}

start();
