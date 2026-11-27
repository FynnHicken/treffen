/**
 * Spieltisch-App (Engine 2.3): alles, was jedes Tisch-Spiel im Browser braucht, mit einem Aufruf.
 *
 *     startTable({ id: 'dame', title: 'Dame', board: createBoard, piece: createStone });
 *
 * Die Engine baut Oberfläche (Raum-Link, Name, Statuszeile, Start, Siegerehrung, Hinweise, Versionen), Tisch,
 * Namensschilder, Hausregeln, Zeiger, Figuren, Würfel (wenn das Layout welche hat), Feld-Markierungen und das
 * Leuchten am Platz, der am Zug ist. Sie baut das Brett neu, wenn der Host eine andere Spielvariante wählt.
 * Ein Spiel liefert höchstens Brett und Figuren-Modelle – und auch die haben Standards (Holzbrett mit Feldern, Pöppel).
 */
import * as THREE from 'three';
import '../tabletop.css';
import './app.css';
import { escapeHtml } from '@treffen/boardgame-kit';
import { TableScene, isTouchDevice } from '../engine/TableScene';
import { TableClient } from '../net/TableClient';
import type { Layout, PieceSpec, TableState } from '../net/state';
import { Presence } from '../presence/Presence';
import { SeatLabels } from '../ui/SeatLabels';
import { SettingsPanel } from '../ui/SettingsPanel';
import { PieceLayer } from '../objects/PieceLayer';
import { MarkLayer } from '../objects/MarkLayer';
import { DiceLayer, type Obstacle } from '../dice/DiceLayer';
import { unlockAudioOnGesture } from '../audio/sfx';
import { ENGINE_VERSION } from '../version';
import { setupHud, movers, type Hud, type HudContext, type HudTexts } from './hud';
import { createGenericBoard } from '../boards/generic';
import { createPiece } from '../objects/pieces';

export interface BoardContext {
    table: TableScene;
    anisotropy: number;
    /** volle Auflösung (Desktop) */
    hiRes: boolean;
}

/** Was ein Brett der Engine mitteilen kann (alles außer `object` optional) */
export interface BoardHandle {
    object: THREE.Object3D;
    /** Höhe, auf der Figuren stehen (Brettoberkante) */
    surfaceY?: number;
    /** Würfel prallen davon ab (Standard: das Brett als Kasten) */
    obstacles?: Obstacle[];
    /** wie viel Tisch ins Bild muss */
    focusRadius?: number;
    /** wird bei jedem Zustand aufgerufen (eigene Anzeigen am Brett) */
    update?(s: TableState): void;
}

export interface TableAppOptions {
    /** Name des Spiels in URL/Server (Namespace für Identität) */
    id: string;
    title: string;
    /** Brett aus dem Layout (Standard: Holzbrett mit runden bzw. eckigen Feldern, siehe boards/generic.ts) */
    board?: (layout: Layout, ctx: BoardContext) => THREE.Object3D | BoardHandle;
    /** Modell einer Figur (Standard: nach `kind` – pawn, disc, stone, cube, …, siehe objects/pieces.ts) */
    piece?: (id: string, spec: PieceSpec, layout: Layout) => THREE.Object3D;
    /** Figuren-Oberfläche, wenn das Brett sie nicht meldet */
    surfaceY?: number;
    liftHeight?: number;
    /** Kurzer Bedienhinweis unten (verschwindet nach ein paar Sekunden) */
    hint?: string;
    /** Text beim Teilen des Raum-Links */
    shareText?: string;
    texts?: HudTexts;
    /** Statuszeile selbst bauen (HTML; null = Standard) – nur wenn `say` der Regeln nicht reicht */
    status?: (s: TableState, ctx: HudContext) => string | null;
    /** Weitere Einrichtung des Spiels (eigene Knöpfe, Ereignisse …) */
    setup?: (app: TableApp) => void;
}

export interface TableApp {
    table: TableScene;
    client: TableClient;
    presence: Presence;
    labels: SeatLabels;
    pieces: PieceLayer;
    marks: MarkLayer;
    dice: DiceLayer | null;
    hud: Hud;
    readonly board: BoardHandle | null;
}

