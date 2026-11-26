//Incoming payloads

import { PlayerRoundResultsRecord, PlayerSessionResultsRecord } from './mp.interfaces';
import { RandomProduct } from './product.interface';

export type RequiredPlayerId = {
	playerId: string;
};

export type HubJoinInfo = {
	room: string;
	name?: string;
	ticket?: string;
};

export type JoinSessionPayload = {
	sessionId?: string;
	hub?: HubJoinInfo;
};

export type GuessPricePayload = {
	playerId: string;
	guessedPrice: number;
};

export type ReconnectPayload = {
	playerId: string;
	sessionId: string;
};

export type StartRoundPayload = RequiredPlayerId;
export type ShowResultsPayload = RequiredPlayerId;
export type EndSessionPayload = RequiredPlayerId;

//Outgoing payloads
export interface PlayerLeavesOutgoingPayload {
	playerName: string;
	players: number;
	playerNames?: string[];
	playerAvatars?: Record<string, string>;
}

export interface PlayerJoinsOutgoingPayload {
	playerName: string;
	players: number;
	playerNames?: string[];
	playerAvatars?: Record<string, string>;
	host?: string;
}

export type PLayerReconnectsOutgoingPayload = PlayerJoinsOutgoingPayload;

export interface SessionDetailsOutgoingPayload {
	currentlyPlaying: boolean;
	host: string;
	sessionId: string;
	players: number;
	playerNames: string[];
	playerAvatars: Record<string, string>;
	fromHub: boolean;
}

export interface PlayerDetailsOutgoingPayload {
	playerName: string;
	playerId: string;
	isHost: boolean;
}

export interface ExceptionOutgoingPayload {
	msg: string;
	code: number;
}

export interface RoundStartsOutgoingPayload {
	product: RandomProduct;
	startTime: Date;
	seconds: number;
	endTime: number;
}

export interface PlayerGuessOutgoingPayload {
	currentGuesses?: number;
	players: number;
}

export interface SessionResultsOutgoingPayload {
	roundsPlayed: number;
	playerResults: PlayerSessionResultsRecord[];
}

export interface RoundResultsOutgoingPayload {
	product: RandomProduct;
	playerResults: PlayerRoundResultsRecord[];
}
