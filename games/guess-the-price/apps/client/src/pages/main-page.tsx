import { GameModeCard } from '@/components/main-page/game-mode-card';
import { useTheme } from '@/context/theme-provider';
import { motion } from 'framer-motion';

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

	return (
		<div>
			<div>
				<h1 className='font-bold text-3xl'>Choose game mode</h1>
				<p className='text-md text-zinc-600 dark:text-zinc-400 '>
					Choose your desired game mode and start guessing the price!
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
						title='Classic mode'
						description='Get a product and guess the price.'
						imageSrc={`${base}images/${theme == 'dark' ? 'd-' : ''}classic-mode-image.svg`}
						link='/classic-mode'
					/>
				</motion.div>
				<motion.div variants={itemVariant}>
					<GameModeCard
						title='This or that'
						description='Guess which product is more expensive.'
						imageSrc={`${base}images/${theme == 'dark' ? 'd-' : ''}this-or-that-mode-image.svg`}
						link='/this-that'
					/>
				</motion.div>
				<motion.div variants={itemVariant}>
					<GameModeCard
						title='Multiplayer mode'
						description='Play the classic mode with your friends.'
						imageSrc={`${base}images/${theme == 'dark' ? 'd-' : ''}multiplayer-mode-image.svg`}
						link='/multiplayer'
					/>
				</motion.div>
			</motion.div>
		</div>
	);
};
