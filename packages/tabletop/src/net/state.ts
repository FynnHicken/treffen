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
    board?: { kind: string; size: number; spacing?: number };
    dice?: { count: number; sides: number };
    palette?: Record<string, string>;
    fields: Record<string, FieldSpec>;
    pieces: Record<string, PieceSpec>;
}

export interface PieceState {
    field: string;
    held_by: string | null;
}

export interface TableState {
    room: string;
    game: { id: string; title: string; seats: number; seat_colors: string[] };
    host_id: string | null;
    members: Member[];
    layout: Layout;
    pieces: Record<string, PieceState>;
    last_roll: Roll | null;
}

export type TableEvent =
    | { type: 'MEMBER_JOINED'; member: Member }
    | { type: 'MEMBER_UPDATED'; member: Member }
    | { type: 'MEMBER_LEFT'; id: string }
    | { type: 'HOST_CHANGED'; host_id: string | null }
    | { type: 'PIECE_GRABBED'; piece: string; by: string }
    | { type: 'PIECE_RELEASED'; piece: string }
    | { type: 'PIECE_MOVED'; piece: string; from: string; to: string; by: string }
    | { type: 'DICE_ROLLED'; by: string; values: number[]; throw: ThrowSpec };

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
        case 'DICE_ROLLED':
            return { ...state, last_roll: { by: ev.by, values: ev.values, throw: ev.throw } };
        default:
            return state;   // unbekannte Ereignisse (neuere Server-Version) ignorieren
    }
}

function withPiece(state: TableState, id: string, patch: Partial<PieceState>): TableState {
    const cur = state.pieces[id];
    if (!cur) return state;
    return { ...state, pieces: { ...state.pieces, [id]: { ...cur, ...patch } } };
}
