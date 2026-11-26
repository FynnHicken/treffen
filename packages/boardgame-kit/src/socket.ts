/**
 * WebSocket-Verbindung zu einem Spielserver mit dem Treffen-Protokoll:
 *  1. URL `<base>ws/<room>/<playerId>`
 *  2. erste Nachricht `{action: "AUTH", secret}` (siehe Identity)
 *  3. danach JSON-Nachrichten in beide Richtungen
 *
 * Wiederverbinden passiert automatisch (mit wachsender Pause). Schließt der Server mit 4003
 * („ID gehört einem anderen Browser“), wird still eine neue Spieler-ID genommen.
 */
import type { Identity } from './identity';

export const CLOSE_ID_IN_USE = 4003;

export interface GameSocketOptions {
    identity: Identity;
    /** Basis-Pfad der Seite, z. B. "/monopoly/" (Standard: Verzeichnis der aktuellen URL) */
    basePath?: string;
    /** Wird nach jedem (Wieder-)Verbinden direkt nach AUTH aufgerufen – hier JOIN senden */
    onOpen?: () => void;
    onMessage: (msg: any) => void;
    /** Verbindung weg (vor dem nächsten Versuch) */
    onDisconnect?: (ev: CloseEvent) => void;
    /** Neue Spieler-ID nach Close 4003 */
    onPlayerIdChanged?: (playerId: string) => void;
}

export function pageBasePath(): string {
    const p = window.location.pathname;
    return p.endsWith('/') ? p : p.substring(0, p.lastIndexOf('/') + 1);
}

export class GameSocket {
    private ws: WebSocket | null = null;
    private room: string | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private retries = 0;
    private readonly opts: GameSocketOptions;

    constructor(opts: GameSocketOptions) {
        this.opts = opts;
    }

    get roomId(): string | null {
        return this.room;
    }

    get isOpen(): boolean {
        return !!this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    /** Mit einem Raum verbinden (trennt eine bestehende Verbindung ohne Reconnect). */
    connect(room: string): void {
        this.disconnect();
        this.room = room;
        this.open();
    }

    /** Verbindung beenden, nicht wieder verbinden. */
    disconnect(): void {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.room = null;
        if (this.ws) {
            this.ws.onclose = null;
            try { this.ws.close(); } catch { /* egal */ }
            this.ws = null;
        }
    }

    send(msg: object): boolean {
        if (!this.isOpen) return false;
        this.ws!.send(JSON.stringify(msg));
        return true;
    }

    private open(): void {
        const room = this.room;
        if (!room) return;
        const { identity } = this.opts;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const base = this.opts.basePath ?? pageBasePath();
        const url = `${proto}//${window.location.host}${base}ws/${encodeURIComponent(room)}/${encodeURIComponent(identity.playerId)}`;
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
            this.retries = 0;
            ws.send(JSON.stringify({ action: 'AUTH', secret: identity.clientSecret }));
            this.opts.onOpen?.();
        };
        ws.onmessage = ev => {
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch (err) { console.error('WebSocket: kein JSON', err); return; }
            try { this.opts.onMessage(msg); } catch (err) { console.error('WebSocket: Fehler im Handler', err); }
        };
        ws.onclose = ev => {
            if (this.ws !== ws) return;
            this.ws = null;
            this.opts.onDisconnect?.(ev);
            if (!this.room) return;
            if (ev.code === CLOSE_ID_IN_USE) {
                this.opts.onPlayerIdChanged?.(identity.renewPlayerId());
            }
            // 1 s, 2 s, 4 s … max. 10 s
            const delay = Math.min(10000, 1000 * 2 ** Math.min(this.retries, 4));
            this.retries++;
            this.retryTimer = setTimeout(() => this.open(), delay);
        };
    }
}
