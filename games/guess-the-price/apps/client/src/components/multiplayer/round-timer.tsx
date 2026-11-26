import { useVolatileMpStore } from '@/stores/mp-volatile-store';
import { useEffect, useState } from 'react';

export const RoundTimer = () => {
	const endTime = useVolatileMpStore(state => state.roundData.endTime);
	const [seconds, setSeconds] = useState(30);

	useEffect(() => {
		setSeconds(Math.ceil((endTime - new Date().getTime()) / 1000));
	}, [endTime]);

	useEffect(() => {
		const interval = setInterval(() => {
			setSeconds(seconds => Math.ceil(seconds - 1));
		}, 1000);

		return () => {
			clearInterval(interval);
		};
	}, []);

	if (Number(seconds) < 0) return null;

	return (
		<div className='text-center'>
			<h1 className='text-2xl font-semibold'>{seconds}</h1>
			<p className='text-zinc-600 dark:text-zinc-400 text-sm'>Sekunden</p>
		</div>
	);
};
