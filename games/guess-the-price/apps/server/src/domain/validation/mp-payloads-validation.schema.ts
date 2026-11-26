import { z } from 'zod';

export const requiresPlayerIdPayloadSchema = z.object({
	playerId: z.string({ message: 'playerId fehlt' }).max(64),
});

export const JoinSessionPayloadSchema = z.object({
	sessionId: z.string({ message: 'sessionId muss Text sein' }).max(64).optional(),
	hub: z
		.object({
			room: z.string().max(32),
			name: z.string().max(64).optional(),
			ticket: z.string().max(2048).optional(),
		})
		.optional(),
});

export const GuessPricePayloadSchema = z.object({
	guessedPrice: z
		.number({ message: 'Bitte eine Zahl eingeben' })
		.finite()
		.min(0, { message: 'Der Preis kann nicht negativ sein' })
		.max(100_000_000, { message: 'So teuer ist nichts hier' }),
});

export const ReconnectPayloadSchema = z.object({
	playerId: z.string({ message: 'playerId fehlt' }).max(64),
	sessionId: z.string({ message: 'sessionId fehlt' }).max(64),
});
