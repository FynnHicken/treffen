/**
 * Verbindung eines Browsers zum Spieltisch-Server.
 * Hält den Zustand aktuell (SNAPSHOT + nummerierte EVENTs, bei Lücke → SYNC) und verteilt Präsenz.
 */
import { GameSocket, loadIdentity, type Identity } from '@treffen/boardgame-kit';
import { applyEvent, type Member, type TableEvent, type TableState } from './state';
import { ENGINE_VERSION } from '../version';

export interface PresenceData {
    x: number;
    z: number;
    down?: boolean;
    hold?: string;
}

type Listener<T> = (value: T) => void;

export class TableClient {
    readonly identity: Identity;
    state: TableState | null = null;
    connected = false;
    private seq = -1;
    private socket: GameSocket;
    private name: string;
    private stateListeners = new Set<Listener<TableState>>();
    private eventListeners = new Set<Listener<TableEvent>>();
    private presenceListeners = new Set<(from: string, p: PresenceData | null) => void>();
    private connectionListeners = new Set<Listener<boolean>>();
    private errorListeners = new Set<(err: any) => void>();
    private lastPresenceSent = 0;
    private pendingPresence: PresenceData | null = null;
    private presenceTimer: ReturnType<typeof setTimeout> | null = null;

    /** Präsenz höchstens so oft senden (Server lässt 30/s zu) */
    static PRESENCE_INTERVAL_MS = 66;

    constructor(opts: { namespace: string; room: string; name: string }) {
        this.identity = loadIdentity(opts.namespace);
        this.name = opts.name;
        this.socket = new GameSocket({
            identity: this.identity,
            onOpen: () => {
                this.setConnected(true);
                this.socket.send({ action: 'JOIN', name: this.name, ticket: this.identity.hubTicket || undefined });
            },
            onMessage: msg => this.onMessage(msg),
            onDisconnect: () => this.setConnected(false)
        });
        this.socket.connect(opts.room);
    }

    get you(): string {
        return this.identity.playerId;
    }

    get me(): Member | undefined {
        return this.state?.members.find(m => m.id === this.you);
    }

    get isHost(): boolean {
        return !!this.state && this.state.host_id === this.you;
    }

    onState(fn: Listener<TableState>): () => void {
        this.stateListeners.add(fn);
        if (this.state) fn(this.state);
        return () => this.stateListeners.delete(fn);
    }

    onEvent(fn: Listener<TableEvent>): () => void {
        this.eventListeners.add(fn);
        return () => this.eventListeners.delete(fn);
    }

    onPresence(fn: (from: string, p: PresenceData | null) => void): () => void {
        this.presenceListeners.add(fn);
        return () => this.presenceListeners.delete(fn);
    }

    onConnection(fn: Listener<boolean>): () => void {
        this.connectionListeners.add(fn);
        fn(this.connected);
        return () => this.connectionListeners.delete(fn);
    }

    start(): void {
        this.socket.send({ action: 'START' });
    }

    newRound(): void {
        this.socket.send({ action: 'NEW_ROUND' });
    }

    /** Hausregeln ändern (nur Host, nur Lobby – der Server prüft) */
    setSettings(values: Record<string, boolean | number | string>): void {
        this.socket.send({ action: 'SET_SETTINGS', settings: values });
    }

    addBot(seat: number): void {
        this.socket.send({ action: 'ADD_BOT', seat });
    }

    removeBot(seat: number): void {
        this.socket.send({ action: 'REMOVE_BOT', seat });
    }

    /** Bin ich am Zug? (ohne Regeln: immer, wenn ich sitze) */
    get myTurn(): boolean {
        const s = this.state, me = this.me;
        if (!s || !me || me.seat === null) return false;
        if (!s.status) return true;
        return s.status === 'playing' && s.play?.turn === me.seat;
    }

    /** Darf ich jetzt würfeln? */
    get canRoll(): boolean {
        const s = this.state;
        if (!s || !this.me || this.me.seat === null) return false;
        if (!s.status || s.status === 'lobby') return true;      // freier Tisch / Lobby: zum Ausprobieren
        return this.myTurn && s.play?.phase === 'roll' && (s.play.rolls_left ?? 0) > 0;
    }

