import { Server, Socket } from 'socket.io';
import { handleSocketError } from '../../domain/errors/handlers/handle-socket-error';
import { MPGameService } from '../services/multiplayer/mp-game.service';
import { MPSessionsService } from '../services/multiplayer/mp-sessions.service';
import { IncomingEvents, OutgoingEvents } from '../../domain/interfaces/mp-events.types';
import { GuessPricePayload, PlayerGuessOutgoingPayload, RoundStartsOutgoingPayload } from '../../domain/interfaces/mp-payloads.types';
import { validateMpPayload } from '../../domain/validation/validate-mp-payload';
import { GuessPricePayloadSchema } from '../../domain/validation/mp-payloads-validation.schema';
import { SocketError } from '../../domain/errors/socket-error';

export const sessionRoundsSocketHandlers = (io: Server, socket: Socket) => {
	/** Sitzung + Spieler-ID dieser Verbindung (IDs aus der Nachricht werden ignoriert) */
	const me = () => {
		const sessionId = [...socket.rooms].find(r => r !== socket.id);
		const session = sessionId ? MPSessionsService.getSession(sessionId) : null;
		const id = session?.playerIdForSocket(socket.id);
		if (!session || !id) throw new SocketError('Du bist in keiner Runde.');
		return { session, id };
	};

	const startRound = async () => {
		try {
			const { session, id } = me();
			const round = await MPGameService.startRound(session.id, id);
			io.of('/mp-ws').to(session.id).emit(OutgoingEvents.ROUND_STARTS, round as RoundStartsOutgoingPayload);
		} catch (error) {
			handleSocketError(error, socket);
		}
	};

	const guessPrice = async (payload: GuessPricePayload) => {
		try {
			validateMpPayload(payload, GuessPricePayloadSchema);
			const { session, id } = me();

			const guessesLeft = await MPGameService.makeGuess(session.id, id, payload.guessedPrice);

			if (guessesLeft.currentGuesses !== guessesLeft.players) {
				io.of('/mp-ws').to(session.id).emit(OutgoingEvents.PLAYER_GUESS, guessesLeft as PlayerGuessOutgoingPayload);
			}
		} catch (error) {
			handleSocketError(error, socket);
		}
	};

	socket.on(IncomingEvents.HOST_STARTS_ROUND, startRound);
	socket.on(IncomingEvents.PLAYER_GUESS_PRICE, guessPrice);
};
