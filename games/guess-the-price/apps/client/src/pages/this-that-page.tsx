import { ProductCard } from '@/components/this-that/product-card';
import { ResultsCard } from '@/components/this-that/results-card';
import { RandomProduct } from '@/interfaces/product.interface';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useAnimate } from 'framer-motion';
import { ProductCardSkeleton } from '@/components/this-that/product-card-skeleton';
import { getApiUrl } from '@/lib/api';

const getProducts = async (current?: string) => {
	return fetch(getApiUrl() + `/random/product/highLow`, {
		method: 'POST',
		body: JSON.stringify({ current }),
		headers: { 'Content-type': 'application/json' },
	}).then(r => r.json());
};

export const ThisOrThatPage = () => {
	const [products, setProducts] = useState<{ selectedProduct: RandomProduct; newProduct: RandomProduct } | null>(null);
	const [playing, setPlaying] = useState(true);
	const [guesses, setGuesses] = useState(0);
	const [showingResult, setShowingResult] = useState(false);
	const [scope, animate] = useAnimate();

	useEffect(() => {
		setProducts(null);
		getProducts().then(data => {
			setProducts(data);
		});
	}, []);

	const restartGame = () => {
		setProducts(null);

		setPlaying(true);
		setGuesses(0);
		setShowingResult(false);

		getProducts().then(data => {
			setProducts(data);
		});
	};

	const selectProduct = async (selected: RandomProduct) => {
		if (showingResult) return;

		setShowingResult(true);

		//NOTE: Selected product from API response has nothing to do with newly selected product in client
		const nonSelected = products?.selectedProduct === selected ? products.newProduct : products?.selectedProduct;

		if (selected.price >= nonSelected!.price) {
			const newProducts = await getProducts(selected.id);

			setTimeout(async () => {
				await animate(scope.current, { opacity: 0 }, { duration: 0.5 });
				setShowingResult(false);
				setProducts(newProducts);
				setGuesses(g => g + 1);
				await animate(scope.current, { opacity: 1.1 }, { duration: 0.5 });
			}, 1500);
		} else {
			setTimeout(() => {
				setProducts(null);
				setPlaying(false);
				setShowingResult(false);
			}, 1500);
		}
	};

	if (!playing) {
		return (
			<>
				<div>
					<div className='mb-10'>
						<h1 className='font-semibold text-3xl'>Was ist teurer?</h1>
						<p className='text-zinc-600 dark:text-zinc-400'>Zwei Produkte – tippe auf das teurere.</p>
					</div>
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ duration: 0.8 }}
						className='w-full flex items-center justify-center'
					>
						<ResultsCard guesses={guesses} onContinue={restartGame} />
					</motion.div>
				</div>
			</>
		);
	}

	return (
		<div>
			<div className='mb-10'>
				<h1 className='font-semibold text-3xl'>Was ist teurer?</h1>
				<p className='text-zinc-600 dark:text-zinc-400'>Zwei Produkte – tippe auf das teurere.</p>
			</div>
			<AnimatePresence>
				{!products?.newProduct.name || !products.selectedProduct.name ? (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 1 }}
						className='flex flex-col md:flex-row gap-4 items-center'
					>
						<ProductCardSkeleton />
						<ProductCardSkeleton />
					</motion.div>
				) : (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 1 }}
						className='flex flex-col md:flex-row gap-4 items-center'
					>
						<ProductCard
							showingResult={true}
							product={products.selectedProduct}
							onSelect={() => {
								selectProduct(products.selectedProduct);
							}}
						/>
						<div className='rounded-lg border border-zinc-200 bg-white dark:text-white dark:bg-transparent dark:border-zinc-800 text-zinc-950 shadow-sm p-3'>
							<h2 className='text-2xl font-semibold'>VS</h2>
						</div>
						<motion.div ref={scope} className='w-full'>
							<ProductCard
								showingResult={showingResult}
								product={products.newProduct}
								animate
								onSelect={() => {
									selectProduct(products.newProduct);
								}}
							/>
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
};