    /** Erlaubte Ziele einer Figur (null = freier Tisch, jedes freie Feld) */
    legalTargets(piece: string): string[] | null {
        const s = this.state;
        if (!s?.status) return null;
        if (!this.myTurn || s.play?.phase !== 'move') return [];
        return (s.play.moves ?? []).filter(m => m.piece === piece).map(m => m.to);
    }

    roll(power: number): void {
        this.socket.send({ action: 'ROLL', power });
    }

    grab(piece: string): void {
        this.socket.send({ action: 'GRAB', piece });
    }

    release(piece: string): void {
        this.socket.send({ action: 'RELEASE', piece });
    }

    drop(piece: string, field: string): void {
        this.socket.send({ action: 'DROP', piece, field });
    }

    /** Server-Fehler (z. B. DROP_REJECTED) */
    onError(fn: (err: { code: string; message: string; [k: string]: unknown }) => void): () => void {
        this.errorListeners.add(fn);
        return () => this.errorListeners.delete(fn);
    }

    sit(seat: number): void {
        this.socket.send({ action: 'SIT', seat });
    }

    stand(): void {
        this.socket.send({ action: 'STAND' });
    }

    /** Zeiger senden – gedrosselt; der letzte Stand geht immer raus. */
    sendPresence(p: PresenceData): void {
        this.pendingPresence = p;
        const wait = TableClient.PRESENCE_INTERVAL_MS - (performance.now() - this.lastPresenceSent);
        if (wait <= 0) {
            this.flushPresence();
        } else if (!this.presenceTimer) {
            this.presenceTimer = setTimeout(() => this.flushPresence(), wait);
        }
    }

    private flushPresence(): void {
        if (this.presenceTimer) clearTimeout(this.presenceTimer);
        this.presenceTimer = null;
        if (!this.pendingPresence) return;
        this.socket.send({ action: 'PRESENCE', p: this.pendingPresence });
        this.pendingPresence = null;
        this.lastPresenceSent = performance.now();
    }

    private setConnected(v: boolean): void {
        this.connected = v;
        for (const fn of this.connectionListeners) fn(v);
    }

    private onMessage(msg: any): void {
        switch (msg.type) {
            case 'SNAPSHOT':
                this.seq = msg.seq;
                this.checkVersion(msg.state);
                this.setState(msg.state);
                break;
            case 'EVENT':
                if (!this.state) return;
                if (msg.seq !== this.seq + 1) {
                    // Lücke (z. B. Nachricht verpasst) → vollen Zustand neu holen
                    this.socket.send({ action: 'SYNC' });
                    return;
                }
                this.seq = msg.seq;
                for (const fn of this.eventListeners) fn(msg.event);
                this.setState(applyEvent(this.state, msg.event));
                break;
            case 'PRESENCE':
                for (const fn of this.presenceListeners) fn(msg.from, msg.p);
                break;
            case 'ERROR':
                console.warn('Server:', msg.code, msg.message);
                for (const fn of this.errorListeners) fn(msg);
                break;
        }
    }

    /** Versionen für Anzeige und Fehlersuche: Spiel, Engine im Client, Engine am Server */
    get versions(): { game?: string; client: string; server?: string; rulesApi?: number | null } {
        const g = this.state?.game;
        return { game: g?.version, client: ENGINE_VERSION, server: g?.engine, rulesApi: g?.rules_api };
    }

    private versionLogged = false;
    private checkVersion(s: TableState): void {
        if (this.versionLogged) return;
        this.versionLogged = true;
        const server = s.game?.engine;
        console.info(`[Spieltisch] ${s.game?.title ?? ''} ${s.game?.version ?? ''} · Engine ${ENGINE_VERSION}` +
            (server && server !== ENGINE_VERSION ? ` (Server ${server})` : ''));
        if (server && server.split('.')[0] !== ENGINE_VERSION.split('.')[0]) {
            console.warn('[Spieltisch] Client und Server haben verschiedene Engine-Hauptversionen – Seite neu laden.');
        }
    }

    private setState(s: TableState): void {
        this.state = s;
        for (const fn of this.stateListeners) fn(s);
    }

    disconnect(): void {
        this.socket.disconnect();
    }
}
