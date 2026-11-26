import { PlayerAvatar } from './player-avatar';
import { PlayerSessionResultsRecord } from '@/interfaces/mp.interfaces';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { useMpStore } from '@/stores/mp-store';
import { Button } from '../ui/button';
import { GameController, SignOut } from '@phosphor-icons/react';
import { DestructiveActionButton } from '../ui/confirmation-dialog';
import { motion } from 'framer-motion';
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks';

interface Props {
	results: PlayerSessionResultsRecord[];
	roundsPlayed: number;
	isHost: boolean;
	canTerminate?: boolean;

	onTerminateSession: () => void;
	onContinuePlaying: () => void;
}

const containerVariant = {
	hidden: { opacity: 0 },
	visible: {
		opacity: 1,
		transition: {
			delayChildren: 0.2,
			staggerChildren: 0.15,
		},
	},
};

const itemVariant = {
	hidden: { opacity: 0, x: 50 },
	visible: { opacity: 1, x: 0 },
};

export const SessionResultsCard = ({ results, roundsPlayed, isHost, canTerminate = true, onTerminateSession, onContinuePlaying }: Props) => {
	const playerName = useMpStore(state => state.playerName);

	return (
		<>
			{results.length > 0 && results[0].playerName == playerName && <Fireworks autorun={{ speed: 0.2 }} />}
			<Card>
				<CardHeader>
					<CardTitle>Gesamtwertung</CardTitle>
					<CardDescription>{roundsPlayed} {roundsPlayed === 1 ? 'Runde' : 'Runden'} gespielt – so steht es.</CardDescription>
				</CardHeader>
				<CardContent>
					<motion.div initial='hidden' animate='visible' variants={containerVariant} className='flex flex-col gap-4'>
						{results.map((result, i) => (
							<motion.div
								variants={itemVariant}
								className='flex justify-between items-center p-4 rounded-md border dark:border-zinc-800'
								key={result.playerName}
							>
								<div className='flex flex-col md:flex-row gap-2 items-start justify-start'>
									<div className='flex gap-2 items-center justify-start'>
										<h3 className='text-lg font-semibold'>#{i + 1}</h3>
										<PlayerAvatar name={result.playerName} size={36} />
										<h3 className='font-medium'>
											{result.playerName} {playerName == result.playerName && '(du)'}
										</h3>
									</div>
									<div className='text-start'>
										<p className='text-zinc-600 dark:text-zinc-400'>
											Punkte:
											<span className='ml-1 text-neutral-900 font-semibold dark:text-zinc-100'>
												{result.points}/{100 * roundsPlayed}
											</span>
										</p>
										<p className='text-zinc-600 dark:text-zinc-400'>
											Beste Schätzung:{' '}
											<span className='ml-1 text-neutral-900 font-semibold dark:text-zinc-100'>
												{result.bestGuess}/100
											</span>
										</p>
									</div>
								</div>
							</motion.div>
						))}
					</motion.div>
				</CardContent>
				{isHost && (
					<CardFooter className='flex-col items-start gap-2'>
						<div className='flex md:flex-row flex-col md:gap-4 gap-2 w-full'>
							{canTerminate && (
								<DestructiveActionButton
									title='Runde auflösen?'
									description='Danach müsst ihr eine neue Runde erstellen und alle neu einladen.'
									onConfirm={onTerminateSession}
								>
									<SignOut size={24} /> Auflösen
								</DestructiveActionButton>
							)}
							<Button className='w-full' onClick={onContinuePlaying}>
								<GameController size={24} /> Neues Spiel
							</Button>
						</div>
						<p className='text-sm text-neutral-600 dark:text-neutral-400'>
							Du leitest die Runde: „Neues Spiel“ setzt die Punkte zurück, alle bleiben dabei.
						</p>
					</CardFooter>
				)}
			</Card>
		</>
	);
};
