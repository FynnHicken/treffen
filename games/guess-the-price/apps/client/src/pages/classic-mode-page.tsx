import { useEffect, useState } from 'react';
import { ResultRecord, ResultsCard } from '@/components/classic-mode/results-card';
import { ResultCard } from '@/components/classic-mode/result-card';
import { ProductCard } from '@/components/classic-mode/product-card';
import { RandomProduct } from '@/interfaces/product.interface';
import { GuessCard } from '@/components/classic-mode/guess-card';
import { motion } from 'framer-motion';
import { ProductCardSkeleton } from '@/components/classic-mode/product-card-skeleton';
import { GuessCardSkeleton } from '@/components/classic-mode/guess-card-skeleton';
import { getApiUrl } from '@/lib/api';

const guessPrice = async (productId: string, price: number) => {
	return fetch(getApiUrl() + `/guess/product?guessedPrice=${price}&productId=${productId}`, {
		method: 'POST',
	}).then(r => r.json());
};

export const ClassicModePage = () => {
	const [product, setProduct] = useState<RandomProduct | null>(null);
	const [resultsVisible, setResultsVisible] = useState(false);
	const [guessedResults, setGuessedResults] = useState<[number, number, number] | null>(null);
	const [results, setResults] = useState<ResultRecord[]>([]);
	const [gameEnded, setGameEnded] = useState(false);
	const [seenProducts, setSeenProducts] = useState<string[]>([]);

	const fetchProduct = () => {
		setProduct(null);
		fetch(getApiUrl() + '/random/product', {
			method: 'POST',
			body: JSON.stringify({ ignores: seenProducts }),
			headers: { 'Content-type': 'application/json' },
		})
			.then(r => r.json())
			.then(data => {
				setProduct(data);
				setSeenProducts(sp => [...sp, data.id]);
			});
	};

	useEffect(() => {
		fetchProduct();
	}, []);

	if (gameEnded) {
		return (
			<div>
				<h1 className='font-semibold text-3xl'>Klassisch – Bilanz</h1>
				<p className='text-zinc-600 dark:text-zinc-400'>Ein Produkt, du schätzt den Preis.</p>
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.5 }}
					className='w-full flex items-center justify-center mt-10'
				>
					<ResultsCard
						guesses={results}
						onContinue={() => {
							fetchProduct();
							setResults([]);
							setResultsVisible(false);
							setGameEnded(false);
						}}
					/>
				</motion.div>
			</div>
		);
	}

	return (
		<div>
			<div>
				<h1 className='font-semibold text-3xl'>Klassisch</h1>
				<p className='text-zinc-600 dark:text-zinc-400'>Ein Produkt, du schätzt den Preis.</p>
			</div>
			{!product ? (
				<motion.div
					className='mt-6 flex md:flex-row flex-col gap-4 flex-1'
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.5 }}
				>
					<ProductCardSkeleton />
					<GuessCardSkeleton />
				</motion.div>
			) : (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.5 }}
					className='mt-6 flex md:flex-row flex-col gap-4 flex-1'
				>
					<ProductCard
						title={product.name}
						image={product.image}
						priceInfo={product.priceMessage ?? ''}
						source={product.source ?? 'unbekannt'}
					/>

					{!resultsVisible && (
						<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
							<GuessCard
								onGuess={async price => {
									const result = await guessPrice(product.id, price);

									setGuessedResults([result.points, result.originalPrice, result.guessedPrice]);
									setResults(results => [
										...results,
										{
											title: product.name,
											points: result.points,
											image: product.image,
											guessedPrice: result.guessedPrice,
											originalPrice: result.originalPrice,
										},
									]);
									setResultsVisible(true);
								}}
							/>
						</motion.div>
					)}

					{resultsVisible && (
						<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
							<ResultCard
								points={guessedResults?.[0] ?? 0}
								guessedPrice={guessedResults?.[2] ?? 0}
								originalPrice={guessedResults?.[1] ?? 0}
								onContinue={() => {
									setResultsVisible(false);
									fetchProduct();
								}}
								onFinish={() => {
									setGameEnded(true);
								}}
							/>
						</motion.div>
					)}
				</motion.div>
			)}
		</div>
	);
};
