import { Schema, ZodError } from 'zod';
import { SocketError } from '../errors/socket-error';

export const validateMpPayload = (payload: object, targetSchema: Schema) => {
	try {
		targetSchema.parse(payload ?? {});
	} catch (error) {
		const first = error instanceof ZodError ? error.issues[0]?.message : null;
		throw new SocketError(first || 'Ungültige Nachricht.');
	}
};
