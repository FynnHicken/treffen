import { v4 as uuid } from 'uuid';
import { generateUsername } from 'unique-username-generator';
import { MPSessionDatasource } from '../../../domain/datasources/mp-session-datasource';
import { MpSession } from '../../../domain/multiplayer/mp-session';
import { Server } from 'socket.io';
import { SocketError } from '../../../domain/errors/socket-error';
import { HubJoinInfo } from '../../../domain/interfaces/mp-payloads.types';
import { cleanName, HUB_ROOM_RE, hubSessionId, ticketsEnabled, verifyHubTicket } from '../../../domain/hub/hub-ticket';

interface ConnectionResult {
	session: MpSession;
	player: { name: string; id: string };
	/** Spieler war schon in der Sitzung (z. B. Seite neu geladen) und behält seine Punkte */
	rejoined: boolean;
	hostChanged: boolean;
}

export class MPSessionsService {
	private static sessionManager = new MPSessionDatasource();

	public static getSession(id: string) {
		return this.sessionManager.getSession(id);
	}

	public static handlePlayerConnection(socketId: string, io: Server, sessionId?: string, hub?: HubJoinInfo): ConnectionResult {
		if (hub) return this.handleHubConnection(socketId, io, hub);

		const player = this.createPlayer();

		if (this.sessionManager.isSocketOwnerOfSession(socketId)) {
			throw new SocketError('Du leitest schon eine Runde.');
		}

		if (!sessionId) {
			const session = new MpSession({ ...player, isHost: true, socketId }, io);
			this.sessionManager.addSession(session, socketId);
			return { session, player, rejoined: false, hostChanged: false };
		}

		if (sessionId.startsWith('hub-')) {
			throw new SocketError('Diese Runde gehört zu einem Treffen-Raum – bitte über den Hub beitreten.', 403);
		}

		const session = this.sessionManager.getSession(sessionId);
		if (!session) {
			throw new SocketError('Diese Runde gibt es nicht (mehr).', 404);
		}

		if (session.isSocketConnected(socketId)) {
			throw new SocketError('Du bist schon in dieser Runde.');
		}

		session.addPlayer({ ...player, isHost: false, socketId });
		return { session, player, rejoined: false, hostChanged: false };
	}

	/**
	 * Beitritt über den Hub: eine feste Sitzung pro Treffen-Raum, Name aus dem Hub.
	 * Mit TREFFEN_TICKET_SECRET zählt nur das signierte Ticket (Name, Spieler-ID, Host-Recht);
	 * ohne Schlüssel (GTP einzeln gestartet) wird der erste Spieler Host.
	 */
	private static handleHubConnection(socketId: string, io: Server, hub: HubJoinInfo): ConnectionResult {
		const room = String(hub.room || '').toUpperCase();
		if (!HUB_ROOM_RE.test(room)) throw new SocketError('Ungültiger Raumcode.', 400);

		let hubPid: string | null = null;
		let name = cleanName(hub.name);
		let wantsHost = false;
		if (ticketsEnabled()) {
			const ticket = verifyHubTicket(hub.ticket, room);
			if (!ticket) {
				throw new SocketError('Kein gültiges Hub-Ticket – bitte das Spiel über den Hub öffnen.', 401);
			}
			hubPid = ticket.pid;
			name = ticket.name;
			wantsHost = ticket.host;
		}

		const id = hubSessionId(room);
		let session = this.sessionManager.getSession(id);
		if (!session) {
			session = new MpSession(null, io, { id, fromHub: true });
			this.sessionManager.addSession(session);
		}

		// Dieselbe Person (gleiche Hub-ID bzw. ohne Tickets: gleicher Name) kommt zurück → alten Platz übernehmen
		const existing = session.players.find(p => (hubPid ? p.hubPid === hubPid : p.name === name && !!p.disconnectedAt));
		let player: { id: string; name: string };
		let rejoined = false;
		if (existing) {
			existing.socketId = socketId;
			existing.disconnectedAt = undefined;
			existing.name = name;
			player = existing;
			rejoined = true;
		} else {
			player = { id: uuid(), name: this.uniqueName(session, name) };
			session.addPlayer({ ...player, isHost: false, socketId, hubPid: hubPid ?? undefined });
		}

		const previousHost = session.hostId;
		if (ticketsEnabled()) {
			// Der Hub entscheidet, wer Host ist (Host-Wechsel im Hub wird beim nächsten Beitritt übernommen)
			if (wantsHost) session.setHost(player.id);
		} else if (!session.host || session.host.disconnectedAt) {
			session.setHost(player.id);
		}
		session.refreshActivity();
		return { session, player, rejoined, hostChanged: previousHost !== null && previousHost !== session.hostId };
	}

	/** Zwei Gäste mit gleichem Namen bekommen „Name (2)“, damit Ergebnisse eindeutig bleiben */
	private static uniqueName(session: MpSession, name: string) {
		const taken = new Set(session.players.map(p => p.name));
		if (!taken.has(name)) return name;
		for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`)) return `${name} (${i})`;
	}

	public static handlePlayerReconnection(sessionId: string, playerId: string, socketId: string) {
		const session = this.sessionManager.getSession(sessionId);
		if (!session) {
			throw new SocketError('Diese Runde gibt es nicht (mehr).', 404);
		}
		const player = session.reconnectPlayer(playerId, socketId);

		if (!player) {
			throw new SocketError('Wiederverbinden hat nicht geklappt.', 404);
		}

		return { player, session };
	}

	public static handlePlayerDisconnection(socketId: string, sessionId: string) {
		const playerSession = this.sessionManager.getSession(sessionId);
		playerSession?.playerDisconnected(socketId);
	}

	public static removeSession(sessionId: string) {
		this.sessionManager.removeSession(sessionId);
	}

	public static createPlayer() {
		const name = generateUsername('-');
		const id = uuid();

		return { name, id };
	}
}