function shell(o: TableAppOptions): void {
    const t = escapeHtml(o.title);
    const hint = escapeHtml(o.hint ?? 'Figur greifen und aufs Feld setzen – oder antippen, dann Ziel antippen · Ziehen: drehen · Doppeltipp: zurück');
    const start = escapeHtml(o.texts?.start ?? 'Spiel');
    document.title = o.title;
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="table"></div>
    <header class="hud">
        <button class="hud-room" id="room-btn" title="Link zum Raum kopieren">
            <span class="hud-dot" id="conn-dot"></span> Raum <strong id="room-code">——</strong> <span class="hud-copy">🔗</span>
        </button>
        <div class="hud-title">${t}</div>
    </header>
    <div class="top-center">
        <div class="status" id="status" hidden></div>
        <button class="start-btn" id="start-btn" hidden>▶ ${start} starten</button>
    </div>
    <div class="gameover" id="gameover" hidden></div>
    <button class="roll-btn" id="roll-btn" hidden title="Würfeln (oder den Becher greifen und schütteln)">🎲 Würfeln</button>
    <p class="versions" id="versions"></p>
    <p class="hint" id="hint">${hint}</p>
    <div class="welcome" id="welcome" hidden>
        <form class="welcome-card" id="welcome-form">
            <h1>${t}</h1>
            <p>Wie heißt du?</p>
            <input id="name-input" maxlength="24" autocomplete="nickname" placeholder="Dein Name" required>
            <button type="submit">An den Tisch setzen</button>
        </form>
    </div>
    <div class="toast" id="toast" hidden></div>`;
    for (const el of [...div.children]) document.body.appendChild(el);
}

function roomCode(params: URLSearchParams): string {
    const fromUrl = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    if (fromUrl) return fromUrl;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => alphabet[b % alphabet.length]).join('');
    params.set('room', code);
    history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
    return code;
}

function askName(params: URLSearchParams, key: string): Promise<string> {
    const fromUrl = params.get('name')?.trim();
    if (fromUrl) return Promise.resolve(fromUrl);
    let stored: string | null = null;
    try { stored = localStorage.getItem(key); } catch { /* privat */ }
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
            try { localStorage.setItem(key, name); } catch { /* egal */ }
            welcome.hidden = true;
            resolve(name);
        });
    });
}

function dispose(obj: THREE.Object3D): void {
    obj.traverse(o => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats as THREE.MeshStandardMaterial[]) { mat.map?.dispose(); mat.dispose(); }
    });
}

/** Standard-Hindernis für die Würfel: das Brett als Kasten bzw. Zylinder */
export function boardObstacles(layout: Layout, height: number): Obstacle[] {
    const size = layout.board?.size ?? 9;
    const w = (layout.board?.w as number | undefined) ?? size, d = (layout.board?.d as number | undefined) ?? size;
    return layout.board?.shape === 'round'
        ? [{ x: 0, z: 0, w: size, d: size, r: size / 2, h: height }]
        : [{ x: 0, z: 0, w, d, h: height }];
}

export async function startTable(o: TableAppOptions): Promise<TableApp> {
    shell(o);
    const params = new URLSearchParams(location.search);
    const room = roomCode(params);
    let app: TableApp | null = null;
    const hudToast = (t: string) => app?.hud.toast(t);
    document.getElementById('room-code')!.textContent = room;
    document.getElementById('room-btn')!.addEventListener('click', async () => {
        const url = `${location.origin}${location.pathname}?room=${room}`;
        try { await navigator.clipboard.writeText(url); hudToast(o.shareText ?? 'Link kopiert – schick ihn deinen Mitspielern'); }
        catch { hudToast(url); }
    });

    const table = new TableScene({ container: document.getElementById('table')!, seats: 2 });
    const name = await askName(params, `${o.id}_name`);
    const client = new TableClient({ namespace: o.id, room, name });
    const presence = new Presence(table, client);
    const labels = new SeatLabels(table, client);
    new SettingsPanel(client, document.querySelector('.top-center')!);
    unlockAudioOnGesture();

    const hiRes = !isTouchDevice();
    const bctx: BoardContext = { table, anisotropy: table.renderer.capabilities.getMaxAnisotropy(), hiRes };
    let board: BoardHandle | null = null;
    let boardLayout: Layout | null = null;
    let surfaceY = o.surfaceY ?? 0.12;
    let dice: DiceLayer | null = null;
    const marks = new MarkLayer(table, () => surfaceY);
    const defaultFocus = 6.2;

    const buildBoard = (layout: Layout) => {
        if (board) { table.scene.remove(board.object); dispose(board.object); }
        const made = (o.board ?? createGenericBoard)(layout, bctx);
        board = made instanceof THREE.Object3D ? { object: made } : made;
        if (board.surfaceY != null) surfaceY = board.surfaceY;
        else if (!o.board) surfaceY = 0.12;
        table.scene.add(board.object);
        table.setFocusRadius(board.focusRadius ?? defaultFocus);
        if (layout.dice) {
            const obstacles = board.obstacles ?? boardObstacles(layout, surfaceY);
            if (!dice) dice = new DiceLayer(table, client, { obstacles });
            else dice.setObstacles(obstacles);
        }
        table.invalidate();
    };
    // Brett zuerst (Figuren stehen auf seiner Oberfläche) – vor dem PieceLayer anmelden
    client.onState(s => {
        if (s.layout?.board && s.layout !== boardLayout) {
            boardLayout = s.layout;
            buildBoard(s.layout);
        }
    });

    const pieces = new PieceLayer(table, client, {
        surfaceY: () => surfaceY,
        liftHeight: o.liftHeight,
        createMesh: o.piece ?? ((id, spec, layout) => createPiece(spec, layout)),
    });

    const hud = setupHud(client, o.texts ?? {}, o.status);
    client.onState(s => {
        const p = s.status === 'playing' || s.status === 'finished' ? s.play : null;
        marks.set(s.layout, p?.marks);
        table.setTurnSeat(s.status === 'playing' ? movers(s.play) : null);
        board?.update?.(s);
        const v = document.getElementById('versions');
        if (v) v.textContent = `${o.title} ${s.game.version ?? '?'} · Spieltisch ${ENGINE_VERSION}`;
    });
    document.getElementById('roll-btn')!.addEventListener('click', () => { if (client.canRoll) dice?.throwDice(0.6); });

    const dot = document.getElementById('conn-dot')!;
    client.onConnection(ok => dot.classList.toggle('ok', ok));
    setTimeout(() => document.getElementById('hint')?.classList.add('fade'), 6000);

    app = {
        table, client, presence, labels, pieces, marks, hud,
        get dice() { return dice; },
        get board() { return board; },
    };
    o.setup?.(app);
    const ready = app;
    // Für Tests und Fehlersuche
    (window as any).__tisch = app;
    return ready;
}
