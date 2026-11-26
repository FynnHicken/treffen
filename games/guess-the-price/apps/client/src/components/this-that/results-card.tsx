import { HouseSimple, Joystick } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardFooter, CardTitle } from '../ui/card';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Fireworks from 'react-canvas-confetti/dist/presets/fireworks';

interface Props {
	guesses: number;
	onContinue: () => void;
}

export const ResultsCard = ({ guesses, onContinue }: Props) => {
	const [confettiVisible, setConfettiVisible] = useState(false);

	useEffect(() => {
		if (guesses >= 10) {
			setConfettiVisible(true);
		}
	}, [guesses]);

	return (
		<>
			{confettiVisible && <Fireworks autorun={{ speed: 0.2 }} />}

			<Card>
				<CardHeader>
					<CardTitle>Bilanz</CardTitle>
					<CardDescription>So oft lagst du richtig.</CardDescription>
				</CardHeader>

				<CardContent className='text-center'>
					<h1 className='text-6xl font-bold'>{guesses}</h1>
					<p className='text-zinc-700 dark:text-zinc-400'>richtig</p>
				</CardContent>
				<CardFooter className='flex flex-row gap-2'>
					<Link to='/'>
						<Button className='bg-red-500 hover:bg-red-600'>
							<HouseSimple size={24} /> Hauptmenü
						</Button>
					</Link>

					<Button className='w-full md:min-w-[240px]' onClick={onContinue}>
						<Joystick size={24} /> Nochmal
					</Button>
				</CardFooter>
			</Card>
		</>
	);
};
