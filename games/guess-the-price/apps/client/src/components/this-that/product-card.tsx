import { CaretDoubleUp } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { Card, CardContent, CardFooter } from '../ui/card';
import { Image } from '../ui/image';
import { RandomProduct } from '@/interfaces/product.interface';
import { PriceContainer } from '../ui/price-container';

interface Props {
	product: RandomProduct;
	showingResult: boolean;
	animate?: boolean;
	onSelect: () => void;
}

export const ProductCard = ({
	product: { name, source, priceMessage, price, image },
	showingResult,
	animate = false,
	onSelect,
}: Props) => {
	return (
		<Card className='pt-6 w-full'>
			<CardContent className='w-full flex flex-row gap-4'>
				<Image
					src={image}
					alt={name}
					className='w-fit lg:w-[50%] lg:min-w-[250px] min-w-[180px] lg:h-[300px]'
				/>
				<div className='[&>p]:mb-2 [&>p]:text-sm  [&>h3]:font-medium'>
					<h3>Produkt</h3>
					<p className='break-words text-wrap whitespace-normal'>{name}</p>

					<h3 className='font-medium'>Quelle</h3>
					<p>{source}</p>

					<h3 className='font-medium'>Preis-Info</h3>
					<p>{priceMessage}</p>
					{showingResult && (
						<>
							<h3>Preis</h3>
							<PriceContainer price={price} animate={animate} className='text-3xl font-bold' />
						</>
					)}
				</div>
			</CardContent>
			<CardFooter>
				<Button className='w-full' onClick={onSelect}>
					<CaretDoubleUp size={24} /> Das ist teurer
				</Button>
			</CardFooter>
		</Card>
	);
};
