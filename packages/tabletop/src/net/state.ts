/**
 * Zustand des Tisches im Client + Anwenden der Server-Ereignisse.
 * Gegenstück: packages/tabletop-server/tabletop_server/rooms.py (und die Test-Kopie in test_tabletop_ws.py).
 */
export interface Member {
    id: string;
    name: string;
    seat: number | null;
    color: string;
    connected: boolean;
    is_bot: boolean;
    /** Avatar-Bild aus dem Hub (nur mit Hub-Ticket), sonst null */
    avatar?: string | null;
}

/** Ablageplatz auf dem Brett (Tisch-Koordinaten, Mitte = 0,0; Platz 0 sitzt bei +z) */
export interface FieldSpec {
    x: number;
    z: number;
    kind: string;
    color?: string;
    index?: number;
}

export interface PieceSpec {
    kind: string;
    seat: number;
    color?: string;
    field: string;   // Startfeld
}

export interface ThrowSpec {
    power: number;
    seed: number;
    seat: number;
}

export interface Roll {
    by: string;
    values: number[];
    throw: ThrowSpec;
}

export interface Layout {
    board?: { kind: string; size: number; spacing?: number; [key: string]: unknown };
    dice?: { count: number; sides: number };
    palette?: Record<string, string>;
    fields: Record<string, FieldSpec>;
    pieces: Record<string, PieceSpec>;
}

export interface PieceState {
    field: string;
    held_by: string | null;
    /** Art, falls sie sich im Spiel geändert hat (z. B. Bauer → Dame); sonst gilt PieceSpec.kind */
    kind?: string | null;
}

export type SettingValue = boolean | number | string;
export interface SettingSpec {
    default: SettingValue;
    label: string;
    /** Zusatzerklärung (optional) */
    hint?: string;
    min?: number;
    max?: number;
    choices?: SettingValue[];
    /** Anzeigetexte für choices (z. B. Spielvariante: {"6": "Großes Brett für 5–6"}) */
    labels?: Record<string, string>;
}

/** Spielstand der Regeln (spielspezifisch; diese Felder nutzt der Tisch selbst) */
export interface PlayState {
    turn: number | null;
    phase: 'roll' | 'move' | 'over' | string;
    rolls_left?: number;
    dice?: number | null;
    seats?: number[];
    finished?: number[];
    /** Plätze, die gerade handeln dürfen (Engine 2.1; Tandem-Schach: zwei gleichzeitig) */
    to_move?: number[];
    /** erlaubte Züge des Spielers am Zug (nur in phase 'move') */
    moves?: { piece: string; to: string }[];
    /** Standard-Anzeige (Engine 2.3, siehe tabletop_server/rules.py): Statuszeile, Warnungen, Punkte, Markierungen */
    say?: { me?: string; all?: string };
    alerts?: Record<string, string>;
    scores?: number[];
    scores_label?: string;
    marks?: Mark[];
    result?: { winners: number[]; reason?: string; text?: string } | null;
    [key: string]: unknown;
}

/** Markiertes Feld: letzter Zug, Warnung (König im Schach), Hinweis */
export interface Mark {
    field: string;
    kind: 'last' | 'alert' | 'hint' | string;
}

/** Spiel + aktuelle Variante (Engine 2.1: Plätze, Farben und Lage gehören zur Variante) */
export interface GameInfo {
    id: string;
    title: string;
    seats: number;
    seat_colors: string[];
    /** Lage der Plätze in Grad (0 = unten, im Uhrzeigersinn); null = gleichmäßig */
    seat_angles?: number[] | null;
    /** Namen der Plätze („Weiß“, „Rot“) – Engine 2.3 */
    seat_names?: string[] | null;
    /** so viele müssen sitzen, damit es losgeht */
    min_players?: number;
    /** Satz für die Lobby (Host) */
    lobby?: string;
    variant?: string;
    variant_title?: string;
    variants?: { id: string; title: string; seats: number }[];
    version?: string;
    engine?: string;
    rules_api?: number | null;
}

