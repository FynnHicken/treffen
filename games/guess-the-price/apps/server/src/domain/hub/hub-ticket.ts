// Hub-Anbindung: Der Party-Server signiert pro Person ein Ticket {v, room, pid, name, host, exp}
// mit TREFFEN_TICKET_SECRET (siehe party-server/server.js und games/monopoly/server/auth.py).
// Format: base64url(JSON) + "." + base64url(HMAC-SHA256(body)).
import crypto from 'crypto';
import 'dotenv/config';

export interface HubTicket {
	room: string;
	pid: string;
	name: string;
	host: boolean;
}

const secret = () => (process.env.TREFFEN_TICKET_SECRET ?? '').trim();

export const ticketsEnabled = () => secret().length > 0;

export const HUB_ROOM_RE = /^[A-Z0-9_-]{1,32}$/;

export const hubSessionId = (room: string) => `hub-${room}`;

export const verifyHubTicket = (ticket: unknown, room: string): HubTicket | null => {
	const key = secret();
	if (!key || typeof ticket !== 'string' || ticket.length > 2048) return null;
	const parts = ticket.split('.');
	if (parts.length !== 2) return null;
	const [body, sig] = parts;
	const expected = crypto.createHmac('sha256', key).update(body).digest();
	let given: Buffer;
	try {
		given = Buffer.from(sig, 'base64url');
	} catch {
		return null;
	}
	if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
	try {
		const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
		if (data.room !== room || typeof data.pid !== 'string' || typeof data.exp !== 'number') return null;
		if (data.exp < Date.now() / 1000) return null;
		return { room: data.room, pid: data.pid, name: cleanName(data.name), host: data.host === true };
	} catch {
		return null;
	}
};

/** Namen kommen von anderen Clients: kurz halten, keine Steuer-/HTML-Zeichen. */
export const cleanName = (value: unknown): string => {
	if (typeof value !== 'string') return 'Gast';
	const name = value.replace(/[\u0000-\u001f<>"'`]/g, '').trim().slice(0, 24);
	return name || 'Gast';
};
