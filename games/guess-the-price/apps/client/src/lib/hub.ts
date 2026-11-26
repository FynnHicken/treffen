// Start über den Treffen-Hub: /price-guess/?room=CODE&name=NAME#ticket=…
// Dann gibt es kein Hauptmenü, alle landen direkt in der gemeinsamen Runde des Raums
// (Sitzung hub-<RAUM>). Das Ticket steht im Fragment (#), damit es nicht in Server-Logs landet.

export interface HubContext {
	room: string;
	name: string;
	ticket?: string;
}

const KEY = 'gtp_hub';

function readHubContext(): HubContext | null {
	if (typeof window === 'undefined') return null;
	const query = new URLSearchParams(window.location.search);
	const room = (query.get('room') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
	if (room) {
		const name = (query.get('name') || '').slice(0, 24);
		const match = window.location.hash.match(/ticket=([^&]+)/);
		const ctx: HubContext = { room, name, ticket: match ? decodeURIComponent(match[1]) : undefined };
		try {
			sessionStorage.setItem(KEY, JSON.stringify(ctx));
		} catch {
			/* privater Modus – dann eben nur für diesen Seitenaufruf */
		}
		// Ticket und Parameter aus der Adresszeile nehmen
		window.history.replaceState(null, '', window.location.pathname);
		return ctx;
	}
	try {
		return JSON.parse(sessionStorage.getItem(KEY) || 'null');
	} catch {
		return null;
	}
}

export const hub: HubContext | null = readHubContext();
export const hubSessionId: string | null = hub ? `hub-${hub.room}` : null;
