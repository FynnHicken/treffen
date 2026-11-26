import { Copy, Joystick } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { toast } from 'sonner';
import { PlayerAvatar } from './player-avatar';

interface Props {
	isHost: boolean;
	sessionId: string;
	playerNumber: number;
	playerName: string;
	playerNames: string[];
	hostName: string;
	/** über den Treffen-Hub gestartet: kein Einladungslink, die Gruppe ist schon da */
	fromHub: boolean;
	onStart?: () => void;
}

export const ShareSessionCard = ({ isHost, sessionId, playerNumber, playerName, playerNames, hostName, fromHub, onStart }: Props) => {
	const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
	const link = `${typeof window !== 'undefined' ? window.location.origin : ''}${base}/multiplayer/${sessionId}`;
	const onCopyLink = () => {
		navigator.clipboard.writeText(link);
		toast.info('Link kopiert!');
	};
	const names = playerNames.length ? playerNames : [playerName];

	return (
		<div className='w-full max-w-[640px] flex flex-col gap-5'>
			<Card>
				<CardHeader>
					<CardTitle>Wer spielt mit?</CardTitle>
					<CardDescription>
						{isHost
							? 'Du leitest die Runde. Starte, sobald alle da sind – wer später kommt, steigt in der nächsten Runde ein.'
							: `${hostName || 'Der Host'} startet die Runde, sobald alle da sind.`}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ul className='flex flex-wrap gap-2' aria-label={`${playerNumber || names.length} Spieler`}>
						{names.map(name => (
							<li
								key={name}
								className={`inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-md border text-sm font-medium dark:border-zinc-700 ${name === playerName ? 'border-cyan-400 dark:border-cyan-400' : ''}`}
							>
								<PlayerAvatar name={name} size={28} />
								{name}
								{name === playerName && <span className='text-zinc-500'> (du)</span>}
								{name === hostName && <span className='ml-1 text-amber-500 text-xs font-semibold'>HOST</span>}
							</li>
						))}
					</ul>
				</CardContent>
				{isHost && (
					<CardFooter className='border-t-[1px] dark:border-zinc-800 pt-4'>
						<Button className='w-full h-12 text-base' onClick={onStart} data-testid='gtp-start'>
							<Joystick size={24} /> Los geht's
						</Button>
					</CardFooter>
				)}
			</Card>

			{!fromHub && (
				<Card>
					<CardHeader>
						<CardTitle>Freunde einladen</CardTitle>
						<CardDescription>Schick diesen Link an alle, die mitspielen wollen.</CardDescription>
					</CardHeader>
					<CardContent>
						<p className='hidden md:block text-sm font-medium break-all'>{link}</p>
						<Button className='mt-2 w-full' onClick={onCopyLink}>
							<Copy size={24} /> Link kopieren
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	);
};
