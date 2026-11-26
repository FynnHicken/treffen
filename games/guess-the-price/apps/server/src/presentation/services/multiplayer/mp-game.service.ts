import { SocketError } from '../../../domain/errors/socket-error';
import { MPSessionDatasource } from '../../../domain/datasources/mp-session-datasource';
import { GuessService } from '../guess.service';
import { RandomService } from '../random.service';

export class MPGameService {
	private static mpSessionDatasource = new MPSessionDatasource();

	public static startRound = async (sessionId: string, playerId: string) => {
		const session = this.mpSessionDatasource.getSession(sessionId);

		if (!session) {
			throw new SocketError('Du bist in keiner Runde.');
		}

		if (!session.isHost(playerId)) {
			throw new SocketError('Nur der Host startet neue Runden.');
		}

		if (session.currentRound) {
			throw new SocketError('Die Runde läuft noch.');
		}

		try {
			// Alle Produkte schon gezeigt → von vorn (sonst ginge nach dem letzten Produkt nichts mehr)
			if (session.seenProducts.length >= (await RandomService.countProducts())) session.seenProducts = [];
			const product = await RandomService.getRandomProduct(session.seenProducts);
			if (!product) {
				throw new Error('Cannot get random product (MPGameService)');
			}
			const { guesses, ...rest } = session.startRound(product);
			return rest;
		} catch (error) {
			console.error(error);
			throw new SocketError('Runde konnte nicht starten – kein Produkt gefunden.');
		}
	};

	public static makeGuess = async (sessionId: string, playerId: string, guessedPrice: number) => {
		const session = this.mpSessionDatasource.getSession(sessionId);

		if (!session) {
			throw new SocketError('Du bist in keiner Runde.');
		}

		if (!session.currentRound) {
			throw new SocketError('Die Runde ist schon vorbei.');
		}
		if (session.currentRound.guesses.some(g => g.playerId === playerId)) {
			throw new SocketError('Du hast schon geschätzt.');
		}

		try {
			const results = await GuessService.guessProductPrice(session.currentRound.product.id, guessedPrice);
			session.guessPrice(playerId, results?.points ?? 0, guessedPrice ?? 0);
			return session.getGuessesLeft();
		} catch (error) {
			console.error(error);
			throw new SocketError('Schätzung konnte nicht gewertet werden.');
		}
	};

	public static endSession = (sessionId: string, playerId: string) => {
		const session = this.mpSessionDatasource.getSession(sessionId);

		if (!session) {
			throw new SocketError('Du bist in keiner Runde.');
		}

		if (!session.isHost(playerId)) {
			throw new SocketError('Nur der Host kann das Spiel beenden.');
		}

		session.endSession();
	};

	public static terminateSession = (sessionId: string, playerId: string) => {
		const session = this.mpSessionDatasource.getSession(sessionId);

		if (!session) {
			throw new SocketError('Du bist in keiner Runde.');
		}

		if (!session.isHost(playerId)) {
			throw new SocketError('Nur der Host kann das Spiel beenden.');
		}
		this.mpSessionDatasource.removeSession(sessionId);
	};

	public static restartSession = async (sessionId: string, playerId: string) => {
		const session = this.mpSessionDatasource.getSession(sessionId);

		if (!session) {
			throw new SocketError('Du bist in keiner Runde.');
		}

		if (!session.isHost(playerId)) {
			throw new SocketError('Nur der Host kann neu starten.');
		}

		session.restartSession();
	};
}
