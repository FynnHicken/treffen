import { Navigate, useNavigate } from 'react-router-dom';
import { hubSessionId } from '@/lib/hub';
import { useMultiplayerConnection } from '@/hooks/use-multiplayer-connection';
import { useMpStore } from '@/stores/mp-store';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const MultiplayerJoinPage = () => {
	const navigate = useNavigate();
	const { createSession } = useMultiplayerConnection();
	const [existingSessionId, setSessionId] = useState('');
	const { sessionId } = useMpStore();

	const joinSession = () => {
		if (existingSessionId.length > 0) {
			navigate(`/multiplayer/${existingSessionId}`);
		}
	};

	useEffect(() => {
		if (sessionId) {
			navigate(`/multiplayer/${sessionId}`);
		}
	}, [navigate, sessionId]);

	if (hubSessionId) return <Navigate to={`/multiplayer/${hubSessionId}`} replace />;

	return (
		<div>
			<div className='mb-10'>
				<h1 className='font-semibold text-3xl'>Mehrspieler</h1>
				<p className='text-zinc-600 dark:text-zinc-400'>Erstelle eine Runde oder tritt einer bei.</p>
			</div>
			<div className='flex gap-4 flex-col md:flex-row'>
				<Card className='w-full h-fit'>
					<CardHeader>
						<CardTitle>Neue Runde</CardTitle>
						<CardDescription>Du leitest, deine Freunde treten per Link bei.</CardDescription>
					</CardHeader>
					<CardContent>
						<Button className='w-full' onClick={createSession}>
							Runde erstellen
						</Button>
					</CardContent>
				</Card>

				<Card className='w-full h-fit'>
					<CardHeader>
						<CardTitle>Beitreten</CardTitle>
						<CardDescription>Code der Runde eingeben.</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={e => { e.preventDefault(); joinSession(); }}>
							<Input
								placeholder='Code der Runde …'
								onChange={e => setSessionId(e.target.value)}
								value={existingSessionId}
							></Input>
							<Button className='w-full mt-4' disabled={existingSessionId.length <= 0} type='submit'>
								Beitreten
							</Button>
						</form>
					</CardContent>
					<CardFooter>
						<p className='text-sm'>
							Hast du einen Link bekommen? Einfach anklicken.
						</p>
					</CardFooter>
				</Card>
			</div>
		</div>
	);
};
