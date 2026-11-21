import { Server as HttpServer } from 'http';
import { Server as SocketIoServer } from 'socket.io';
import { gameSessionSocketHandler } from '../multiplayer/session.handlers';
import { sessionRoundsSocketHandlers } from '../multiplayer/round.handlers';
import 'dotenv/config';

export class WSService {
	private static _instance: WSService;
	private socketIoServer: SocketIoServer;

	constructor(httpServer: HttpServer) {
		this.socketIoServer = new SocketIoServer(httpServer, {
			path: '/price-guess-socket',
			cors: { origin: process.env.CORS_ORIGIN ?? '*' },
		});
		this.start();
	}

	static init(httpServer: HttpServer) {
		if (this._instance) {
			return;
		}
		this._instance = new WSService(httpServer);
	}

	static get instance() {
		if (!this._instance) {
			throw new Error('Instance not initialized');
		}

		return this._instance;
	}

	public start() {
		this.socketIoServer.of('/mp-ws').on('connection', socket => {
			//Register handlers
			gameSessionSocketHandler(this.socketIoServer, socket);
			sessionRoundsSocketHandlers(this.socketIoServer, socket);
		});
	}
}
