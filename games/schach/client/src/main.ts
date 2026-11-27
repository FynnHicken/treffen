/**
 * Schach – 3D-Spieltisch (läuft eigenständig auf Port 8096 oder im Hub unter /schach/).
 * Alles Spielneutrale (Tisch, Kamera, Figuren greifen, Namen, Lobby, Avatare) kommt aus @treffen/tabletop.
 */
import './app.css';
import * as THREE from 'three';
import {
    ENGINE_VERSION, PieceLayer, Presence, SeatLabels, SettingsPanel, TableClient, TableScene, isTouchDevice, unlockAudioOnGesture,
    type Layout, type PlayState
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

    // Brett passend zur Spielart; neu, wenn der Host in der Lobby eine andere wählt (klassisch/Team/Tandem/Vierschach)
    let board: ChessBoard | null = null;
    let boardLayout: Layout | null = null;
    client.onState(s => {
        if (s.layout?.board && s.layout !== boardLayout) {
            boardLayout = s.layout;
            if (board) {
                table.scene.remove(board.group);
                board.group.traverse(o => {
                    const m = o as THREE.Mesh;
                    m.geometry?.dispose();
                    const mat = m.material as THREE.MeshStandardMaterial | undefined;
                    mat?.map?.dispose();
                    mat?.dispose();
                });
            }
            board = createBoard(s.layout, table.renderer.capabilities.getMaxAnisotropy(), !isTouchDevice());
            table.scene.add(board.group);
            // Vierschach hat Ablagen in den Tischecken → etwas mehr Tisch ins Bild
            table.setFocusRadius(s.layout.board.kind === 'vierer' ? 6.7 : 6.2);
        }
        if (!board) return;
        const p = s.status === 'lobby' ? null : s.play;
        const { last, checks } = marks(p);
        board.setMarks(last, checks);
        table.setTurnSeat(s.status === 'playing' ? (p?.to_move ?? p?.turn ?? null) : null);
        table.invalidate();
    });
    const pieces = new PieceLayer(table, client, {
        surfaceY: BOARD_THICKNESS,
        liftHeight: 0.6,
        createMesh: (_id, spec, layout) => {
            const sp = spec as typeof spec & { facing?: number; inward?: number };
            return createChessPiece(spec.kind, layout.palette?.[spec.color ?? ''] ?? '#999',
                sp.facing ?? (spec.seat === 0 ? 180 : 0), sp.inward ?? 0,
                Math.min(1, (layout.board?.spacing ?? 0.92) / 0.92));
        }
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

/** Letzte Züge und Könige im Schach aus dem Spielstand der jeweiligen Spielart */
function marks(p: PlayState | null): { last: { from: string; to: string }[]; checks: string[] } {
    if (!p) return { last: [], checks: [] };
    const boards = p.boards as Record<string, { last: { from: string; to: string } | null; check: boolean; king: string | null }> | undefined;
    if (boards) {                                                     // Tandem: je Brett
        const bs = Object.values(boards);
        return {
            last: bs.map(b => b.last).filter((x): x is { from: string; to: string } => !!x),
            checks: bs.filter(b => b.check && b.king).map(b => b.king as string)
        };
    }
    const last = p.last as { from: string; to: string } | null | undefined;
    const checks = Array.isArray(p.checks) ? (p.checks as string[]) : p.check && p.king ? [p.king as string] : [];
    return { last: last ? [last] : [], checks };
}

start();
