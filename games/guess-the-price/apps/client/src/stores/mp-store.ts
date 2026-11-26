import { persist, createJSONStorage } from 'zustand/middleware';
import { create } from 'zustand';

export interface PlayerDetails {
	playerId: string;
	playerName: string;
	isHost: boolean;
}

export interface SessionDetails {
	sessionId: string;
	players: number;
	playerNames?: string[];
	/** Name → Avatar-URL aus dem Hub */
	playerAvatars?: Record<string, string>;
	hostName?: string;
}

interface MpState extends PlayerDetails, SessionDetails {
	setSession: (details: SessionDetails) => void;
	setPlayer: (details: PlayerDetails) => void;
	setPlayers: (players: number, playerNames?: string[], playerAvatars?: Record<string, string>) => void;
	setHost: (hostName: string) => void;
	clear: () => void;
}

export const useMpStore = create<MpState>()(
	persist(
		set => ({
			sessionId: '',
			playerId: '',
			playerName: '',
			isHost: false,
			players: 0,
			playerNames: [],
			playerAvatars: {},
			hostName: '',
			sessionStatus: {
				sessionStarted: false,
			},

			setSession: (details: SessionDetails) => set(() => ({ ...details })),
			setPlayer: (details: PlayerDetails) => set(() => ({ ...details })),
			setPlayers: (players: number, playerNames?: string[], playerAvatars?: Record<string, string>) =>
				set(state => ({
					players,
					playerNames: playerNames ?? state.playerNames,
					// Abwesende behalten ihr Bild (für die Wertung)
					playerAvatars: playerAvatars ? { ...state.playerAvatars, ...playerAvatars } : state.playerAvatars,
				})),
			setHost: (hostName: string) => set(state => ({ hostName, isHost: !!hostName && hostName === state.playerName })),
			clear: () =>
				set(() => ({
					sessionId: '',
					playerId: '',
					playerName: '',
					isHost: false,
					players: 0,
					playerNames: [],
					playerAvatars: {},
					hostName: '',
					sessionStatus: {
						sessionStarted: false,
					},
				})),
		}),
		{
			name: 'multiplayer',
			storage: createJSONStorage(() => sessionStorage),
		}
	)
);
