import { useEffect } from 'react';
import { socket } from '@/socket';
import { OutgoingEvents } from '@/interfaces/mp-events.types';
import {
	ExceptionOutgoingPayload,
	HostChangedOutgoingPayload,
	PlayerJoinsOutgoingPayload,
	PlayerLeavesOutgoingPayload,
	PLayerReconnectsOutgoingPayload,
} from '@/interfaces/mp-payloads.types';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useMpStore } from '@/stores/mp-store';
import { useVolatileMpStore } from '@/stores/mp-volatile-store';
import { hub } from '@/lib/hub';

export const useMpNotifications = () => {
	const navigate = useNavigate();

	useEffect(() => {
		const store = () => useMpStore.getState();

		const onPlayerJoin = (payload: PlayerJoinsOutgoingPayload) => {
			store().setPlayers(payload.players, payload.playerNames, payload.playerAvatars);
			if (payload.host) store().setHost(payload.host);
			if (payload.playerName !== store().playerName) toast.success(`${payload.playerName} ist dabei`);
		};

		const onPlayerLeave = (payload: PlayerLeavesOutgoingPayload) => {
			store().setPlayers(payload.players, payload.playerNames, payload.playerAvatars);
			toast.warning(`${payload.playerName} ist weg`);
		};

		const onPlayerReconnect = (payload: PLayerReconnectsOutgoingPayload) => {
			store().setPlayers(payload.players, payload.playerNames, payload.playerAvatars);
			if (payload.host) store().setHost(payload.host);
			if (payload.playerName !== store().playerName) toast.info(`${payload.playerName} ist wieder da`);
		};

		const onHostChanged = (payload: HostChangedOutgoingPayload) => {
			store().setHost(payload.host);
			toast.info(`${payload.host} leitet jetzt die Runde`);
		};

		const onError = (payload: ExceptionOutgoingPayload) => {
			toast.error('Fehler', { description: payload.msg });

			if (payload.code === 404 && !hub) {
				store().clear();
				useVolatileMpStore.getState().reset();
				navigate('/multiplayer');
			}
		};

		socket.on(OutgoingEvents.PLAYER_JOINS_SESSION, onPlayerJoin);
		socket.on(OutgoingEvents.PLAYER_LEAVES, onPlayerLeave);
		socket.on(OutgoingEvents.PLAYER_RECONNECTS, onPlayerReconnect);
		socket.on(OutgoingEvents.HOST_CHANGED, onHostChanged);
		socket.on(OutgoingEvents.EXCEPTION, onError);

		return () => {
			socket.off(OutgoingEvents.PLAYER_JOINS_SESSION, onPlayerJoin);
			socket.off(OutgoingEvents.PLAYER_LEAVES, onPlayerLeave);
			socket.off(OutgoingEvents.PLAYER_RECONNECTS, onPlayerReconnect);
			socket.off(OutgoingEvents.HOST_CHANGED, onHostChanged);
			socket.off(OutgoingEvents.EXCEPTION, onError);
		};
	}, [navigate]);
};
