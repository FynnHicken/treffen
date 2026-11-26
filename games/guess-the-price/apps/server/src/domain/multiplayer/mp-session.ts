import 'dotenv/config';
import { v4 as uuid } from 'uuid';
import { Server } from 'socket.io';

import { SocketError } from '../errors/socket-error';
import { compareDates } from '../../utils/compare-dates';

import { OutgoingEvents } from '../interfaces/mp-events.types';
import { Player, Round, PlayerSessionResultsRecord } from '../interfaces/mp.interfaces';
import { RandomProduct } from '../interfaces/product.interface';
import {
	PlayerLeavesOutgoingPayload,
	RoundResultsOutgoingPayload,
	SessionResultsOutgoingPayload,
} from '../interfaces/mp-payloads.types';

export class MpSession {
	public hostId: string | null;
	public readonly id: string;
	/** Sitzung gehört zu einem Hub-Raum (feste ID hub-<RAUM>, Namen/Host aus dem Hub) */
	public readonly fromHub: boolean;
	public players: Player[] = [];
	public lastActive: Date;

	public currentRound: Round | null;
	public pastRounds: Round[];
	public seenProducts: string[];

	private readonly io: Server;

	constructor(host: Player | null, io: Server, opts: { id?: string; fromHub?: boolean } = {}) {
		this.hostId = host ? host.id : null;
		if (host) this.addPlayer(host);
		this.id = opts.id ?? uuid();
		this.fromHub = !!opts.fromHub;
		this.currentRound = null;
		this.pastRounds = [];
		this.seenProducts = [];
		this.io = io;
		this.lastActive = new Date();
	}

	public get host(): Player | null {
		return this.players.find(p => p.id === this.hostId) ?? null;
	}

	public get hostName(): string {
		return this.host?.name ?? '';
	}

	public isHost(playerId: string | null | undefined) {
		return !!playerId && playerId === this.hostId;
	}

	public setHost(playerId: string) {
		this.hostId = playerId;
		this.players.forEach(p => (p.isHost = p.id === playerId));
	}

	/** Spieler-ID der Verbindung – Aktionen gelten immer für den Spieler hinter dem Socket, nie für IDs aus der Nachricht */
	public playerIdForSocket(socketId: string): string | null {
		return this.players.find(p => p.socketId === socketId && !p.disconnectedAt)?.id ?? null;
	}

	public findPlayer(playerId: string) {
		return this.players.find(p => p.id === playerId) ?? null;
	}

	public get connectedPlayers() {
		return this.players.filter(p => !p.disconnectedAt);
	}

	public get playerNames() {
		return this.connectedPlayers.map(p => p.name);
	}

	/**
	 * Name → Avatar-Bild aus dem Hub (party-server rendert es aus Gesicht + Farbe).
	 * Nur für Hub-Spieler mit Ticket (hubPid); auch Abwesende, damit die Wertung ihre Bilder behält.
	 */
	public get playerAvatars(): Record<string, string> {
		if (!this.fromHub) return {};
		const room = encodeURIComponent(this.id.replace(/^hub-/, ''));
		return Object.fromEntries(
			this.players.filter(p => p.hubPid).map(p => [p.name, `/party-ws/avatar/${room}/${encodeURIComponent(p.hubPid!)}.svg`]),
		);
	}

	//Session management
	public endSession() {
		this.io
			.of('/mp-ws')
			.to(this.id)
			.emit(OutgoingEvents.SESSION_ENDS, this.getSessionResults() as SessionResultsOutgoingPayload);
	}

	public restartSession() {
		this.currentRound = null;
		this.pastRounds = [];
		this.seenProducts = [];
		this.lastActive = new Date();

		this.io.of('/mp-ws').to(this.id).emit(OutgoingEvents.SESSION_RESTARTS);
	}

	public getSessionResults() {
		const sessionResults: { roundsPlayed: number; playerResults: PlayerSessionResultsRecord[] } = {
			roundsPlayed: 0,
			playerResults: [],
		};

		if (!this.pastRounds.length) {
			return sessionResults;
		}

		sessionResults.roundsPlayed = this.pastRounds.length;
		sessionResults.playerResults = this.players.map(player => ({
			playerName: player.name,
			guesses: player.metrics?.guesses ?? 0,
			points: player.metrics?.points ?? 0,
			bestGuess: player.metrics?.bestGuess ?? 0,
		}));

		sessionResults.playerResults = sessionResults.playerResults.sort((a, b) => b.points - a.points);

		return sessionResults;
	}

	//Player management
	public addPlayer(player: Player) {
		if (!player) {
			throw new SocketError('Spieler ohne Namen kann nicht beitreten.');
		}

		if (this.connectedPlayers.length >= (Number(process.env.MAX_PLAYERS_SESSION) || 12)) {
			throw new SocketError('Die Runde ist voll.');
		}

		this.players.push({ ...player, metrics: { points: 0, guesses: 0, bestGuess: 0 } });
		this.refreshActivity();
		return player;
	}

