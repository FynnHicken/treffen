import { formatPrice } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useVolatileMpStore } from '@/stores/mp-volatile-store';
import { RoundTimer } from './round-timer';

export const WaitingForResultsCard = () => {
	const playersLeft = useVolatileMpStore(state => state.playersLeft);
	const guessedPrice = useVolatileMpStore(state => state.guessedPrice);

	return (
		<Card className='max-w-fit'>
			<CardHeader>
				<CardTitle>Warte auf die anderen</CardTitle>
				<CardDescription>Die Runde endet, sobald alle geschätzt haben oder die Zeit um ist.</CardDescription>
			</CardHeader>
			<CardContent>
				<div className='flex items-center justify-center gap-4'>
					<div className='text-center'>
						<h1 className='text-2xl font-semibold'>{playersLeft}</h1>
						<p className='text-zinc-600 dark:text-zinc-400 text-sm'>fehlen noch</p>
					</div>
					<div>-</div>
					<RoundTimer />
				</div>

				<hr className='my-4 dark:border-zinc-800' />

				<div className='text-center'>
					<h1 className='text-md'>
						Deine Schätzung: <span className='font-semibold'>{formatPrice(guessedPrice)}</span>
					</h1>
				</div>
			</CardContent>
		</Card>
	);
};