export interface TableState {
    room: string;
    /** version = Version des Spiels, engine = Version des Spieltisch-Servers, rules_api = Fassung der Regel-Schnittstelle */
    game: GameInfo;
    host_id: string | null;
    members: Member[];
    layout: Layout;
    pieces: Record<string, PieceState>;
    last_roll: Roll | null;
    /** null = freier Tisch ohne Regeln */
    status: 'lobby' | 'playing' | 'finished' | null;
    play: PlayState | null;
    /** Hausregeln: aktuelle Werte und was der Host einstellen kann (leer = nichts einstellbar) */
    settings?: Record<string, SettingValue>;
    settings_schema?: Record<string, SettingSpec>;
}

export type TableEvent =
    | { type: 'MEMBER_JOINED'; member: Member }
    | { type: 'MEMBER_UPDATED'; member: Member }
    | { type: 'MEMBER_LEFT'; id: string }
    | { type: 'HOST_CHANGED'; host_id: string | null }
    | { type: 'PIECE_GRABBED'; piece: string; by: string }
    | { type: 'PIECE_RELEASED'; piece: string }
    | { type: 'PIECE_MOVED'; piece: string; from: string; to: string; by: string; path?: string[]; capture?: string | null; reason?: string }
    | { type: 'PIECE_CHANGED'; piece: string; kind: string; by?: string; reason?: string }
    | { type: 'GAME_UPDATED'; status: TableState['status']; play: PlayState | null }
    | { type: 'DICE_ROLLED'; by: string; values: number[]; throw: ThrowSpec }
    | { type: 'SETTINGS_UPDATED'; settings: Record<string, SettingValue> }
    | { type: 'NOTE'; text: string; you?: Record<string, string> }
    | {
        type: 'BOARD_CHANGED'; variant: string; game: GameInfo; layout: Layout; pieces: Record<string, PieceState>;
        members: Member[]; settings: Record<string, SettingValue>; settings_schema: Record<string, SettingSpec>;
    };

export function applyEvent(state: TableState, ev: TableEvent): TableState {
    switch (ev.type) {
        case 'MEMBER_JOINED':
            return { ...state, members: [...state.members.filter(m => m.id !== ev.member.id), ev.member] };
        case 'MEMBER_UPDATED':
            return { ...state, members: state.members.map(m => (m.id === ev.member.id ? ev.member : m)) };
        case 'MEMBER_LEFT':
            return { ...state, members: state.members.filter(m => m.id !== ev.id) };
        case 'HOST_CHANGED':
            return { ...state, host_id: ev.host_id };
        case 'PIECE_GRABBED':
            return withPiece(state, ev.piece, { held_by: ev.by });
        case 'PIECE_RELEASED':
            return withPiece(state, ev.piece, { held_by: null });
        case 'PIECE_MOVED':
            return withPiece(state, ev.piece, { field: ev.to, held_by: null });
        case 'PIECE_CHANGED':
            return withPiece(state, ev.piece, { kind: ev.kind === state.layout.pieces[ev.piece]?.kind ? null : ev.kind });
        case 'GAME_UPDATED':
            return { ...state, status: ev.status, play: ev.play };
        case 'DICE_ROLLED':
            return { ...state, last_roll: { by: ev.by, values: ev.values, throw: ev.throw } };
        case 'SETTINGS_UPDATED':
            return { ...state, settings: ev.settings };
        case 'BOARD_CHANGED':
            // Andere Spielvariante (nur in der Lobby): neues Brett, neue Plätze
            return {
                ...state, game: ev.game, layout: ev.layout, pieces: ev.pieces, members: ev.members, play: null,
                settings: ev.settings, settings_schema: ev.settings_schema, last_roll: null
            };
        default:
            return state;   // unbekannte Ereignisse (neuere Server-Version) ignorieren
    }
}

function withPiece(state: TableState, id: string, patch: Partial<PieceState>): TableState {
    const cur = state.pieces[id];
    if (!cur) return state;
    return { ...state, pieces: { ...state.pieces, [id]: { ...cur, ...patch } } };
}
