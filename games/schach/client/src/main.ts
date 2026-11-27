/**
 * Schach – 3D-Spieltisch (läuft eigenständig auf Port 8096 oder im Hub unter /schach/).
 * Alles Spielneutrale (Tisch, Kamera, Figuren greifen, Namen, Lobby, Avatare) kommt aus @treffen/tabletop.
 */
import './app.css';
import {
    ENGINE_VERSION, PieceLayer, Presence, SeatLabels, SettingsPanel, TableClient, TableScene, isTouchDevice, unlockAudioOnGesture
} from '@treffen/tabletop';
import { BOARD_THICKNESS, createBoard, type ChessBoard } from './board';
import { createChessPiece } from './pieces';
import { setupHud } from './hud';

const params = new URLSearchParams(location.search);
const NAME_KEY = 'schach_name';

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
        try { await navigator.clipboard.writeText(url); toast('Link kopiert – schick ihn deinem Gegenüber'); }
        catch { toast(url); }
    });

    const table = new TableScene({ container: document.getElementById('table')!, seats: 2 });
    const name = await askName();
    const client = new TableClient({ namespace: 'schach', room, name });
    const presence = new Presence(table, client);
    const labels = new SeatLabels(table, client);
    new SettingsPanel(client, document.querySelector('.top-center')!);
    unlockAudioOnGesture();

    let board: ChessBoard | null = null;
    client.onState(s => {
        if (!board && s.layout?.board) {
            board = createBoard(s.layout, table.renderer.capabilities.getMaxAnisotropy(), !isTouchDevice());
            table.scene.add(board.group);
        }
        if (!board) return;
        const p = s.status === 'lobby' ? null : s.play;
        const last = p?.last as { from: string; to: string } | null | undefined;
        board.setLastMove(last?.from ?? null, last?.to ?? null);
        board.setCheck(p?.check ? (p.king as string) : null);
        table.setTurnSeat(s.status === 'playing' ? (p?.turn ?? null) : null);
        table.invalidate();
    });
    const pieces = new PieceLayer(table, client, {
        surfaceY: BOARD_THICKNESS,
        liftHeight: 0.6,
        createMesh: (_id, spec, layout) =>
            createChessPiece(spec.kind, layout.palette?.[spec.color ?? ''] ?? '#999', spec.seat === 0 ? 1 : -1,
                Math.sign(layout.fields[spec.field]?.x ?? 0))
    });
    setupHud(client);

    client.onError(err => {
        if (err.code === 'DROP_REJECTED') toast('So darf die Figur nicht ziehen.');
    });

    const dot = document.getElementById('conn-dot')!;
    client.onConnection(ok => dot.classList.toggle('ok', ok));
    setTimeout(() => document.getElementById('hint')?.classList.add('fade'), 6000);
    client.onState(s => {
        const v = document.getElementById('versions');
        if (v) v.textContent = `Schach ${s.game.version ?? '?'} · Spieltisch ${ENGINE_VERSION}`;
    });

    // Für Tests und Fehlersuche
    (window as any).__tisch = { table, client, presence, pieces, labels, get board() { return board; } };
}

start();
