import { PrismaClient } from '@prisma/client';
import { ControllerError } from '../../domain/errors/controller-error';
import { checkControllerError } from '../../domain/errors/handlers/handle-controller-error';

const MAX_PRICE_DIFF = 1;

export class RandomService {
	private static prisma = new PrismaClient();
	private static productSelectProperties = {
		id: true,
		name: true,
		description: true,
		image: true,
		source: true,
		price: true,
		priceMessage: true,
		category: {
			select: {
				name: true,
			},
		},
	};

	public static getRandomProduct = async (ignore: string[], category?: string) => {
		try {
			const productCount = await this.prisma.product.count({
				where: { id: { notIn: ignore }, categoryId: category },
			});

			if (!productCount) {
				throw new ControllerError("Couldn't find any product.", 404);
			}

			const randomProduct = await this.prisma.product.findMany({
				orderBy: { id: 'desc' },
				where: { id: { notIn: ignore }, categoryId: category },
				skip: Math.floor(Math.random() * productCount),
				take: 1,
				select: this.productSelectProperties,
			});

			if (!randomProduct[0]) {
				throw new ControllerError("Couldn't find any product.", 404);
			}

			const { price, ...rest } = randomProduct[0];
			return { ...rest, price: Number(price) };
		} catch (error) {
			console.error(error);
			checkControllerError(error as Error, 'Could not get random product');
		}
	};

	public static getRandomProductHighLow = async (currentProductId: string, ignore: string[]) => {
		try {
			const products = [];

			// First product
			products[0] = await this.prisma.product.findUnique({
				where: { id: currentProductId },
				select: this.productSelectProperties,
			});

			if (!products[0]) {
				products[0] = await this.getRandomProduct(ignore);
			}

			if (!products[0]) {
				throw new ControllerError('Could not find any product', 404);
			}

			// Second product
			const limitedProductCount = await this.prisma.product.count({
				where: {
					id: { notIn: [...ignore, products[0].id] },
					price: { lte: Number(products[0].price) + MAX_PRICE_DIFF, gte: Number(products[0].price) - MAX_PRICE_DIFF },
				},
			});

			if (limitedProductCount == 0) {
				products[1] = await this.getRandomProduct([...ignore, products[0].id]);
				return products;
			}

			products[1] = await this.prisma.product.findFirst({
				orderBy: { id: 'desc' },
				where: {
					id: { notIn: [...ignore, products[0].id] },
					price: { lte: Number(products[0].price) + MAX_PRICE_DIFF, gte: Number(products[0].price) - MAX_PRICE_DIFF },
				},
				skip: Math.floor(Math.random() * limitedProductCount),

				select: this.productSelectProperties,
			});

			if (!products[1]) {
				throw new ControllerError('Could not find any product', 404);
			}

			const { price: selectedProductPrice, ...selectedProductRest } = products[0];
			const { price: newProductPrice, ...newProductRest } = products[1];

			return {
				selectedProduct: { price: Number(selectedProductPrice), ...selectedProductRest },
				newProduct: { price: Number(newProductPrice), ...newProductRest },
			};
		} catch (error) {
			console.error(error);
			checkControllerError(error as Error, 'Could not get random product high low');
		}
	};
}
