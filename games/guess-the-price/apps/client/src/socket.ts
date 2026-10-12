import { io } from 'socket.io-client';

const getSocketConfig = () => {
	const envUrl = import.meta.env.VITE_SOCKET_URL;
	if (envUrl) {
		return { url: envUrl, path: '/price-guess-socket' };
	}
	if (typeof window !== 'undefined') {
		const isDevPort = window.location.port === '8088';
		const host = window.location.hostname;
		const url = isDevPort ? `http://${host}:3005/mp-ws` : `${window.location.origin}/mp-ws`;
		return { url, path: '/price-guess-socket' };
	}
	return { url: 'http://localhost:3005/mp-ws', path: '/price-guess-socket' };
};

const config = getSocketConfig();
export const socket = io(config.url, {
	path: config.path,
	autoConnect: false,
	transports: ['websocket', 'polling'],
});

