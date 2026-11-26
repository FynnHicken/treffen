import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '../ui/button';
import { Link } from 'react-router-dom';
import { Joystick } from '@phosphor-icons/react';

interface Props {
	title: string;
	description: string;
	imageSrc: string;
	link: string;
	disabled?: boolean;
}

export const GameModeCard = ({ title, description, imageSrc, link, disabled = false }: Props) => {
	return (
		<Card className='max-w-[500px]'>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className='flex items-center justify-center'>
				<img src={imageSrc} alt='' className='md:min-w-[350px] w-[400px] aspect-video' />
			</CardContent>
			<CardFooter>
				<Button
					className='w-full text-md font-normal'
					asChild
					disabled={disabled}
					variant={disabled ? 'secondary' : 'default'}
				>
					<Link to={link}>
						<Joystick size={24} />
						{disabled ? 'Nicht verfügbar' : 'Spielen'}
					</Link>
				</Button>
			</CardFooter>
		</Card>
	);
};
