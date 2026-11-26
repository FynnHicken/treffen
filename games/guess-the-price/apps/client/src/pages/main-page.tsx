import { GameModeCard } from '@/components/main-page/game-mode-card';
import { useTheme } from '@/context/theme-provider';
import { motion } from 'framer-motion';
import { Navigate } from 'react-router-dom';
import { hubSessionId } from '@/lib/hub';

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
	hidden: { opacity: 0, y: 150 },
	visible: { opacity: 1, y: 0 },
};

export const MainPage = () => {
	const { theme } = useTheme();
	const base = import.meta.env.BASE_URL || '/';

	// Über den Hub gestartet → direkt in die gemeinsame Runde
	if (hubSessionId) return <Navigate to={`/multiplayer/${hubSessionId}`} replace />;

	return (
		<div>
			<div>
				<h1 className='font-bold text-3xl'>Spielmodus wählen</h1>
				<p className='text-md text-zinc-600 dark:text-zinc-400 '>
					Such dir einen Modus aus und schätz los!
				</p>
			</div>

			<motion.div
				variants={containerVariant}
				initial='hidden'
				animate='visible'
				className='py-12 flex flex-row flex-wrap gap-4 items-center justify-center'
			>
				<motion.div variants={itemVariant}>
					<GameModeCard
						title='Klassisch'
						description='Ein Produkt, du schätzt den Preis.'
						imageSrc={`${base}images/${theme == 'dark' ? 'd-' : ''}classic-mode-image.svg`}
						link='/classic-mode'
					/>
				</motion.div>
				<motion.div variants={itemVariant}>
					<GameModeCard
						title='Was ist teurer?'
						description='Zwei Produkte – welches kostet mehr?'
						imageSrc={`${base}images/${theme == 'dark' ? 'd-' : ''}this-or-that-mode-image.svg`}
						link='/this-that'
					/>
				</motion.div>
				<motion.div variants={itemVariant}>
					<GameModeCard
						title='Mehrspieler'
						description='Klassisch, aber gegen deine Freunde.'
						imageSrc={`${base}images/${theme == 'dark' ? 'd-' : ''}multiplayer-mode-image.svg`}
						link='/multiplayer'
					/>
				</motion.div>
			</motion.div>
		</div>
	);
};
