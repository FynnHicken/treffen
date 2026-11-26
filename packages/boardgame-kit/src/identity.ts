/**
 * Wer bin ich? – Spieler-ID (pro Tab), Client-Secret (pro Browser) und Hub-Ticket.
 *
 * Gegenstück auf dem Server: `games/monopoly/server/auth.py` (AUTH-Nachricht, Ticket-Prüfung).
 * Jedes Spiel bekommt eigene Storage-Schlüssel über `namespace`, damit sich Spiele nicht in die
 * Quere kommen (z. B. "monopoly" → `monopoly_player_id`, `monopoly_client_secret`, …).
 */

const SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function randomToken(bytes: number): string {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export function newPlayerId(): string {
    return 'p_' + randomToken(10);
}

function tryGet(storage: Storage, key: string): string | null {
    try { return storage.getItem(key); } catch { return null; }
}
function trySet(storage: Storage, key: string, value: string): void {
    try { storage.setItem(key, value); } catch { /* Privatmodus o. Ä. – dann eben nur im Speicher */ }
}

export interface Identity {
    /** Spieler-ID dieses Tabs (sessionStorage, übersteht Reload) */
    playerId: string;
    /** Geheimnis dieses Browsers (localStorage), bindet die playerId serverseitig */
    clientSecret: string;
    /** Vom Hub signiertes Ticket (Host-Nachweis) oder null, wenn ohne Hub gestartet */
    hubTicket: string | null;
    /** Neue Spieler-ID erzeugen und speichern (z. B. nach Close 4003 „ID gehört anderem Browser“) */
    renewPlayerId(): string;
}

/**
 * Liest bzw. erzeugt die Identität. Ein Ticket im URL-Fragment (`#ticket=…`) wird übernommen,
 * im sessionStorage gemerkt (für Reloads) und aus der Adresszeile entfernt.
 */
export function loadIdentity(namespace: string): Identity {
    const idKey = `${namespace}_player_id`;
    const secretKey = `${namespace}_client_secret`;
    const ticketKey = `${namespace}_hub_ticket`;

    let clientSecret = tryGet(localStorage, secretKey);
    if (!clientSecret || !SECRET_RE.test(clientSecret)) {
        clientSecret = randomToken(24);
        trySet(localStorage, secretKey, clientSecret);
    }

    let playerId = tryGet(sessionStorage, idKey);
    if (!playerId || !/^[A-Za-z0-9_-]{1,40}$/.test(playerId) || playerId.startsWith('bot_')) {
        playerId = newPlayerId();
        trySet(sessionStorage, idKey, playerId);
    }

    let hubTicket: string | null = null;
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
    if (fromHash) {
        trySet(sessionStorage, ticketKey, fromHash);
        history.replaceState(null, '', window.location.pathname + window.location.search);
        hubTicket = fromHash;
    } else {
        hubTicket = tryGet(sessionStorage, ticketKey);
    }

    const identity: Identity = {
        playerId,
        clientSecret,
        hubTicket,
        renewPlayerId() {
            identity.playerId = newPlayerId();
            trySet(sessionStorage, idKey, identity.playerId);
            return identity.playerId;
        }
    };
    return identity;
}
