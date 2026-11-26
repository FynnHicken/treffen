import { FormEvent, useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Check } from '@phosphor-icons/react';

interface Props {
	onGuess: (price: number) => void;
}

export const GuessCard = ({ onGuess }: Props) => {
	const [guessedPrice, setGuessedPrice] = useState<string | number>('');

	const guessPrice = (e: FormEvent) => {
		e.preventDefault();
	};

	return (
		<Card className='max-h-fit md:min-w-[350px] flex-1'>
			<CardHeader>
				<CardTitle>Deine Schätzung</CardTitle>
				<CardDescription className='word-break'>
					Lies dir die Preis-Infos durch und tippe dann deinen Preis in Euro ein.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form className='space-y-4' onSubmit={guessPrice}>
					<Input
						type='number'
						inputMode='decimal'
						step='0.01'
						min='0'
						placeholder='z. B. 49,99'
						aria-label='Preis in Euro'
						value={guessedPrice}
						onChange={e => setGuessedPrice(e.target.value)}
					/>
					<Button
						className='w-full'
						type='submit'
						onClick={() => {
							if (Number(guessedPrice)) {
								onGuess(Number(guessedPrice));
							}
						}}
					>
						<Check size={24} /> Schätzen
					</Button>
				</form>
			</CardContent>
		</Card>
	);
};
