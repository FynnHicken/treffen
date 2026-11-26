import { MpSession } from '../multiplayer/mp-session';

export class MPSessionDatasource {
	private static _instance: MPSessionDatasource;
	private sessions = new Map<string, MpSession>();
	private sessionOwners = new Map<string, string>();

	constructor() {
		if (MPSessionDatasource._instance) {
			return MPSessionDatasource._instance;
		}

		MPSessionDatasource._instance = this;
		return this;
	}

	public addSession(session: MpSession, ownerSocketId?: string) {
		if (ownerSocketId) this.sessionOwners.set(ownerSocketId, session.id);
		this.sessions.set(session.id, session);
	}

	public removeSession(id: string) {
		this.sessions.delete(id);
		for (const [socketId, sessionId] of this.sessionOwners) if (sessionId === id) this.sessionOwners.delete(socketId);
	}

	public getSession(id: string) {
		return this.sessions.get(id) ?? null;
	}

	public isSocketOwnerOfSession(socketId: string) {
		return !!this.sessionOwners.get(socketId);
	}

	//Housekeeping
	public roundTick = () => {
		if (!this.sessions) return;
		this.sessions.forEach(session => {
			session.roundTick();
		});
	};

	public cleanupTick = () => {
		if (!this.sessions) return;
		this.sessions.forEach(session => {
			if (!session.checkSessionActive()) {
				this.removeSession(session.id);
			}
		});
	};
}
