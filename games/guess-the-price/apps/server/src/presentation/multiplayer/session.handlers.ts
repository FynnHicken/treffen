import { Server, Socket } from 'socket.io';
import { MPSessionsService } from '../services/multiplayer/mp-sessions.service';
import { handleSocketError } from '../../domain/errors/handlers/handle-socket-error';
import { IncomingEvents, OutgoingEvents } from '../../domain/interfaces/mp-events.types';
import {
	JoinSessionPayload,
	PlayerDetailsOutgoingPayload,
	PlayerJoinsOutgoingPayload,
	PLayerReconnectsOutgoingPayload,
	ReconnectPayload,
	RoundStartsOutgoingPayload,
	SessionDetailsOutgoingPayload,
} from '../../domain/interfaces/mp-payloads.types';
import { validateMpPayload } from '../../domain/validation/validate-mp-payload';
import { JoinSessionPayloadSchema, ReconnectPayloadSchema } from '../../domain/validation/mp-payloads-validation.schema';
import { MPGameService } from '../services/multiplayer/mp-game.service';
import { MpSession } from '../../domain/multiplayer/mp-session';
import { SocketError } from '../../domain/errors/socket-error';

const sessionDetails = (session: MpSession): SessionDetailsOutgoingPayload => ({
	sessionId: session.id,
	host: session.hostName,
	currentlyPlaying: !!session.currentRound,
	players: session.connectedPlayers.length,
	playerNames: session.playerNames,
	playerAvatars: session.playerAvatars,
	fromHub: session.fromHub,
});

const playerDetails = (session: MpSession, player: { id: string; name: string }): PlayerDetailsOutgoingPayload => ({
	playerId: player.id,
	playerName: player.name,
	isHost: session.isHost(player.id),
});

export const gameSessionSocketHandler = (io: Server, socket: Socket) => {
	let currentSessionID: string | null = null;
	const room = () => io.of('/mp-ws').to(currentSessionID ?? '');

	/** Spieler-ID dieser Verbindung (nicht die aus der Nachricht – die könnte jeder hineinschreiben) */
	const myPlayerId = () => {
		const session = currentSessionID ? MPSessionsService.getSession(currentSessionID) : null;
		const id = session?.playerIdForSocket(socket.id);
		if (!session || !id) throw new SocketError('Du bist in keiner Runde.');
		return { session, id };
	};

	const announce = (session: MpSession, event: OutgoingEvents, playerName: string) => {
		room().emit(event, {
			playerName,
			players: session.connectedPlayers.length,
			playerNames: session.playerNames,
			playerAvatars: session.playerAvatars,
			host: session.hostName,
		} as PlayerJoinsOutgoingPayload);
	};

	const joinSession = (payload: JoinSessionPayload) => {
		try {
			validateMpPayload(payload, JoinSessionPayloadSchema);

			const { session, player, rejoined, hostChanged } = MPSessionsService.handlePlayerConnection(
				socket.id,
				io,
				payload.sessionId,
				payload.hub
			);
			currentSessionID = session.id;
			socket.join(session.id);

			socket.emit(OutgoingEvents.SESSION_DETAILS, sessionDetails(session), playerDetails(session, player));
			announce(session, rejoined ? OutgoingEvents.PLAYER_RECONNECTS : OutgoingEvents.PLAYER_JOINS_SESSION, player.name);
			if (hostChanged) room().emit(OutgoingEvents.HOST_CHANGED, { host: session.hostName });
		} catch (error) {
			handleSocketError(error, socket);
		}
	};

	const reconnect = (payload: ReconnectPayload) => {
		try {
			validateMpPayload(payload, ReconnectPayloadSchema);

			const { player, session } = MPSessionsService.handlePlayerReconnection(payload.sessionId, payload.playerId, socket.id);
			currentSessionID = session.id;
			socket.join(session.id);
			socket.emit(OutgoingEvents.SESSION_DETAILS, sessionDetails(session), playerDetails(session, player));
			announce(session, OutgoingEvents.PLAYER_RECONNECTS, player.name);
		} catch (error) {
			handleSocketError(error, socket);
		}
	};

	const disconnect = () => {
		if (!currentSessionID) return;
		MPSessionsService.handlePlayerDisconnection(socket.id, currentSessionID);
	};

	const endSession = () => {
		try {
			const { session, id } = myPlayerId();
			MPGameService.endSession(session.id, id);
		} catch (error) {
			handleSocketError(error, socket);
		}
	};

	const terminateSession = () => {
		try {
			const { session, id } = myPlayerId();
			MPGameService.terminateSession(session.id, id);
			room().emit(OutgoingEvents.SESSION_TERMINATE);
		} catch (error) {
			handleSocketError(error, socket);
		}
	};

	const restartSession = async () => {
		try {
			const { session, id } = myPlayerId();
			MPGameService.restartSession(session.id, id);
			const round = await MPGameService.startRound(session.id, id);
			room().emit(OutgoingEvents.ROUND_STARTS, round as RoundStartsOutgoingPayload);
		} catch (error) {
			handleSocketError(error, socket);
		}
	};

	socket.on(IncomingEvents.PLAYER_JOIN_SESSION, joinSession);
	socket.on(IncomingEvents.PLAYER_RECONNECT, reconnect);
	socket.on(IncomingEvents.HOST_END_SESSION, endSession);
	socket.on(IncomingEvents.HOST_RESTART_SESSION, restartSession);
	socket.on(IncomingEvents.HOST_TERMINATE_SESSION, terminateSession);
	socket.on('disconnect', disconnect);
};
