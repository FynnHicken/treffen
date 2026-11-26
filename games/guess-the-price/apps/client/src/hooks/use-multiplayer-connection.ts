import { useEffect, useState } from 'react';
import { socket } from '../socket';
import {
	ExceptionOutgoingPayload,
	JoinSessionPayload,
	PlayerDetailsOutgoingPayload,
	ReconnectPayload,
	SessionDetailsOutgoingPayload,
} from '@/interfaces/mp-payloads.types';
import { IncomingEvents, OutgoingEvents } from '@/interfaces/mp-events.types';
import { useMpStore } from '@/stores/mp-store';
import { useNavigate } from 'react-router-dom';
import { useVolatileMpStore } from '@/stores/mp-volatile-store';
import { toast } from 'sonner';
import { hub } from '@/lib/hub';

const connect = () => {
	if (!socket.connected) {
		socket.connect();
	}
};

export const useMultiplayerConnection = () => {
	const [socketError, setSocketError] = useState<null | string>(null);
	const { setSession, setPlayer, clear, sessionId, playerId } = useMpStore();
	const { loadSession, setConnected, connectedToSession, reset } = useVolatileMpStore();
	const navigate = useNavigate();

	const createSession = () => {
		if (!connectedToSession) {
			socket.emit(IncomingEvents.PLAYER_JOIN_SESSION, {});
		}
	};

	const connectToExistingSession = (sessionId: string) => {
		if (!connectedToSession) {
			socket.emit(IncomingEvents.PLAYER_JOIN_SESSION, { sessionId } as JoinSessionPayload);
		}
	};

	const leaveSession = () => {
		navigate('/');
		clear();
		reset();
		socket.disconnect(); //In order to send disconnection event to server
	};

	useEffect(() => {
		connect();

		const onSessionDetails = (
			sessionPayload: SessionDetailsOutgoingPayload,
			playerPayload: PlayerDetailsOutgoingPayload
		) => {
			if (!sessionPayload || !playerPayload) return;

			setSession({
				sessionId: sessionPayload.sessionId,
				players: sessionPayload.players,
				playerNames: sessionPayload.playerNames ?? [],
				playerAvatars: sessionPayload.playerAvatars ?? {},
				hostName: sessionPayload.host,
			});
			setPlayer({ ...playerPayload, isHost: playerPayload.isHost ?? sessionPayload.host === playerPayload.playerName });
			loadSession(sessionPayload.currentlyPlaying, sessionPayload.currentlyPlaying);
			setConnected(true);

			if (!hub && sessionPayload.host === playerPayload.playerName) {
				//Joining as host from mp joining page
				navigate(`/multiplayer/${sessionPayload.sessionId}`);
			}
		};

		const onSocketError = (payload: ExceptionOutgoingPayload) => {
			if (payload.msg) {
				setSocketError(payload.msg);
			} else {
				setSocketError('Unbekannter Fehler im Mehrspieler-Modus.');
			}
		};

		const onSocketDisconnect = () => {
			setConnected(false);
		};

		const onSocketConnect = () => {
			//Try to reconnect if you were in a session and socket lost connection to server
			// (Hub-Runden treten bei jeder Verbindung neu über den Hub bei, siehe MultiplayerPage)
			if (!hub && !connectedToSession && socket.connected && sessionId && playerId) {
				socket.emit(IncomingEvents.PLAYER_RECONNECT, { playerId, sessionId } as ReconnectPayload);
			}
		};

		const onSessionTerminated = () => {
			clear();
			reset();
			navigate('/');
			socket.disconnect();
			toast.warning('Runde beendet', {
				description: 'Der Host hat die Runde beendet.',
			});
		};

		socket.on(OutgoingEvents.SESSION_DETAILS, onSessionDetails);
		socket.on(OutgoingEvents.EXCEPTION, onSocketError);
		socket.on(OutgoingEvents.SESSION_TERMINATE, onSessionTerminated);
		socket.on('disconnect', onSocketDisconnect);
		socket.on('connect', onSocketConnect);

		return () => {
			socket.off(OutgoingEvents.SESSION_DETAILS, onSessionDetails);
			socket.off(OutgoingEvents.EXCEPTION, onSocketError);
			socket.off(OutgoingEvents.SESSION_TERMINATE, onSessionTerminated);
			socket.off('disconnect', onSocketDisconnect);
			socket.off('connect', onSocketConnect);
		};
	});

	return {
		socketError,
		createSession,
		connectToExistingSession,
		leaveSession,
	};
};