	public reconnectPlayer(playerId: string, socketId: string) {
		const existingPlayer = this.players.find(p => p.id === playerId);

		if (existingPlayer) {
			existingPlayer.socketId = socketId;
			existingPlayer.disconnectedAt = undefined;
			return existingPlayer;
		}
	}

	public playerDisconnected(socketId: string) {
		const disconnectedPlayer = this.players.find(player => player.socketId == socketId);
		if (!disconnectedPlayer) return;

		disconnectedPlayer.disconnectedAt = new Date();
		this.io
			.of('/mp-ws')
			.to(this.id)
			.emit(OutgoingEvents.PLAYER_LEAVES, {
				playerName: disconnectedPlayer.name,
				players: this.connectedPlayers.length,
				playerNames: this.playerNames,
				playerAvatars: this.playerAvatars,
			} as PlayerLeavesOutgoingPayload);

		// Wer noch fehlt, ist vielleicht gerade gegangen – dann nicht bis zum Ende der Zeit warten
		this.endRoundIfEveryoneGuessed();
	}

	public isSocketConnected(socketId: string) {
		const player = this.players.find(player => player.socketId == socketId);
		return !!player;
	}

	//Rounds & game
	public startRound(product: RandomProduct) {
		this.seenProducts.push(product!.id);
		this.currentRound = {
			product: product!,
			startTime: new Date(),
			seconds: Number(process.env.MP_SESSION_ROUND_DURATION_SECONDS ?? 30),
			guesses: [],
		};
		this.refreshActivity();
		// Der echte Preis geht erst mit dem Rundenergebnis raus, sonst stünde er schon im Netzwerkverkehr
		const { price: _hidden, ...productWithoutPrice } = this.currentRound.product;
		void _hidden;
		return {
			...this.currentRound,
			product: productWithoutPrice,
			endTime: this.currentRound.startTime.getTime() + this.currentRound.seconds * 1000,
		};
	}

	public async guessPrice(playerId: string, points: number, guessedPrice: number) {
		if (!this.currentRound) {
			throw new SocketError('Die Runde ist schon vorbei.');
		}
		if (this.currentRound.guesses.find(guess => guess.playerId == playerId)) {
			throw new SocketError('Du hast schon geschätzt.');
		}
		const player = this.players.find(player => player.id == playerId);
		if (!player) {
			throw new SocketError('Du bist nicht in dieser Runde.');
		}

		this.currentRound.guesses.push({
			playerId,
			guessedPrice,
			points: points,
			playerName: player.name,
		});

		if (player.metrics!.bestGuess < points) {
			player.metrics!.bestGuess = points;
		}

		player.metrics!.points += points;
		player.metrics!.guesses++;

		this.refreshActivity();
		this.endRoundIfEveryoneGuessed();
	}

	private endRoundIfEveryoneGuessed() {
		if (!this.currentRound) return;
		const guessed = new Set(this.currentRound.guesses.map(g => g.playerId));
		const waiting = this.connectedPlayers.filter(p => !guessed.has(p.id));
		if (this.currentRound.guesses.length > 0 && waiting.length === 0) {
			this.endRound();
		}
	}

	private endRound() {
		if (!this.currentRound) return;

		this.pastRounds.push({ ...this.currentRound });
		this.io
			.of('/mp-ws')
			.to(this.id)
			.emit(OutgoingEvents.ROUND_ENDS, this.getRoundResults() as RoundResultsOutgoingPayload);
		this.currentRound = null;
		this.refreshActivity();
	}

	public getGuessesLeft() {
		return {
			currentGuesses: this.currentRound?.guesses.length,
			players: this.connectedPlayers.length,
		};
	}

	public getRoundResults() {
		if (!this.currentRound) return null;
		const results = this.currentRound.guesses.map(g => {
			return {
				guessedPrice: g.guessedPrice,
				points: g.points,
				playerName: g.playerName,
			};
		});

		return {
			product: this.currentRound.product,
			playerResults: results.sort((a, b) => b.points - a.points),
		};
	}

	//Housekeeping
	public roundTick() {
		if (!this.currentRound) return;

		if (
			compareDates(this.currentRound.startTime, new Date()) >=
			Number(process.env.MP_SESSION_ROUND_DURATION_SECONDS ?? 30)
		) {
			this.endRound();
		}
	}

	public refreshActivity() {
		this.lastActive = new Date();
	}

	public checkSessionActive() {
		// Hub-Runden warten länger: Die Gruppe sitzt evtl. noch in der Lobby oder plaudert zwischen den Runden
		const limit = this.fromHub ? Number(process.env.MP_HUB_SESSION_INACTIVE_SECONDS ?? 1800) : Number(process.env.MP_SESSION_INACTIVE_SECONDS ?? 180);
		if (compareDates(this.lastActive, new Date()) >= limit) {
			this.io.of('/mp-ws').to(this.id).emit(OutgoingEvents.SESSION_TERMINATE);
			return false;
		}
		return true;
	}
}
