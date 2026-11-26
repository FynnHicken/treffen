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

export interface TableState {
    room: string;
    game: { id: string; title: string; seats: number; seat_colors: string[] };
    host_id: string | null;
    members: Member[];
}

export type TableEvent =
    | { type: 'MEMBER_JOINED'; member: Member }
    | { type: 'MEMBER_UPDATED'; member: Member }
    | { type: 'MEMBER_LEFT'; id: string }
    | { type: 'HOST_CHANGED'; host_id: string | null };

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
        default:
            return state;   // unbekannte Ereignisse (neuere Server-Version) ignorieren
    }
}
